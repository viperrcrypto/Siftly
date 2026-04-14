import OpenAI from 'openai'
import prisma from '@/lib/db'

/**
 * Resolve an OpenAI-compatible client for any provider that implements
 * the OpenAI chat completions API.
 *
 * This covers:
 *   - Local LLMs: Ollama (http://localhost:11434/v1), llama.cpp, vLLM, LM Studio
 *   - Cloud APIs: Together AI, Groq, Fireworks, Anyscale, Deepseek, Mistral, etc.
 *   - Self-hosted: text-generation-webui, LocalAI, etc.
 *
 * Auth priority:
 *   1. Override key (from request body)
 *   2. DB-saved key
 *   3. OPENAI_COMPATIBLE_API_KEY env var
 *   4. No key (for local servers that don't require auth)
 *
 * Base URL priority:
 *   1. DB-saved base URL
 *   2. OPENAI_COMPATIBLE_BASE_URL env var
 *   3. Error (base URL is required for this provider)
 */
export async function resolveOpenAICompatibleClient(options: {
  overrideKey?: string
  dbKey?: string
  baseURL?: string
} = {}): Promise<OpenAI> {
  // Resolve base URL
  let baseURL = options.baseURL
  if (!baseURL) {
    const setting = await prisma.setting.findUnique({ where: { key: 'openaiCompatibleBaseUrl' } })
    baseURL = setting?.value?.trim() || undefined
  }
  if (!baseURL) {
    baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL?.trim() || undefined
  }
  if (!baseURL) {
    throw new Error(
      'No base URL configured for OpenAI-compatible provider. ' +
      'Set the endpoint URL in Settings (e.g., http://localhost:11434/v1 for Ollama).'
    )
  }

  // Resolve API key (optional — many local servers don't need one)
  let apiKey: string | undefined

  if (options.overrideKey?.trim()) {
    apiKey = options.overrideKey.trim()
  } else if (options.dbKey?.trim()) {
    apiKey = options.dbKey.trim()
  } else {
    const setting = await prisma.setting.findUnique({ where: { key: 'openaiCompatibleApiKey' } })
    apiKey = setting?.value?.trim() || undefined
  }

  if (!apiKey) {
    apiKey = process.env.OPENAI_COMPATIBLE_API_KEY?.trim() || undefined
  }

  // Use a placeholder key for servers that don't require auth (e.g., Ollama)
  return new OpenAI({
    apiKey: apiKey || 'not-needed',
    baseURL,
  })
}
