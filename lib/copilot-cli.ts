import { execFile, spawn } from 'child_process'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface CopilotCliOptions {
  timeoutMs?: number
}

export interface CopilotCliResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

interface CopilotConfig {
  last_logged_in_user?: {
    host?: string
    login?: string
  }
  logged_in_users?: Array<{
    host?: string
    login?: string
  }>
  model?: string
}

let cachedConfig: CopilotConfig | null = null
let configReadAt = 0
let cachedCliAvailable: boolean | null = null
let cliCheckAt = 0
let cliCheckPromise: Promise<boolean> | null = null

const CACHE_TTL_MS = 60_000

function readCopilotConfigFile(): CopilotConfig | null {
  const configPath = join(homedir(), '.copilot', 'config.json')
  try {
    const raw = readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as CopilotConfig
    if (parsed.last_logged_in_user?.login || parsed.logged_in_users?.some((user) => user.login)) {
      return parsed
    }
  } catch {
    // Ignore missing or invalid config
  }
  return null
}

function readCopilotConfig(): CopilotConfig | null {
  const now = Date.now()
  if (cachedConfig && now - configReadAt < CACHE_TTL_MS) return cachedConfig
  cachedConfig = readCopilotConfigFile()
  configReadAt = now
  return cachedConfig
}

export function getCopilotCliAuthStatus(): {
  available: boolean
  login?: string
  host?: string
  configuredModel?: string
} {
  const config = readCopilotConfig()
  if (!config) return { available: false }

  const lastUser = config.last_logged_in_user ?? config.logged_in_users?.[0]
  if (!lastUser?.login) return { available: false }

  return {
    available: true,
    login: lastUser.login,
    host: lastUser.host,
    configuredModel: typeof config.model === 'string' ? config.model : undefined,
  }
}

async function isCopilotCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('copilot', ['--version'], {
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

export async function getCopilotCliAvailability(): Promise<boolean> {
  const now = Date.now()
  if (cachedCliAvailable !== null && now - cliCheckAt < CACHE_TTL_MS) return cachedCliAvailable
  if (cliCheckPromise) return cliCheckPromise

  cliCheckPromise = isCopilotCliAvailable().then((result) => {
    cachedCliAvailable = result
    cliCheckAt = Date.now()
    cliCheckPromise = null
    return result
  })
  return cliCheckPromise
}

export async function copilotPrompt(
  prompt: string,
  options: CopilotCliOptions = {},
): Promise<CopilotCliResult<string>> {
  const { timeoutMs = 120_000 } = options

  try {
    const { stdout } = await execFileAsync(
      'copilot',
      ['--no-color', '--no-custom-instructions', '-s', '-p', prompt],
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
    )

    const output = stdout.trim()
    if (!output) {
      return { success: false, error: 'Copilot CLI completed but returned no output' }
    }

    return { success: true, data: output }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
