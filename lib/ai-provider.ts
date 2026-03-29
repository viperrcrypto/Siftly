export type AIProvider = 'anthropic' | 'openai' | 'openai-compatible'

export function getApiKeySettingKey(provider: AIProvider): 'anthropicApiKey' | 'openaiApiKey' | 'openaiCompatApiKey' {
  switch (provider) {
    case 'anthropic':
      return 'anthropicApiKey'
    case 'openai-compatible':
      return 'openaiCompatApiKey'
    case 'openai':
    default:
      return 'openaiApiKey'
  }
}

export function getModelSettingKey(provider: AIProvider): 'anthropicModel' | 'openaiModel' | 'openaiCompatModel' {
  switch (provider) {
    case 'anthropic':
      return 'anthropicModel'
    case 'openai-compatible':
      return 'openaiCompatModel'
    case 'openai':
    default:
      return 'openaiModel'
  }
}

export function supportsCli(provider: AIProvider): boolean {
  return provider !== 'openai-compatible'
}

export function isTextOnlyProvider(provider: AIProvider): boolean {
  return provider === 'openai-compatible'
}
