import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { complete, getModel, type Model } from '@mariozechner/pi-ai'
import prisma from '@/lib/db'
import { resolveAnthropicClient } from './claude-cli-auth'
import { resolveOpenAIClient } from './openai-auth'
import { getPiAiModel, getPiAiProviderId, getProvider } from './settings'

export interface AIContentBlock {
  type: 'text' | 'image'
  text?: string
  source?: { type: 'base64'; media_type: string; data: string }
}

type PiAiCompat = Record<string, unknown>

function safeJsonParseObject(raw: string | undefined | null): Record<string, unknown> | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

function resolvePiAiModelFromConfig(options: {
  providerId: string | null
  modelId: string | null
  baseUrl: string | null
  headersJson: string | null
  compatJson: string | null
}): Model<any> {
  const providerId = (options.providerId ?? 'openai').trim() || 'openai'
  const modelId = (options.modelId ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini'

  const baseUrl = options.baseUrl?.trim()

  // If no custom baseUrl/headers/compat are set, prefer pi-ai's built-in registry.
  if (!baseUrl && !options.headersJson && !options.compatJson) {
    const model = getModel(providerId as any, modelId as any) as any
    if (!model) {
      throw new Error(
        `pi-ai model not found for provider="${providerId}" model="${modelId}". Update Settings → AI Provider → pi-ai (Provider ID / Model ID), or use a Base URL for an OpenAI-compatible endpoint.`
      )
    }
    return model
  }

  const headers = safeJsonParseObject(options.headersJson) ?? undefined
  const compat = safeJsonParseObject(options.compatJson) as PiAiCompat | null

  // If no custom baseUrl is provided but headers/compat are, start from pi-ai's registry
  // and overlay the extra fields.
  if (!baseUrl) {
    const base = getModel(providerId as any, modelId as any) as any
    if (!base) {
      throw new Error(
        `pi-ai model not found for provider="${providerId}" model="${modelId}". Update Settings → AI Provider → pi-ai (Provider ID / Model ID), or set Base URL if you're using an OpenAI-compatible endpoint.`
      )
    }
    return {
      ...base,
      ...(headers ? { headers: headers as Record<string, string> } : {}),
      ...(compat ? { compat: compat as any } : {}),
    } as any
  }

  // Default to OpenAI-compatible API when using a custom baseUrl.
  // This supports many providers like Ollama/vLLM/LM Studio/LiteLLM.
  const custom: Model<'openai-completions'> = {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: 'openai',
    baseUrl,
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    ...(headers ? { headers: headers as Record<string, string> } : {}),
    ...(compat ? { compat: compat as any } : {}),
  }

  return custom as any
}

export class PiAiClient implements AIClient {
  provider = 'pi-ai' as const
  constructor(
    private model: Model<any>,
    private apiKey: string | undefined,
  ) {}

  private getValidatedModel(): Model<any> {
    const m = this.model as any
    if (!m) {
      throw new Error('pi-ai model is not configured. Go to Settings → AI Provider → pi-ai.')
    }
    if (!m.provider) {
      throw new Error('pi-ai model is invalid (missing provider). Check Settings → AI Provider → pi-ai.')
    }
    return this.model
  }

  async createMessage(params: { model: string; max_tokens: number; messages: AIMessage[] }): Promise<AIResponse> {
    const model = this.getValidatedModel()
    const baseUrl = (model as any).baseUrl as string | undefined
    const apiKey = this.apiKey || (baseUrl ? 'local' : undefined)
    const messages = params.messages.map((m) => {
      const content = typeof m.content === 'string'
        ? [{ type: 'text' as const, text: m.content }]
        : m.content.map((b) => {
            if (b.type === 'image' && b.source) {
              return { type: 'image' as const, data: b.source.data, mimeType: b.source.media_type }
            }
            return { type: 'text' as const, text: b.text ?? '' }
          })

      return {
        role: m.role,
        content,
      }
    })

    const response = await complete(
      model,
      {
        messages: messages as any,
      } as any,
      {
        apiKey,
        maxTokens: params.max_tokens,
      } as any,
    )

    if (typeof (response as any) === 'string') {
      return { text: response as any }
    }

    const contentBlocks: any[] = Array.isArray((response as any).content) ? (response as any).content : []
    const text = contentBlocks
      .map((b: any) => {
        if (!b) return ''
        if (typeof b.text === 'string') return b.text
        if (typeof b.output_text === 'string') return b.output_text
        if (typeof b.thinking === 'string') return b.thinking
        if (typeof b.refusal === 'string') return b.refusal
        if (typeof b.content === 'string') return b.content
        return ''
      })
      .filter((t: string) => t.trim().length > 0)
      .join('')

    const errorMessage = typeof (response as any).errorMessage === 'string' ? (response as any).errorMessage : ''
    const topLevelText = typeof (response as any).text === 'string' ? (response as any).text : ''
    const topLevelOutputText = typeof (response as any).output_text === 'string' ? (response as any).output_text : ''
    const finalText = text || topLevelText || topLevelOutputText || errorMessage || JSON.stringify(response)

    return {
      text: finalText,
    }
  }
}

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string | AIContentBlock[]
}

