import prisma from '@/lib/db'
import { AIProvider } from '@/lib/ai-provider'

// Module-level caches — avoids hundreds of DB roundtrips per pipeline run
let _cachedModel: string | null = null
let _modelCacheExpiry = 0

let _cachedProvider: AIProvider | null = null
let _providerCacheExpiry = 0

let _cachedOpenAIModel: string | null = null
let _openAIModelCacheExpiry = 0

let _cachedOpenAICompatModel: string | null = null
let _openAICompatModelCacheExpiry = 0

let _cachedOpenAICompatBaseUrl: string | null = null
let _openAICompatBaseUrlCacheExpiry = 0

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
export async function getProvider(): Promise<AIProvider> {
  if (_cachedProvider && Date.now() < _providerCacheExpiry) return _cachedProvider
  const setting = await prisma.setting.findUnique({ where: { key: 'aiProvider' } })
  _cachedProvider = setting?.value === 'openai' || setting?.value === 'openai-compatible'
    ? setting.value as AIProvider
    : 'anthropic'
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
 * Get the configured OpenAI-compatible model from settings (cached for 5 minutes).
 */
export async function getOpenAICompatModel(): Promise<string> {
  if (_cachedOpenAICompatModel && Date.now() < _openAICompatModelCacheExpiry) return _cachedOpenAICompatModel
  const setting = await prisma.setting.findUnique({ where: { key: 'openaiCompatModel' } })
  _cachedOpenAICompatModel = setting?.value ?? process.env.OPENAI_COMPAT_MODEL?.trim() ?? 'openai/gpt-4.1-mini'
  _openAICompatModelCacheExpiry = Date.now() + CACHE_TTL
  return _cachedOpenAICompatModel
}

/**
 * Get the configured OpenAI-compatible base URL from settings (cached for 5 minutes).
 */
export async function getOpenAICompatBaseUrl(): Promise<string> {
  if (_cachedOpenAICompatBaseUrl !== null && Date.now() < _openAICompatBaseUrlCacheExpiry) {
    return _cachedOpenAICompatBaseUrl
  }
  const setting = await prisma.setting.findUnique({ where: { key: 'openaiCompatBaseUrl' } })
  _cachedOpenAICompatBaseUrl = setting?.value ?? process.env.OPENAI_COMPAT_BASE_URL?.trim() ?? ''
  _openAICompatBaseUrlCacheExpiry = Date.now() + CACHE_TTL
  return _cachedOpenAICompatBaseUrl
}

/**
 * Get the model for the currently active provider.
 */
export async function getActiveModel(): Promise<string> {
  const provider = await getProvider()
  if (provider === 'openai') return getOpenAIModel()
  if (provider === 'openai-compatible') return getOpenAICompatModel()
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
  _cachedOpenAICompatModel = null
  _openAICompatModelCacheExpiry = 0
  _cachedOpenAICompatBaseUrl = null
  _openAICompatBaseUrlCacheExpiry = 0
}
