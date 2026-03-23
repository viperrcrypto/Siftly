import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MiniMaxAIClient } from '@/lib/ai-client'
import type OpenAI from 'openai'

/**
 * Integration tests for MiniMax as an AI provider in Siftly.
 *
 * These test end-to-end scenarios like categorization and search
 * using the MiniMaxAIClient with mocked SDK responses.
 */

function createMockSDK(response: string): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: response } }],
        }),
      },
    },
  } as unknown as OpenAI
}

describe('MiniMax integration - categorization pipeline', () => {
  it('should handle JSON categorization response', async () => {
    const jsonResponse = JSON.stringify({
      results: [
        { id: '1', categories: [{ slug: 'ai-resources', confidence: 0.9 }] },
        { id: '2', categories: [{ slug: 'dev-tools', confidence: 0.85 }, { slug: 'ai-resources', confidence: 0.7 }] },
      ],
    })
    const client = new MiniMaxAIClient(createMockSDK(jsonResponse))

    const result = await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: 'Categorize these bookmarks...',
        },
      ],
    })

    const parsed = JSON.parse(result.text)
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results[0].categories[0].slug).toBe('ai-resources')
    expect(parsed.results[1].categories).toHaveLength(2)
  })

  it('should strip thinking tags before JSON parsing', async () => {
    const response = '<think>Let me analyze these bookmarks...</think>\n{"results":[{"id":"1","categories":[{"slug":"funny-memes","confidence":0.95}]}]}'
    const client = new MiniMaxAIClient(createMockSDK(response))

    const result = await client.createMessage({
      model: 'MiniMax-M2.5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'Categorize...' }],
    })

    const parsed = JSON.parse(result.text)
    expect(parsed.results[0].categories[0].slug).toBe('funny-memes')
  })

  it('should handle semantic tag generation response', async () => {
    const tagResponse = JSON.stringify({
      results: [
        {
          id: '1',
          tags: ['machine-learning', 'python', 'neural-networks', 'deep-learning'],
          sentiment: 'positive',
          people: ['Andrej Karpathy'],
          companies: ['OpenAI'],
        },
      ],
    })
    const client = new MiniMaxAIClient(createMockSDK(tagResponse))

    const result = await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'Generate semantic tags...' }],
    })

    const parsed = JSON.parse(result.text)
    expect(parsed.results[0].tags).toContain('machine-learning')
    expect(parsed.results[0].people).toContain('Andrej Karpathy')
  })
})

describe('MiniMax integration - search reranking', () => {
  it('should handle search reranking response', async () => {
    const rankResponse = JSON.stringify({
      ranked: [
        { id: '3', score: 0.95, explanation: 'Directly about AI coding tools' },
        { id: '1', score: 0.72, explanation: 'Mentions coding in context' },
      ],
    })
    const client = new MiniMaxAIClient(createMockSDK(rankResponse))

    const result = await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: 'Rerank these search results for query "best AI coding tools"...',
        },
      ],
    })

    const parsed = JSON.parse(result.text)
    expect(parsed.ranked).toHaveLength(2)
    expect(parsed.ranked[0].score).toBeGreaterThan(parsed.ranked[1].score)
  })
})

describe('MiniMax integration - vision analysis', () => {
  it('should handle image analysis with base64 content', async () => {
    const visionResponse = JSON.stringify({
      tags: ['screenshot', 'code-editor', 'dark-theme', 'python', 'terminal'],
      ocr_text: 'def hello_world():',
      scene: 'programming workspace',
    })
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: visionResponse } }],
    })
    const mock = { chat: { completions: { create: createFn } } } as unknown as OpenAI
    const client = new MiniMaxAIClient(mock)

    const result = await client.createMessage({
      model: 'MiniMax-M2.7',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: '/9j/4AAQSkZJRg==',
              },
            },
          ],
        },
      ],
    })

    const parsed = JSON.parse(result.text)
    expect(parsed.tags).toContain('code-editor')
    expect(parsed.ocr_text).toBe('def hello_world():')

    // Verify image was sent as data URL
    const call = createFn.mock.calls[0][0]
    expect(call.messages[0].content[1].image_url.url).toContain('data:image/jpeg;base64,')
  })
})
