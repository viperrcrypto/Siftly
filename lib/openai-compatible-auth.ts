import OpenAI from 'openai'

export function resolveOpenAICompatibleClient(options: {
  overrideKey?: string
  dbKey?: string
  overrideBaseURL?: string
  dbBaseURL?: string
} = {}): OpenAI {
  const baseURL = options.overrideBaseURL?.trim()
    || options.dbBaseURL?.trim()
    || process.env.OPENAI_COMPAT_BASE_URL?.trim()

  if (!baseURL) {
    throw new Error('No OpenAI-compatible base URL found. Add one in Settings or set OPENAI_COMPAT_BASE_URL.')
  }

  const apiKey = options.overrideKey?.trim()
    || options.dbKey?.trim()
    || process.env.OPENAI_COMPAT_API_KEY?.trim()
    || 'proxy'

  return new OpenAI({ apiKey, baseURL })
}
