import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MiniMaxAIClient } from '@/lib/ai-client'
import type OpenAI from 'openai'

function createMockOpenAI(responseContent: string): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseContent } }],
        }),
      },
    },
  } as unknown as OpenAI
}

describe('MiniMaxAIClient', () => {
  it('should have provider set to minimax', () => {
    const mock = createMockOpenAI('hello')
    const client = new MiniMaxAIClient(mock)
    expect(client.provider).toBe('minimax')
  })

  it('should return text from completion', async () => {
    const mock = createMockOpenAI('Hello from MiniMax')
    const client = new MiniMaxAIClient(mock)

    const result = await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(result.text).toBe('Hello from MiniMax')
  })

  it('should strip thinking tags from response', async () => {
    const mock = createMockOpenAI(
      '<think>internal reasoning here</think>\nActual answer'
    )
    const client = new MiniMaxAIClient(mock)

    const result = await client.createMessage({
      model: 'MiniMax-M2.5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'test' }],
    })

    expect(result.text).toBe('Actual answer')
    expect(result.text).not.toContain('<think>')
  })

  it('should strip multi-line thinking tags', async () => {
    const mock = createMockOpenAI(
      '<think>\nline1\nline2\nline3\n</think>\n\nClean output'
    )
    const client = new MiniMaxAIClient(mock)

    const result = await client.createMessage({
      model: 'MiniMax-M2.5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'test' }],
    })

    expect(result.text).toBe('Clean output')
  })

  it('should handle empty response', async () => {
    const mock = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: null } }],
          }),
        },
      },
    } as unknown as OpenAI
    const client = new MiniMaxAIClient(mock)

    const result = await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(result.text).toBe('')
  })

  it('should handle empty choices', async () => {
    const mock = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({ choices: [] }),
        },
      },
    } as unknown as OpenAI
    const client = new MiniMaxAIClient(mock)

    const result = await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(result.text).toBe('')
  })

  it('should pass model and max_tokens to SDK', async () => {
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
    })
    const mock = { chat: { completions: { create: createFn } } } as unknown as OpenAI
    const client = new MiniMaxAIClient(mock)

    await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'test' }],
    })

    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'MiniMax-M2.7',
        max_tokens: 512,
      })
    )
  })

  it('should convert string messages correctly', async () => {
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
    })
    const mock = { chat: { completions: { create: createFn } } } as unknown as OpenAI
    const client = new MiniMaxAIClient(mock)

    await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 100,
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
        { role: 'user', content: 'how are you?' },
      ],
    })

    const call = createFn.mock.calls[0][0]
    expect(call.messages).toHaveLength(3)
    expect(call.messages[0]).toEqual({ role: 'user', content: 'hello' })
    expect(call.messages[1]).toEqual({ role: 'assistant', content: 'hi there' })
    expect(call.messages[2]).toEqual({ role: 'user', content: 'how are you?' })
  })

  it('should convert image content blocks to base64 data URLs', async () => {
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'I see an image' } }],
    })
    const mock = { chat: { completions: { create: createFn } } } as unknown as OpenAI
    const client = new MiniMaxAIClient(mock)

    await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgo=',
              },
            },
          ],
        },
      ],
    })

    const call = createFn.mock.calls[0][0]
    const msg = call.messages[0]
    expect(msg.role).toBe('user')
    expect(msg.content).toHaveLength(2)
    expect(msg.content[0]).toEqual({ type: 'text', text: 'What is this?' })
    expect(msg.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
    })
  })

  it('should filter non-text parts from assistant messages', async () => {
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
    })
    const mock = { chat: { completions: { create: createFn } } } as unknown as OpenAI
    const client = new MiniMaxAIClient(mock)

    await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 100,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'some text' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'abc' },
            },
          ],
        },
      ],
    })

    const call = createFn.mock.calls[0][0]
    const msg = call.messages[0]
    expect(msg.role).toBe('assistant')
    // Only text parts should remain for assistant
    expect(msg.content.every((p: { type: string }) => p.type === 'text')).toBe(true)
  })

  it('should handle text content block with missing text', async () => {
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
    })
    const mock = { chat: { completions: { create: createFn } } } as unknown as OpenAI
    const client = new MiniMaxAIClient(mock)

    await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text' }],
        },
      ],
    })

    const call = createFn.mock.calls[0][0]
    expect(call.messages[0].content[0].text).toBe('')
  })

  it('should handle response with no thinking tags (pass-through)', async () => {
    const mock = createMockOpenAI('Regular response without thinking')
    const client = new MiniMaxAIClient(mock)

    const result = await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'test' }],
    })

    expect(result.text).toBe('Regular response without thinking')
  })

  it('should propagate SDK errors', async () => {
    const mock = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('API rate limit')),
        },
      },
    } as unknown as OpenAI
    const client = new MiniMaxAIClient(mock)

    await expect(
      client.createMessage({
        model: 'MiniMax-M2.7',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      })
    ).rejects.toThrow('API rate limit')
  })
})
