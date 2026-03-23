import OpenAI from 'openai'

/**
 * Resolve a MiniMax-compatible OpenAI client.
 *
 * MiniMax exposes an OpenAI-compatible API at https://api.minimax.io/v1.
 * Auth priority:
 *   1. Override key (from request body)
 *   2. DB-saved key
 *   3. MINIMAX_API_KEY env var
 *   4. Custom base URL (proxy)
 */
export function resolveMiniMaxClient(options: {
  overrideKey?: string
  dbKey?: string
  baseURL?: string
} = {}): OpenAI {
  const baseURL = options.baseURL ?? process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1'

  if (options.overrideKey?.trim()) {
    return new OpenAI({ apiKey: options.overrideKey.trim(), baseURL })
  }

  if (options.dbKey?.trim()) {
    return new OpenAI({ apiKey: options.dbKey.trim(), baseURL })
  }

  const envKey = process.env.MINIMAX_API_KEY?.trim()
  if (envKey) return new OpenAI({ apiKey: envKey, baseURL })

  if (options.baseURL) return new OpenAI({ apiKey: 'proxy', baseURL })

  throw new Error('No MiniMax API key found. Add your key in Settings, or set MINIMAX_API_KEY.')
}
