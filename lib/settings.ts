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

let _cachedOpenAIAuthMode: AiAuthMode | null = null
let _openAIAuthModeCacheExpiry = 0

let _cachedAnthropicAuthMode: AiAuthMode | null = null
let _anthropicAuthModeCacheExpiry = 0

let _cachedCodexCliModel: string | null = null
let _codexCliModelCacheExpiry = 0

let _cachedClaudeCliModel: string | null = null
let _claudeCliModelCacheExpiry = 0

const CACHE_TTL = 5 * 60 * 1000

export type AiAuthMode = 'api' | 'cli'

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
export async function getProvider(): Promise<'anthropic' | 'openai' | 'minimax'> {
  if (_cachedProvider && Date.now() < _providerCacheExpiry) return _cachedProvider
  const setting = await prisma.setting.findUnique({ where: { key: 'aiProvider' } })
  const val = setting?.value
  _cachedProvider = val === 'openai' ? 'openai' : val === 'minimax' ? 'minimax' : 'anthropic'
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
 * Get the configured MiniMax model from settings (cached for 5 minutes).
 */
export async function getMiniMaxModel(): Promise<string> {
  if (_cachedMiniMaxModel && Date.now() < _miniMaxModelCacheExpiry) return _cachedMiniMaxModel
  const setting = await prisma.setting.findUnique({ where: { key: 'minimaxModel' } })
  _cachedMiniMaxModel = setting?.value ?? 'MiniMax-M2.7'
  _miniMaxModelCacheExpiry = Date.now() + CACHE_TTL
  return _cachedMiniMaxModel
}

async function getAuthMode(key: 'openaiAuthMode' | 'anthropicAuthMode'): Promise<AiAuthMode> {
  const setting = await prisma.setting.findUnique({ where: { key } })
  // CLI is the backwards-compatible default for providers that already
  // supported CLI authentication before this setting was introduced.
  return setting?.value === 'api' ? 'api' : 'cli'
}

export async function getOpenAIAuthMode(): Promise<AiAuthMode> {
  if (_cachedOpenAIAuthMode && Date.now() < _openAIAuthModeCacheExpiry) return _cachedOpenAIAuthMode
  _cachedOpenAIAuthMode = await getAuthMode('openaiAuthMode')
  _openAIAuthModeCacheExpiry = Date.now() + CACHE_TTL
  return _cachedOpenAIAuthMode
}

export async function getAnthropicAuthMode(): Promise<AiAuthMode> {
  if (_cachedAnthropicAuthMode && Date.now() < _anthropicAuthModeCacheExpiry) return _cachedAnthropicAuthMode
  _cachedAnthropicAuthMode = await getAuthMode('anthropicAuthMode')
  _anthropicAuthModeCacheExpiry = Date.now() + CACHE_TTL
  return _cachedAnthropicAuthMode
}

export async function getCodexCliModel(): Promise<string> {
  if (_cachedCodexCliModel !== null && Date.now() < _codexCliModelCacheExpiry) return _cachedCodexCliModel
  const setting = await prisma.setting.findUnique({ where: { key: 'codexCliModel' } })
  _cachedCodexCliModel = setting?.value ?? ''
  _codexCliModelCacheExpiry = Date.now() + CACHE_TTL
  return _cachedCodexCliModel
}

export async function getClaudeCliModel(): Promise<string> {
  if (_cachedClaudeCliModel && Date.now() < _claudeCliModelCacheExpiry) return _cachedClaudeCliModel
  const setting = await prisma.setting.findUnique({ where: { key: 'claudeCliModel' } })
  _cachedClaudeCliModel = setting?.value ?? 'claude-haiku-4-5-20251001'
  _claudeCliModelCacheExpiry = Date.now() + CACHE_TTL
  return _cachedClaudeCliModel
}

export async function getActiveAuthMode(): Promise<AiAuthMode> {
  const provider = await getProvider()
  if (provider === 'openai') return getOpenAIAuthMode()
  if (provider === 'anthropic') return getAnthropicAuthMode()
  return 'api'
}

export async function getActiveCliModel(): Promise<string> {
  const provider = await getProvider()
  if (provider === 'openai') return getCodexCliModel()
  if (provider === 'anthropic') return getClaudeCliModel()
  return ''
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
  _cachedOpenAIAuthMode = null
  _openAIAuthModeCacheExpiry = 0
  _cachedAnthropicAuthMode = null
  _anthropicAuthModeCacheExpiry = 0
  _cachedCodexCliModel = null
  _codexCliModelCacheExpiry = 0
  _cachedClaudeCliModel = null
  _claudeCliModelCacheExpiry = 0
}
