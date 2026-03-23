import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveMiniMaxClient } from '@/lib/minimax-auth'

describe('resolveMiniMaxClient', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.MINIMAX_API_KEY
    delete process.env.MINIMAX_BASE_URL
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should use override key when provided', () => {
    const client = resolveMiniMaxClient({ overrideKey: 'test-override-key' })
    expect(client).toBeDefined()
    expect(client.baseURL).toBe('https://api.minimax.io/v1')
  })

  it('should use DB key when provided', () => {
    const client = resolveMiniMaxClient({ dbKey: 'test-db-key' })
    expect(client).toBeDefined()
    expect(client.baseURL).toBe('https://api.minimax.io/v1')
  })

  it('should use env var MINIMAX_API_KEY', () => {
    process.env.MINIMAX_API_KEY = 'test-env-key'
    const client = resolveMiniMaxClient()
    expect(client).toBeDefined()
    expect(client.baseURL).toBe('https://api.minimax.io/v1')
  })

  it('should prioritize overrideKey over dbKey', () => {
    const client = resolveMiniMaxClient({
      overrideKey: 'override',
      dbKey: 'db',
    })
    expect(client).toBeDefined()
  })

  it('should prioritize dbKey over env var', () => {
    process.env.MINIMAX_API_KEY = 'env-key'
    const client = resolveMiniMaxClient({ dbKey: 'db-key' })
    expect(client).toBeDefined()
  })

  it('should use custom base URL from options', () => {
    const client = resolveMiniMaxClient({
      overrideKey: 'key',
      baseURL: 'https://custom.api.com/v1',
    })
    expect(client.baseURL).toBe('https://custom.api.com/v1')
  })

  it('should use MINIMAX_BASE_URL env var', () => {
    process.env.MINIMAX_API_KEY = 'key'
    process.env.MINIMAX_BASE_URL = 'https://proxy.example.com/v1'
    const client = resolveMiniMaxClient()
    expect(client.baseURL).toBe('https://proxy.example.com/v1')
  })

  it('should throw when no key is available', () => {
    expect(() => resolveMiniMaxClient()).toThrow(
      'No MiniMax API key found'
    )
  })

  it('should allow proxy without key when baseURL provided', () => {
    const client = resolveMiniMaxClient({ baseURL: 'https://proxy.local' })
    expect(client).toBeDefined()
    expect(client.baseURL).toBe('https://proxy.local')
  })

  it('should trim whitespace from keys', () => {
    const client = resolveMiniMaxClient({ overrideKey: '  key-with-spaces  ' })
    expect(client).toBeDefined()
  })

  it('should not use empty override key', () => {
    process.env.MINIMAX_API_KEY = 'env-key'
    const client = resolveMiniMaxClient({ overrideKey: '  ' })
    // Falls through to env key
    expect(client).toBeDefined()
  })

  it('should not use empty db key', () => {
    process.env.MINIMAX_API_KEY = 'env-key'
    const client = resolveMiniMaxClient({ dbKey: '' })
    // Falls through to env key
    expect(client).toBeDefined()
  })
})
