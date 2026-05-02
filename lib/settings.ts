import prisma from '@/lib/db'

// Module-level caches — avoids hundreds of DB roundtrips per pipeline run
let _cachedModel: string | null = null
let _modelCacheExpiry = 0

let _cachedProvider: 'anthropic' | 'openai' | 'minimax' | null = null
let _providerCacheExpiry = 0

let _cachedOpenAIModel: string | null = null
let _openAIModelCacheExpiry = 0

let _cachedMiniMaxModel: string | null = null
let _miniMaxModelCacheExpiry = 0

const CACHE_TTL = 5 * 60 * 1000

/**
 * Get the configured Anthropic model from settings (cached for 5 minutes).
 *
 * `ANTHROPIC_MODEL` env var overrides the DB value when set — useful for
 * self-hosted deployments behind an Anthropic-compatible proxy.
 */
export async function getAnthropicModel(): Promise<string> {
  const envOverride = process.env.ANTHROPIC_MODEL?.trim()
  if (envOverride) return envOverride
  if (_cachedModel && Date.now() < _modelCacheExpiry) return _cachedModel
  const setting = await prisma.setting.findUnique({ where: { key: 'anthropicModel' } })
  _cachedModel = setting?.value ?? 'claude-haiku-4-5-20251001'
  _modelCacheExpiry = Date.now() + CACHE_TTL
  return _cachedModel
}

/**
 * Get the active AI provider (cached for 5 minutes).
 *
 * `AI_PROVIDER` env var overrides the DB value when set, so a misclick in
 * the Settings UI can't silently route requests to the wrong provider.
 */
export async function getProvider(): Promise<'anthropic' | 'openai' | 'minimax'> {
  const envOverride = process.env.AI_PROVIDER?.trim().toLowerCase()
  if (envOverride === 'openai' || envOverride === 'minimax' || envOverride === 'anthropic') {
    return envOverride
  }
  if (_cachedProvider && Date.now() < _providerCacheExpiry) return _cachedProvider
  const setting = await prisma.setting.findUnique({ where: { key: 'aiProvider' } })
  const val = setting?.value
  _cachedProvider = val === 'openai' ? 'openai' : val === 'minimax' ? 'minimax' : 'anthropic'
  _providerCacheExpiry = Date.now() + CACHE_TTL
  return _cachedProvider
}

/**
 * Get the configured OpenAI model from settings (cached for 5 minutes).
 *
 * `OPENAI_MODEL` env var overrides the DB value when set — useful for
 * self-hosted setups behind an OpenAI-compatible proxy (e.g. llama-swap)
 * where the model name is not in the upstream-curated allow-list.
 */
export async function getOpenAIModel(): Promise<string> {
  const envOverride = process.env.OPENAI_MODEL?.trim()
  if (envOverride) return envOverride
  if (_cachedOpenAIModel && Date.now() < _openAIModelCacheExpiry) return _cachedOpenAIModel
  const setting = await prisma.setting.findUnique({ where: { key: 'openaiModel' } })
  _cachedOpenAIModel = setting?.value ?? 'gpt-4.1-mini'
  _openAIModelCacheExpiry = Date.now() + CACHE_TTL
  return _cachedOpenAIModel
}

/**
 * Get the configured MiniMax model from settings (cached for 5 minutes).
 */
export async function getMiniMaxModel(): Promise<string> {
  const envOverride = process.env.MINIMAX_MODEL?.trim()
  if (envOverride) return envOverride
  if (_cachedMiniMaxModel && Date.now() < _miniMaxModelCacheExpiry) return _cachedMiniMaxModel
  const setting = await prisma.setting.findUnique({ where: { key: 'minimaxModel' } })
  _cachedMiniMaxModel = setting?.value ?? 'MiniMax-M2.7'
  _miniMaxModelCacheExpiry = Date.now() + CACHE_TTL
  return _cachedMiniMaxModel
}

/**
 * Get the model for the currently active provider.
 */
export async function getActiveModel(): Promise<string> {
  const provider = await getProvider()
  if (provider === 'minimax') return getMiniMaxModel()
  return provider === 'openai' ? getOpenAIModel() : getAnthropicModel()
}

/**
 * Clear all settings caches (call after settings are changed).
 */
export function invalidateSettingsCache(): void {
  _cachedModel = null
  _modelCacheExpiry = 0
  _cachedProvider = null
  _providerCacheExpiry = 0
  _cachedOpenAIModel = null
  _openAIModelCacheExpiry = 0
  _cachedMiniMaxModel = null
  _miniMaxModelCacheExpiry = 0
}
