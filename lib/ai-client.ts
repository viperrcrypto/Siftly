import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { resolveAnthropicClient } from './claude-cli-auth'
import { resolveOpenAIClient } from './openai-auth'
import { getProvider, getOpencodeModel } from './settings'
import { getOpencodeApiKey, getOpenaiTokenFromOpencode } from './opencode-auth'

export interface AIContentBlock {
  type: 'text' | 'image'
  text?: string
  source?: { type: 'base64'; media_type: string; data: string }
}

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string | AIContentBlock[]
}

export interface AIResponse {
  text: string
}

export interface AIClient {
  provider: 'anthropic' | 'openai' | 'opencode'
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

    const textBlock = msg.content.find(b => b.type === 'text')
    return { text: textBlock && 'text' in textBlock ? textBlock.text : '' }
  }
}

// Wrap OpenAI SDK
export class OpenAIAIClient implements AIClient {
  provider: 'openai' | 'opencode' = 'openai'
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

  if (provider === 'opencode') {
    // OpenCode uses OpenAI-compatible API
    const apiKey = options.overrideKey ?? options.dbKey ?? getOpencodeApiKey() ?? getOpenaiTokenFromOpencode()
    if (!apiKey) {
      throw new Error('No OpenCode API key found. Check your OpenCode installation or add a key in Settings.')
    }
    // OpenCode uses OpenAI SDK with custom base URL
    const baseURL = process.env.OPENCODE_BASE_URL ?? 'https://api.opencode.ai/v1'
    const client = new OpenAI({ apiKey, baseURL })
    return new OpenAIAIClient(client)
  }

  if (provider === 'openai') {
    const client = resolveOpenAIClient(options)
    return new OpenAIAIClient(client)
  }

  const client = resolveAnthropicClient(options)
  return new AnthropicAIClient(client)
}
