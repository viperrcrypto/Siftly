import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts/siftly-scheduled-task.sh')

interface Scenario {
  mode: 'import' | 'categorize'
  importStatus?: number
  importBody?: unknown
  webhookStatus?: number
  startBody?: unknown
  statusBodies?: unknown[]
  timeoutSeconds?: number
}

async function runTask(scenario: Scenario) {
  const requests: { method: string; path: string; body: string }[] = []
  let statusIndex = 0
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      requests.push({ method: req.method ?? '', path, body })

      if (path === '/webhook') {
        res.writeHead(scenario.webhookStatus ?? 204).end()
        return
      }
      if (path === '/api/import/x-oauth/fetch') {
        res.writeHead(scenario.importStatus ?? 200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(scenario.importBody ?? { imported: 0, skipped: 0, total: 0, complete: true, hasMore: false }))
        return
      }
      if (path === '/api/categorize' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(scenario.startBody ?? { status: 'started', total: 0, runId: 'run-1' }))
        return
      }
      if (path === '/api/categorize' && req.method === 'GET') {
        const bodies = scenario.statusBodies ?? [{ status: 'idle', runId: 'run-1', done: 0, total: 0, stageCounts: { categorized: 0 } }]
        const status = bodies[Math.min(statusIndex++, bodies.length - 1)]
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(status))
        return
      }
      res.writeHead(404).end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  const child = spawn('/bin/bash', [scriptPath, scenario.mode], {
    cwd: process.cwd(),
    env: {
      NODE_ENV: 'test',
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      NODE_BIN: process.execPath,
      SIFTLY_BASE_URL: `http://127.0.0.1:${address.port}`,
      DISCORD_WEBHOOK_URL: `http://127.0.0.1:${address.port}/webhook`,
      SIFTLY_USERNAME: '',
      SIFTLY_PASSWORD: '',
      ...(scenario.timeoutSeconds === undefined ? {} : { SIFTLY_CATEGORIZE_TIMEOUT_SECONDS: String(scenario.timeoutSeconds) }),
    },
  })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
  const [code] = await once(child, 'close') as [number | null]
  await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
  return { code, output, requests }
}

function notifications(requests: { path: string; body: string }[]) {
  return requests.filter((request) => request.path === '/webhook').map((request) => JSON.parse(request.body).content as string)
}

