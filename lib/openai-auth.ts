import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import OpenAI from 'openai'
import { getOpenaiTokenFromOpencode } from './opencode-auth'

interface CodexAuth {
  auth_mode?: string
  OPENAI_API_KEY?: string | null
  tokens?: {
    access_token?: string
    refresh_token?: string
    account_id?: string
  }
}

let cachedAuth: CodexAuth | null = null
let cacheReadAt = 0
const CACHE_TTL_MS = 60_000

function readCodexAuthFile(): CodexAuth | null {
  const paths = [
    join(homedir(), '.codex', 'auth.json'),
    join(homedir(), '.config', 'codex', 'auth.json'),
  ]
  for (const p of paths) {
    try {
      const raw = readFileSync(p, 'utf8')
      const parsed = JSON.parse(raw) as CodexAuth
      if (parsed.tokens?.access_token || parsed.OPENAI_API_KEY) return parsed
    } catch { continue }
  }
  return null
}

function readCodexAuth(): CodexAuth | null {
  const now = Date.now()
  if (cachedAuth && now - cacheReadAt < CACHE_TTL_MS) return cachedAuth

  const auth = readCodexAuthFile()
  cachedAuth = auth
  cacheReadAt = now
  return auth
}

/**
 * Returns the Codex auth mode. When 'chatgpt', the token only works
 * through `codex exec`, not the OpenAI SDK directly.
 */
export function getCodexAuthMode(): 'api_key' | 'chatgpt' | null {
  const auth = readCodexAuth()
  if (!auth) return null
  if (auth.OPENAI_API_KEY) return 'api_key'
  if (auth.auth_mode === 'chatgpt' && auth.tokens?.access_token) return 'chatgpt'
  if (auth.tokens?.access_token) return 'api_key'
  return null
}

function getCodexApiKey(): string | null {
  const auth = readCodexAuth()
  if (!auth) return null

  // Explicit API key takes priority
  if (auth.OPENAI_API_KEY) return auth.OPENAI_API_KEY

  // ChatGPT OAuth tokens don't work with the OpenAI SDK directly —
  // they need the `codex exec` CLI path. Don't return them here.
  if (auth.auth_mode === 'chatgpt') return null

  // Non-ChatGPT OAuth token (API key mode)
  if (auth.tokens?.access_token) return auth.tokens.access_token

  return null
}

export function getCodexCliAuthStatus(): {
  available: boolean
  expired?: boolean
  authMode?: string
  planType?: string
} {
  const auth = readCodexAuth()
  if (!auth) return { available: false }

  const key = auth.OPENAI_API_KEY || auth.tokens?.access_token
  if (!key) return { available: false }

  // Try to extract plan type from JWT for display
  let planType: string | undefined
  if (auth.tokens?.access_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(auth.tokens.access_token.split('.')[1], 'base64').toString()
      ) as { exp?: number; 'https://api.openai.com/auth'?: { chatgpt_plan_type?: string } }

      planType = payload['https://api.openai.com/auth']?.chatgpt_plan_type

      // Check if token is expired
      if (payload.exp && Date.now() / 1000 > payload.exp) {
        return { available: true, expired: true, authMode: auth.auth_mode, planType }
      }
    } catch { /* ignore parse errors */ }
  }

  return { available: true, authMode: auth.auth_mode, planType }
}

function createCodexOpenAIClient(baseURL?: string): OpenAI | null {
  const apiKey = getCodexApiKey()
  if (!apiKey) return null
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
}

export function resolveOpenAIClient(options: {
  overrideKey?: string
  dbKey?: string
  baseURL?: string
} = {}): OpenAI {
  const baseURL = options.baseURL ?? process.env.OPENAI_BASE_URL

  if (options.overrideKey?.trim()) {
    return new OpenAI({ apiKey: options.overrideKey.trim(), ...(baseURL ? { baseURL } : {}) })
  }

  if (options.dbKey?.trim()) {
    return new OpenAI({ apiKey: options.dbKey.trim(), ...(baseURL ? { baseURL } : {}) })
  }

  // Check OpenCode auth for OpenAI token
  const opencodeToken = getOpenaiTokenFromOpencode()
  if (opencodeToken) {
    return new OpenAI({ apiKey: opencodeToken, ...(baseURL ? { baseURL } : {}) })
  }

  const cliClient = createCodexOpenAIClient(baseURL)
  if (cliClient) return cliClient

  const envKey = process.env.OPENAI_API_KEY?.trim()
  if (envKey) return new OpenAI({ apiKey: envKey, ...(baseURL ? { baseURL } : {}) })

  if (baseURL) return new OpenAI({ apiKey: 'proxy', baseURL })

  throw new Error('No OpenAI API key found. Add your key in Settings, or set up Codex CLI.')
}
