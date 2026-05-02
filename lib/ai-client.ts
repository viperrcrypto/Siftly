import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { resolveAnthropicClient } from './claude-cli-auth'
import { resolveOpenAIClient } from './openai-auth'
import { resolveMiniMaxClient } from './minimax-auth'
import { getProvider } from './settings'

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
  provider: 'anthropic' | 'openai' | 'minimax'
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

    // Self-hosted models (llama-server, vLLM, ollama, etc.) often emit a
    // `<think>...</think>` reasoning block before the actual answer. When
    // the caller's `max_tokens` budget is sized for the answer alone, the
    // reasoning consumes it all and the model never reaches the answer.
    // Give those servers headroom by bumping the budget for OpenAI-compat
    // proxies — controllable via env, or auto-bumped to >= 8192 when an
    // OPENAI_BASE_URL override is in use.
    const isProxied = !!process.env.OPENAI_BASE_URL?.trim()
    const envMin = parseInt(process.env.OPENAI_MIN_MAX_TOKENS ?? '', 10)
    const minTokens = Number.isFinite(envMin) && envMin > 0
      ? envMin
      : isProxied ? 8192 : params.max_tokens
    const max_tokens = Math.max(params.max_tokens, minTokens)

    const completion = await this.sdk.chat.completions.create({
      model: params.model,
      max_tokens,
      messages,
    })

    const msg = completion.choices[0]?.message as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined
    const text = msg?.content ?? ''
    // llama-server (and other OpenAI-compatible servers fronting reasoning
    // models) split the response into `content` and `reasoning_content`.
    // When the model never emits the closing `</think>` token before
    // `max_tokens` runs out, `content` is empty and the actual answer is in
    // `reasoning_content`. Salvage it: brace-balance scan for parseable
    // JSON arrays/objects (longest first) and return that candidate so
    // callers see the JSON the model produced.
    if (!text && msg?.reasoning_content) {
      const r = msg.reasoning_content
      const candidates: string[] = []
      const close: Record<string, string> = { '[': ']', '{': '}' }
      for (const o of ['[', '{']) {
        for (let i = 0; i < r.length; i++) {
          if (r[i] !== o) continue
          let depth = 0
          for (let j = i; j < r.length; j++) {
            if (r[j] === o) depth++
            else if (r[j] === close[o]) depth--
            if (depth === 0) {
              candidates.push(r.slice(i, j + 1))
              break
            }
          }
        }
      }
      candidates.sort((a, b) => b.length - a.length)
      for (const cand of candidates) {
        try {
          JSON.parse(cand)
          return { text: cand }
        } catch {
          // try next candidate
        }
      }
    }
    return { text }
  }
}

// Wrap MiniMax via OpenAI-compatible SDK (temperature clamped to (0, 1])
export class MiniMaxAIClient implements AIClient {
  provider = 'minimax' as const
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
      if (m.role === 'assistant') return { role: 'assistant' as const, content: parts.filter((p): p is OpenAI.ChatCompletionContentPartText => p.type === 'text') }
      return { role: 'user' as const, content: parts }
    })

    const completion = await this.sdk.chat.completions.create({
      model: params.model,
      max_tokens: params.max_tokens,
      messages,
    })

    let text = completion.choices[0]?.message?.content ?? ''
    // Strip thinking tags that MiniMax M2.5+ may include
    text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
    return { text }
  }
}

export async function resolveAIClient(options: {
  overrideKey?: string
  dbKey?: string
} = {}): Promise<AIClient> {
  const provider = await getProvider()

  if (provider === 'minimax') {
    const client = resolveMiniMaxClient(options)
    return new MiniMaxAIClient(client)
  }

  if (provider === 'openai') {
    const client = resolveOpenAIClient(options)
    return new OpenAIAIClient(client)
  }

  const client = resolveAnthropicClient(options)
  return new AnthropicAIClient(client)
}
