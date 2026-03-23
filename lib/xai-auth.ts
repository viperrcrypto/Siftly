import OpenAI from 'openai'

/**
 * Resolve an xAI client, preferring override key, then DB key.
 * Assumes xAI API is OpenAI-compatible (adjust if not).
 */
export function resolveXAIClient(options: {
  overrideKey?: string
  dbKey?: string
} = {}): OpenAI {
  const key = options.overrideKey || options.dbKey || process.env.XAI_API_KEY

  if (!key) {
    throw new Error('No xAI API key found. Set XAI_API_KEY env var or save in settings.')
  }

  // Assuming xAI uses OpenAI-compatible API; replace with xAI SDK if available
  return new OpenAI({
    apiKey: key,
    baseURL: 'https://api.x.ai/v1', // Example; confirm xAI's base URL
  })
}