describe('定期タスクのHTTP連携', () => {
  it('import完了・部分・失敗を区別し、response本文やcursorをDiscordへ出さない', async () => {
    const complete = await runTask({
      mode: 'import',
      importBody: { imported: 2, skipped: 3, total: 5, complete: true, hasMore: false, nextToken: 'PRIVATE_CURSOR' },
    })
    expect(complete.code, `${complete.output}\n${JSON.stringify(complete.requests)}`).toBe(0)
    expect(complete.requests.filter((request) => request.path === '/api/import/x-oauth/fetch')).toHaveLength(1)
    expect(JSON.parse(complete.requests.find((request) => request.path === '/api/import/x-oauth/fetch')!.body)).toMatchObject({ scheduled: true })
    expect(notifications(complete.requests)[0]).toContain('完了')
    expect(notifications(complete.requests)[0]).toContain('新規: 2 / 既存・除外: 3 / 処理: 5')
    expect(complete.output).not.toContain('PRIVATE_CURSOR')

    const partial = await runTask({
      mode: 'import',
      importBody: {
        imported: 1, skipped: 0, total: 1, complete: false, hasMore: true, nextToken: 'PRIVATE_CURSOR',
        warnings: [{ code: 'quota_exceeded', message: 'PRIVATE_UPSTREAM_DETAIL' }],
      },
    })
    expect(partial.code).toBe(1)
    expect(notifications(partial.requests)[0]).toContain('X API利用枠待ち')
    expect(partial.output).not.toContain('PRIVATE_CURSOR')
    expect(notifications(partial.requests)[0]).not.toContain('PRIVATE_UPSTREAM_DETAIL')

    const failed = await runTask({
      mode: 'import',
      importStatus: 502,
      importBody: {
        error: 'PRIVATE_HTTP_BODY', imported: 0, skipped: 0, total: 0, complete: false,
        hasMore: null, warnings: [{ code: 'network_error' }],
      },
    })
    expect(failed.code).toBe(1)
    expect(notifications(failed.requests)[0]).toContain('失敗')
    expect(notifications(failed.requests)[0]).toContain('network_error')
    expect(failed.output).not.toContain('PRIVATE_HTTP_BODY')
    expect(notifications(failed.requests)[0]).not.toContain('PRIVATE_HTTP_BODY')
  })

  it('Webhook失敗を検知しても元のimportを再実行しない', async () => {
    const result = await runTask({
      mode: 'import',
      webhookStatus: 500,
      importBody: { imported: 1, skipped: 0, total: 1, complete: true, hasMore: false },
    })

    expect(result.code).toBe(1)
    expect(result.requests.filter((request) => request.path === '/api/import/x-oauth/fetch')).toHaveLength(1)
    expect(result.requests.filter((request) => request.path === '/webhook')).toHaveLength(1)
    expect(result.output).toContain('Discord notification failed')
  })

  it('分類成功件数を通知し、部分失敗のerror detailは外へ出さない', async () => {
    const complete = await runTask({
      mode: 'categorize',
      startBody: { status: 'started', total: 5, runId: 'run-1' },
      statusBodies: [{ status: 'idle', runId: 'run-1', done: 5, total: 5, stageCounts: { categorized: 3 } }],
    })
    expect(complete.code).toBe(0)
    expect(notifications(complete.requests)[0]).toContain('完了')
    expect(notifications(complete.requests)[0]).toContain('処理: 5/5')
    expect(notifications(complete.requests)[0]).toContain('分類済み: 3')

    const partial = await runTask({
      mode: 'categorize',
      startBody: { status: 'started', total: 1, runId: 'run-1' },
      statusBodies: [{
        status: 'idle', runId: 'run-1', done: 1, total: 1,
        stageCounts: { categorized: 0 }, lastError: 'PRIVATE_MODEL_RESPONSE',
      }],
    })
    expect(partial.code).toBe(1)
    expect(notifications(partial.requests)[0]).toContain('一部失敗')
    expect(notifications(partial.requests)[0]).toContain('分類保存: 0件')
    expect(notifications(partial.requests)[0]).not.toContain('PRIVATE_MODEL_RESPONSE')
    expect(partial.output).not.toContain('PRIVATE_MODEL_RESPONSE')
  })

  it('分類対象0件でも0/0の正常結果を通知する', async () => {
    const result = await runTask({
      mode: 'categorize',
      startBody: { status: 'started', total: 0, runId: 'run-1' },
      statusBodies: [{ status: 'idle', runId: 'run-1', done: 0, total: 0, stageCounts: { categorized: 0 } }],
    })

    expect(result.code).toBe(0)
    expect(notifications(result.requests)[0]).toContain('処理: 0/0')
    expect(notifications(result.requests)[0]).toContain('分類済み: 0')
  })

  it('停止状態と6時間timeoutを成功と混同しない', async () => {
    const stopped = await runTask({
      mode: 'categorize',
      startBody: { status: 'started', total: 5, runId: 'run-1' },
      statusBodies: [{
        status: 'idle', runId: 'run-1', done: 2, total: 5, stageCounts: { categorized: 1 }, error: 'Stopped by user',
      }],
    })
    expect(stopped.code).toBe(1)
    expect(notifications(stopped.requests)[0]).toContain('停止されました')
    expect(notifications(stopped.requests)[0]).toContain('処理: 2/5')

    const timedOut = await runTask({ mode: 'categorize', timeoutSeconds: 0 })
    expect(timedOut.code).toBe(1)
    expect(timedOut.requests.filter((request) => request.path === '/api/categorize' && request.method === 'POST')).toHaveLength(1)
    expect(timedOut.requests.filter((request) => request.path === '/api/categorize' && request.method === 'GET')).toHaveLength(0)
    expect(notifications(timedOut.requests)[0]).toContain('6時間でタイムアウト')
  })

  it('分類通知のWebhook失敗でも分類開始は一度だけ', async () => {
    const result = await runTask({
      mode: 'categorize',
      webhookStatus: 500,
      statusBodies: [{ status: 'idle', runId: 'run-1', done: 0, total: 0, stageCounts: { categorized: 0 } }],
    })

    expect(result.code).toBe(1)
    expect(result.requests.filter((request) => request.path === '/api/categorize' && request.method === 'POST')).toHaveLength(1)
    expect(result.requests.filter((request) => request.path === '/webhook')).toHaveLength(1)
  })

  it('分類runIdがpoll中に変われば誤認せず、responseのerror detailは通知しない', async () => {
    const result = await runTask({
      mode: 'categorize',
      startBody: { status: 'started', total: 4, runId: 'run-1' },
      statusBodies: [{ status: 'idle', runId: 'run-2', done: 0, total: 4, stageCounts: { categorized: 0 } }],
    })

    expect(result.code).toBe(1)
    expect(result.requests.filter((request) => request.path === '/api/categorize' && request.method === 'POST')).toHaveLength(1)
    expect(notifications(result.requests)[0]).toContain('実行IDが変わりました')
    expect(notifications(result.requests)[0]).not.toContain('run-1')
    expect(notifications(result.requests)[0]).not.toContain('run-2')
  })
})
