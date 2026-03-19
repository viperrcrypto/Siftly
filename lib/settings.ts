import prisma from '@/lib/db'

// Module-level caches — avoids hundreds of DB roundtrips per pipeline run
let _cachedModel: string | null = null
let _modelCacheExpiry = 0

let _cachedProvider: 'anthropic' | 'openai' | 'pi-ai' | null = null
let _providerCacheExpiry = 0

let _cachedOpenAIModel: string | null = null
let _openAIModelCacheExpiry = 0

let _cachedPiAiModel: string | null = null
let _piAiModelCacheExpiry = 0

let _cachedPiAiProviderId: string | null = null
let _piAiProviderIdCacheExpiry = 0

const CACHE_TTL = 5 * 60 * 1000

/**
 * Get the configured Anthropic model from settings (cached for 5 minutes).
 */
export async function getAnthropicModel(): Promise<string> {
  if (_cachedModel !== null && Date.now() < _modelCacheExpiry) return _cachedModel
  const setting = await prisma.setting.findUnique({ where: { key: 'anthropicModel' } })
  const value = setting?.value ?? 'claude-haiku-4-5-20251001'
  _cachedModel = value
  _modelCacheExpiry = Date.now() + CACHE_TTL
  return value
}

/**
 * Get the active AI provider (cached for 5 minutes).
 */
export async function getProvider(): Promise<'anthropic' | 'openai' | 'pi-ai'> {
  if (_cachedProvider !== null && Date.now() < _providerCacheExpiry) return _cachedProvider
  const setting = await prisma.setting.findUnique({ where: { key: 'aiProvider' } })
  _cachedProvider = setting?.value === 'openai' ? 'openai' : setting?.value === 'pi-ai' ? 'pi-ai' : 'anthropic'
  _providerCacheExpiry = Date.now() + CACHE_TTL
  return _cachedProvider
}

/**
 * Get the configured OpenAI model from settings (cached for 5 minutes).
 */
export async function getOpenAIModel(): Promise<string> {
  if (_cachedOpenAIModel !== null && Date.now() < _openAIModelCacheExpiry) return _cachedOpenAIModel
  const setting = await prisma.setting.findUnique({ where: { key: 'openaiModel' } })
  const value = setting?.value ?? 'gpt-4.1-mini'
  _cachedOpenAIModel = value
  _openAIModelCacheExpiry = Date.now() + CACHE_TTL
  return value
}

export async function getPiAiProviderId(): Promise<string> {
  if (_cachedPiAiProviderId !== null && Date.now() < _piAiProviderIdCacheExpiry) return _cachedPiAiProviderId
  const setting = await prisma.setting.findUnique({ where: { key: 'piAiProvider' } })
  const value = setting?.value ?? 'openai'
  _cachedPiAiProviderId = value
  _piAiProviderIdCacheExpiry = Date.now() + CACHE_TTL
  return value
}

export async function getPiAiModel(): Promise<string> {
  if (_cachedPiAiModel !== null && Date.now() < _piAiModelCacheExpiry) return _cachedPiAiModel
  const setting = await prisma.setting.findUnique({ where: { key: 'piAiModel' } })
  const value = setting?.value ?? 'gpt-4o-mini'
  _cachedPiAiModel = value
  _piAiModelCacheExpiry = Date.now() + CACHE_TTL
  return value
}

/**
 * Get the model for the currently active provider.
 */
export async function getActiveModel(): Promise<string> {
  const provider = await getProvider()
  if (provider === 'openai') return getOpenAIModel()
  if (provider === 'pi-ai') return getPiAiModel()
  return getAnthropicModel()
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
  _cachedPiAiModel = null
  _piAiModelCacheExpiry = 0
  _cachedPiAiProviderId = null
  _piAiProviderIdCacheExpiry = 0
}
