import prisma from '@/lib/db'

export type AIProvider = 'anthropic' | 'openai' | 'ollama'

// Module-level caches — avoids hundreds of DB roundtrips per pipeline run
let _cachedModel: string | null = null
let _modelCacheExpiry = 0

let _cachedProvider: AIProvider | null = null
let _providerCacheExpiry = 0

let _cachedOpenAIModel: string | null = null
let _openAIModelCacheExpiry = 0

let _cachedOllamaModel: string | null = null
let _ollamaModelCacheExpiry = 0

let _cachedOllamaBaseUrl: string | null = null
let _ollamaBaseUrlCacheExpiry = 0

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
  const val = setting?.value
  _cachedProvider = val === 'openai' ? 'openai' : val === 'ollama' ? 'ollama' : 'anthropic'
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
 * Get the configured Ollama model from settings (cached for 5 minutes).
 */
export async function getOllamaModel(): Promise<string> {
  if (_cachedOllamaModel && Date.now() < _ollamaModelCacheExpiry) return _cachedOllamaModel
  const setting = await prisma.setting.findUnique({ where: { key: 'ollamaModel' } })
  const val = setting?.value ?? 'llama3.1'
  _cachedOllamaModel = val
  _ollamaModelCacheExpiry = Date.now() + CACHE_TTL
  return val
}

/**
 * Get the Ollama base URL (cached for 5 minutes).
 */
export async function getOllamaBaseUrl(): Promise<string> {
  if (_cachedOllamaBaseUrl && Date.now() < _ollamaBaseUrlCacheExpiry) return _cachedOllamaBaseUrl
  const setting = await prisma.setting.findUnique({ where: { key: 'ollamaBaseUrl' } })
  const val = setting?.value ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  _cachedOllamaBaseUrl = val
  _ollamaBaseUrlCacheExpiry = Date.now() + CACHE_TTL
  return val
}

/**
 * Get the model for the currently active provider.
 */
export async function getActiveModel(): Promise<string> {
  const provider = await getProvider()
  if (provider === 'openai') return getOpenAIModel()
  if (provider === 'ollama') return getOllamaModel()
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
  _cachedOllamaModel = null
  _ollamaModelCacheExpiry = 0
  _cachedOllamaBaseUrl = null
  _ollamaBaseUrlCacheExpiry = 0
}
