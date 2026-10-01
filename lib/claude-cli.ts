import { spawn } from 'child_process'
import { execCli } from './cli-exec'

export type CliModelAlias = 'haiku' | 'sonnet' | 'opus'

export interface ClaudeCliOptions {
  model?: CliModelAlias
  maxTurns?: number
  timeoutMs?: number
}

/**
 * Maps a full Anthropic model name to a CLI alias.
 * E.g., 'claude-opus-4-6' → 'opus', 'claude-haiku-4-5-20251001' → 'haiku'
 */
export function modelNameToCliAlias(fullModelName: string): CliModelAlias {
  if (fullModelName.includes('opus')) return 'opus'
  if (fullModelName.includes('haiku')) return 'haiku'
  return 'sonnet'
}

export interface ClaudeCliResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
  rawOutput?: string
}

/**
 * Check if Claude CLI is available and authenticated (async).
 */
export async function isCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['auth', 'status'], {
      stdio: 'ignore',
      windowsHide: true,
    })

    const timeout = setTimeout(() => {
      proc.kill()
      resolve(false)
    }, 5000)

    proc.on('close', (code) => {
      clearTimeout(timeout)
      resolve(code === 0)
    })

    proc.on('error', () => {
      clearTimeout(timeout)
      resolve(false)
    })
  })
}

/**
 * Execute a prompt via Claude CLI and return raw text output (async).
 * Uses execFile with separate arguments to prevent command injection.
 */
export async function claudePrompt(
  prompt: string,
  options: ClaudeCliOptions = {}
): Promise<ClaudeCliResult<string>> {
  const { model, maxTurns = 1, timeoutMs = 120_000 } = options

  const args = ['-p', '--output-format', 'json', '--max-turns', String(maxTurns)]
  if (model) args.push('--model', model)
  args.push(prompt)

  try {
    const { stdout } = await execCli('claude', args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      windowsHide: true,
    })

    // Parse the JSON output from CLI
    const parsed = JSON.parse(stdout)
    const text = extractTextFromCliOutput(parsed)

    return { success: true, data: text, rawOutput: stdout }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

/**
 * Extract text content from CLI JSON output.
 * CLI output structure varies - handle common patterns.
 */
function extractTextFromCliOutput(cliOutput: unknown): string {
  if (typeof cliOutput === 'string') return cliOutput

  if (typeof cliOutput === 'object' && cliOutput !== null) {
    const obj = cliOutput as Record<string, unknown>

    // Common patterns from --output-format json
    if (typeof obj.result === 'string') return obj.result
    if (typeof obj.content === 'string') return obj.content
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.message === 'string') return obj.message

    // If it's the raw message structure
    if (Array.isArray(obj.content)) {
      const textBlock = obj.content.find(
        (b: unknown) => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'text'
      )
      if (textBlock && typeof (textBlock as Record<string, unknown>).text === 'string') {
        return (textBlock as Record<string, unknown>).text as string
      }
    }

    // Fallback: stringify
    return JSON.stringify(cliOutput)
  }

  return String(cliOutput)
}

// Cache CLI availability check
let _cliAvailable: boolean | null = null
let _cliCheckTime = 0
let _cliCheckPromise: Promise<boolean> | null = null
const CLI_CHECK_TTL_MS = 60_000

/**
 * Check if CLI is available (cached for 1 minute, async).
 */
export async function getCliAvailability(): Promise<boolean> {
  const now = Date.now()

  // Return cached value if still valid
  if (_cliAvailable !== null && now - _cliCheckTime < CLI_CHECK_TTL_MS) {
    return _cliAvailable
  }

  // Dedupe concurrent checks
  if (_cliCheckPromise) {
    return _cliCheckPromise
  }

  _cliCheckPromise = isCliAvailable().then((result) => {
    _cliAvailable = result
    _cliCheckTime = Date.now()
    _cliCheckPromise = null
    return result
  })

  return _cliCheckPromise
}
