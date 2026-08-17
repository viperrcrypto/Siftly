import { readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { execCli } from './cli-exec'

export interface CodexCliOptions {
  model?: string
  timeoutMs?: number
}

export interface CodexCliResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export async function isCodexCliAvailable(): Promise<boolean> {
  try {
    await execCli('codex', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

export async function codexPrompt(
  prompt: string,
  options: CodexCliOptions = {}
): Promise<CodexCliResult<string>> {
  const { model, timeoutMs = 120_000 } = options

  // Write output to a temp file so we can capture the model's final message cleanly
  const outFile = join(tmpdir(), `codex-out-${randomUUID()}.txt`)

  // Codex can inherit the desktop session's feature config, which may be
  // incompatible with the installed CLI version. Auth is still read from
  // CODEX_HOME when user config is ignored.
  const args = ['exec', '--ignore-user-config', '--output-last-message', outFile]
  if (model) args.push('--model', model)
  args.push(prompt)

  try {
    await execCli('codex', args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })

    // Read the captured output
    try {
      const output = readFileSync(outFile, 'utf8').trim()
      try { unlinkSync(outFile) } catch { /* ignore cleanup errors */ }
      return { success: true, data: output }
    } catch {
      try { unlinkSync(outFile) } catch { /* ignore */ }
      return { success: false, error: 'Codex exec completed but no output file found' }
    }
  } catch (err) {
    // If the process ran but output was written before the error, try reading it
    try {
      const output = readFileSync(outFile, 'utf8').trim()
      try { unlinkSync(outFile) } catch { /* ignore */ }
      if (output) {
        return { success: true, data: output }
      }
    } catch { /* no output file */ }

    try { unlinkSync(outFile) } catch { /* ignore */ }
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

let _cliAvailable: boolean | null = null
let _cliCheckTime = 0
let _cliCheckPromise: Promise<boolean> | null = null
const CLI_CHECK_TTL_MS = 60_000

export async function getCodexCliAvailability(): Promise<boolean> {
  const now = Date.now()
  if (_cliAvailable !== null && now - _cliCheckTime < CLI_CHECK_TTL_MS) return _cliAvailable
  if (_cliCheckPromise) return _cliCheckPromise

  _cliCheckPromise = isCodexCliAvailable().then((result) => {
    _cliAvailable = result
    _cliCheckTime = Date.now()
    _cliCheckPromise = null
    return result
  })
  return _cliCheckPromise
}
