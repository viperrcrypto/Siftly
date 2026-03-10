import prisma from '@/lib/db'

// Module-level caches — avoids hundreds of DB roundtrips per pipeline run
let _cachedModel: string | null = null
let _modelCacheExpiry = 0

let _cachedProvider: 'anthropic' | 'openai' | 'opencode' | null = null
let _providerCacheExpiry = 0

let _cachedOpenAIModel: string | null = null
let _openAIModelCacheExpiry = 0

let _cachedOpencodeModel: string | null = null
let _opencodeModelCacheExpiry = 0

const CACHE_TTL = 5 * 60 * 1000

/**
 * Get the configured Anthropic model from settings (cached for 5 minutes).
 */
export async function getAnthropicModel(): Promise<string> {
  if (_cachedModel && Date.now() < _modelCacheExpiry) return _cachedModel
  const setting = await prisma.setting.findUnique({ where: { key: 'anthropicModel' } })
  _cachedModel = setting?.value ?? 'claude-haiku-4-5-20251001'
  _modelCacheExpiry = Date.now() + CACHE_TTL
  return _cachedModel
}

/**
 * Get the active AI provider (cached for 5 minutes).
 */
export async function getProvider(): Promise<'anthropic' | 'openai' | 'opencode'> {
  if (_cachedProvider && Date.now() < _providerCacheExpiry) return _cachedProvider
  const setting = await prisma.setting.findUnique({ where: { key: 'aiProvider' } })
  const value = setting?.value
  _cachedProvider = value === 'opencode' ? 'opencode' : value === 'openai' ? 'openai' : 'anthropic'
  _providerCacheExpiry = Date.now() + CACHE_TTL
  return _cachedProvider
}

/**
 * Get the configured OpenAI model from settings (cached for 5 minutes).
 */
export async function getOpenAIModel(): Promise<string> {
  if (_cachedOpenAIModel && Date.now() < _openAIModelCacheExpiry) return _cachedOpenAIModel
  const setting = await prisma.setting.findUnique({ where: { key: 'openaiModel' } })
  _cachedOpenAIModel = setting?.value ?? 'gpt-4.1-mini'
  _openAIModelCacheExpiry = Date.now() + CACHE_TTL
  return _cachedOpenAIModel
}

/**
 * Get the configured OpenCode model from settings (cached for 5 minutes).
 */
export async function getOpencodeModel(): Promise<string> {
  if (_cachedOpencodeModel && Date.now() < _opencodeModelCacheExpiry) return _cachedOpencodeModel
  const setting = await prisma.setting.findUnique({ where: { key: 'opencodeModel' } })
  _cachedOpencodeModel = setting?.value ?? 'gpt-4.1-mini'
  _opencodeModelCacheExpiry = Date.now() + CACHE_TTL
  return _cachedOpencodeModel
}

/**
 * Get the model for the currently active provider.
 */
export async function getActiveModel(): Promise<string> {
  const provider = await getProvider()
  if (provider === 'opencode') return getOpencodeModel()
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
  _cachedOpencodeModel = null
  _opencodeModelCacheExpiry = 0
}
