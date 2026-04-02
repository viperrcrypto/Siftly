import { spawn } from 'child_process'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

export interface CodexCliOptions {
  model?: string
  timeoutMs?: number
}

export interface CodexCliResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

function getCodexBinary(): string {
  const candidates = [
    process.env.CODEX_BIN,
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    'codex',
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (candidate === 'codex' || existsSync(candidate)) return candidate
  }

  return 'codex'
}

function readOutputFile(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  } finally {
    try { unlinkSync(path) } catch { /* ignore cleanup errors */ }
  }
}

function extractUsefulStdout(stdout: string, stderr = ''): string {
  if (stdout.trim()) {
    const jsonlLines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    for (const line of jsonlLines) {
      try {
        const parsed = JSON.parse(line) as {
          type?: string
          text?: string
          item?: { type?: string; text?: string }
        }

        if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message' && parsed.item.text) {
          return parsed.item.text.trim()
        }
        if (parsed.type === 'agent_message' && parsed.text) {
          return parsed.text.trim()
        }
      } catch {
        // Not JSONL; fall through to plain-text heuristics below.
      }
    }
  }

  const combined = `${stdout}\n${stderr}`.trim()
  if (!combined) return ''

  // Prefer structured payloads because Siftly prompts ask for raw JSON.
  const jsonArray = combined.match(/\[[\s\S]*\]/)
  if (jsonArray) return jsonArray[0].trim()

  const jsonObject = combined.match(/\{[\s\S]*\}/)
  if (jsonObject) return jsonObject[0].trim()

  // Fall back to the last non-empty line that isn't a Codex banner/log line.
  const lines = combined
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      return !(
        line.startsWith('OpenAI Codex') ||
        line.startsWith('workdir:') ||
        line.startsWith('model:') ||
        line.startsWith('provider:') ||
        line.startsWith('approval:') ||
        line.startsWith('sandbox:') ||
        line.startsWith('reasoning ') ||
        line.startsWith('session id:') ||
        line === '--------' ||
        line === 'user' ||
        line.startsWith('WARNING:') ||
        line.includes('WARN codex_') ||
        line.includes('Could not create otel exporter') ||
        line.includes('Reading additional input from stdin')
      )
    })

  return lines.at(-1) ?? ''
}

export async function isCodexCliAvailable(): Promise<boolean> {
  const codexBin = getCodexBinary()
  return new Promise((resolve) => {
    const proc = spawn(codexBin, ['--version'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    const timeout = setTimeout(() => { proc.kill(); resolve(false) }, 5000)
    proc.on('close', (code) => { clearTimeout(timeout); resolve(code === 0) })
    proc.on('error', () => { clearTimeout(timeout); resolve(false) })
  })
}

export async function codexPrompt(
  prompt: string,
  options: CodexCliOptions = {}
): Promise<CodexCliResult<string>> {
  const { model, timeoutMs = 120_000 } = options
  const codexBin = getCodexBinary()

  // Write output to a temp file so we can capture the model's final message cleanly
  const outFile = join(tmpdir(), `codex-out-${randomUUID()}.txt`)

  const args = ['exec', '--json', '--output-last-message', outFile]
  if (model) args.push('--model', model)
  args.push(prompt)

  // Use spawn instead of execFile so we can immediately close stdin.
  // Codex CLI reads from stdin when it detects a pipe, blocking indefinitely
  // if stdin is never closed (execFileAsync leaves the pipe open).
  try {
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const proc = spawn(codexBin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      // Close stdin immediately so codex doesn't block waiting for input
      proc.stdin.end()

      let stdout = ''
      let stderr = ''
      proc.stdout.setEncoding('utf8')
      proc.stderr.setEncoding('utf8')
      proc.stdout.on('data', (d: string) => { stdout += d })
      proc.stderr.on('data', (d: string) => { stderr += d })

      const timer = setTimeout(() => {
        proc.kill()
        reject(new Error(`Codex exec timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      proc.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve({ stdout, stderr })
        } else {
          const err = new Error(`Codex exec exited with code ${code}`) as Error & { stdout: string; stderr: string }
          err.stdout = stdout
          err.stderr = stderr
          reject(err)
        }
      })
      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })

    const output = readOutputFile(outFile) || extractUsefulStdout(stdout, stderr)
    if (output) return { success: true, data: output }
    return { success: false, error: 'Codex exec completed but produced no usable output' }
  } catch (err) {
    const errorWithOutput = err as Error & { stdout?: string; stderr?: string }
    const output = readOutputFile(outFile) || extractUsefulStdout(errorWithOutput.stdout ?? '', errorWithOutput.stderr ?? '')
    if (output) return { success: true, data: output }
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

let _cliAvailable: boolean | null = null
let _cliCheckTime = 0
let _cliCheckPromise: Promise<boolean> | null = null
const CLI_CHECK_TTL_MS = 60_000

export async function getCodexCliAvailability(): Promise<boolean> {
  const now = Date.now()
  if (_cliAvailable === true && now - _cliCheckTime < CLI_CHECK_TTL_MS) return _cliAvailable
  if (_cliCheckPromise) return _cliCheckPromise

  _cliCheckPromise = isCodexCliAvailable().then((result) => {
    _cliAvailable = result ? true : null
    _cliCheckTime = Date.now()
    _cliCheckPromise = null
    return result
  })
  return _cliCheckPromise
}
