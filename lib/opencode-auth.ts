import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface OpencodeAuth {
  type: 'api' | 'oauth'
  key?: string
  access?: string
  refresh?: string
  expires?: number
}

interface OpencodeConfig {
  opencode?: OpencodeAuth
  openai?: OpencodeAuth
  'github-copilot'?: OpencodeAuth
  'zai-coding-plan'?: OpencodeAuth
  'bailian-coding-plan'?: OpencodeAuth
}

let cachedAuth: OpencodeConfig | null = null
let cacheReadAt = 0
const CACHE_TTL_MS = 60_000

function readOpencodeAuthFile(): OpencodeConfig | null {
  const paths = [
    join(homedir(), '.config', 'opencode', 'auth.json'),
    join(homedir(), '.opencode', 'auth.json'),
  ]
  for (const p of paths) {
    try {
      const raw = readFileSync(p, 'utf8')
      const parsed = JSON.parse(raw) as OpencodeConfig
      return parsed
    } catch { continue }
  }
  return null
}

function readOpencodeAuth(): OpencodeConfig | null {
  const now = Date.now()
  if (cachedAuth && now - cacheReadAt < CACHE_TTL_MS) return cachedAuth

  const auth = readOpencodeAuthFile()
  cachedAuth = auth
  cacheReadAt = now
  return auth
}

/**
 * Returns the OpenCode API key if available.
 */
export function getOpencodeApiKey(): string | null {
  const auth = readOpencodeAuth()
  if (!auth?.opencode?.key) return null
  return auth.opencode.key
}

/**
 * Returns the available OpenAI token from OpenCode auth (OAuth or API key).
 */
export function getOpenaiTokenFromOpencode(): string | null {
  const auth = readOpencodeAuth()
  if (!auth?.openai) return null

  // Return access token if available and not expired
  if (auth.openai.access) {
    if (auth.openai.expires && Date.now() > auth.openai.expires) {
      // Token expired
      return null
    }
    return auth.openai.access
  }

  return auth.openai.key || null
}

/**
 * Returns auth status for the settings UI.
 */
export function getOpencodeAuthStatus(): {
  available: boolean
  expired?: boolean
  hasOpencodeKey: boolean
  hasOpenaiToken: boolean
  hasCopilot?: boolean
} {
  const auth = readOpencodeAuth()
  if (!auth) return { available: false, hasOpencodeKey: false, hasOpenaiToken: false }

  const hasOpencodeKey = !!auth.opencode?.key
  const hasOpenaiToken = !!auth.openai?.access || !!auth.openai?.key
  const hasCopilot = !!auth['github-copilot']?.access

  // Check if OpenAI token is expired
  let expired = false
  if (auth.openai?.expires && Date.now() > auth.openai.expires) {
    expired = true
  }

  return {
    available: hasOpencodeKey || hasOpenaiToken,
    expired,
    hasOpencodeKey,
    hasOpenaiToken,
    hasCopilot,
  }
}

/**
 * Resolves the best available API key/token from OpenCode.
 * Priority: OpenCode API key > OpenAI token
 */
export function resolveOpencodeToken(): string | null {
  // Try OpenCode API key first
  const opencodeKey = getOpencodeApiKey()
  if (opencodeKey) return opencodeKey

  // Fall back to OpenAI token
  return getOpenaiTokenFromOpencode()
}