export interface AIResponse {
  text: string
}

export interface AIClient {
  provider: 'anthropic' | 'openai' | 'pi-ai'
  createMessage(params: {
    model: string
    max_tokens: number
    messages: AIMessage[]
  }): Promise<AIResponse>
}

// Wrap Anthropic SDK
export class AnthropicAIClient implements AIClient {
  provider = 'anthropic' as const
  constructor(private sdk: Anthropic) {}

  async createMessage(params: { model: string; max_tokens: number; messages: AIMessage[] }): Promise<AIResponse> {
    const messages = params.messages.map(m => {
      if (typeof m.content === 'string') {
        return { role: m.role as 'user' | 'assistant', content: m.content }
      }
      const blocks = m.content.map(b => {
        if (b.type === 'image' && b.source) {
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: b.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: b.source.data,
            },
          }
        }
        return { type: 'text' as const, text: b.text ?? '' }
      })
      return { role: m.role as 'user' | 'assistant', content: blocks }
    })

    const msg = await this.sdk.messages.create({
      model: params.model,
      max_tokens: params.max_tokens,
      messages,
    })

    const textBlock = msg.content.find((b: Anthropic.ContentBlock) => b.type === 'text')
    return { text: textBlock && 'text' in textBlock ? textBlock.text : '' }
  }
}

// Wrap OpenAI SDK
export class OpenAIAIClient implements AIClient {
  provider = 'openai' as const
  constructor(private sdk: OpenAI) {}

  async createMessage(params: { model: string; max_tokens: number; messages: AIMessage[] }): Promise<AIResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = params.messages.map((m): OpenAI.ChatCompletionMessageParam => {
      if (typeof m.content === 'string') {
        if (m.role === 'assistant') return { role: 'assistant' as const, content: m.content }
        return { role: 'user' as const, content: m.content }
      }
      const parts: OpenAI.ChatCompletionContentPart[] = m.content.map(b => {
        if (b.type === 'image' && b.source) {
          return {
            type: 'image_url' as const,
            image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
          }
        }
        return { type: 'text' as const, text: b.text ?? '' }
      })
      if (m.role === 'assistant') return { role: 'assistant' as const, content: parts.map(p => p.type === 'text' ? p : p).filter((p): p is OpenAI.ChatCompletionContentPartText => p.type === 'text') }
      return { role: 'user' as const, content: parts }
    })

    const completion = await this.sdk.chat.completions.create({
      model: params.model,
      max_tokens: params.max_tokens,
      messages,
    })

    return { text: completion.choices[0]?.message?.content ?? '' }
  }
}

export async function resolveAIClient(options: {
  overrideKey?: string
  dbKey?: string
} = {}): Promise<AIClient> {
  const provider = await getProvider()

  if (provider === 'openai') {
    const client = resolveOpenAIClient(options)
    return new OpenAIAIClient(client)
  }

  if (provider === 'pi-ai') {
    const providerId = await getPiAiProviderId()
    const modelId = await getPiAiModel()

    const [piAiKey, piAiBaseUrl, piAiHeaders, piAiCompat] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'piAiApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'piAiBaseUrl' } }),
      prisma.setting.findUnique({ where: { key: 'piAiHeaders' } }),
      prisma.setting.findUnique({ where: { key: 'piAiCompat' } }),
    ])

    const baseUrl =
      piAiBaseUrl?.value?.trim() ||
      process.env.PI_AI_BASE_URL?.trim() ||
      process.env.PIAI_BASE_URL?.trim() ||
      null

    const headersJson =
      piAiHeaders?.value ||
      process.env.PI_AI_HEADERS?.trim() ||
      null

    const compatJson =
      piAiCompat?.value ||
      process.env.PI_AI_COMPAT?.trim() ||
      null

    const model = resolvePiAiModelFromConfig({ providerId, modelId, baseUrl, headersJson, compatJson })
    const apiKey =
      options.overrideKey?.trim() ||
      options.dbKey?.trim() ||
      piAiKey?.value?.trim() ||
      process.env.PI_AI_API_KEY?.trim() ||
      process.env.PIAI_API_KEY?.trim() ||
      undefined

    return new PiAiClient(model, apiKey)
  }

  const client = resolveAnthropicClient(options)
  return new AnthropicAIClient(client)
}
