import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  db: {
    setting: { findUnique: vi.fn(), upsert: vi.fn() },
    bookmark: { findUnique: vi.fn(), create: vi.fn() },
    mediaItem: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
  enqueue: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ default: mocks.db }))
vi.mock('@/lib/archive/pipeline', () => ({ enqueueIncompleteArchives: mocks.enqueue, ensureArchiveRecord: vi.fn() }))

import { POST } from '@/app/api/import/x-oauth/fetch/route'

describe('X OAuth bookmark fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.db.setting.findUnique.mockImplementation(({ where }: { where: { key: string } }) => Promise.resolve(where.key === 'x_oauth_access_token' ? { value: 'token' } : null))
    mocks.db.bookmark.findUnique.mockResolvedValue(null)
    mocks.db.bookmark.create.mockResolvedValue({ id: 'bookmark-1' })
    mocks.db.$transaction.mockImplementation((fn: (tx: typeof mocks.db) => unknown) => fn(mocks.db))
    mocks.enqueue.mockResolvedValue(undefined)
  })

  it('公式tweet fieldsを要求しnote_tweet本文を保存する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{
        id: '1', text: 'short text', author_id: 'author',
        note_tweet: { text: '長文 https://article.example/a', entities: { urls: [{ url: 'https://t.co/a', expanded_url: 'https://article.example/a' }] } },
        referenced_tweets: [{ type: 'quoted', id: '2' }], conversation_id: '1', in_reply_to_user_id: 'other',
      }], includes: { users: [{ id: 'author', name: 'Alice', username: 'alice' }] } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: '{}' }) as never)
    const requestUrl = new URL(fetchMock.mock.calls[0][0])

    expect(requestUrl.searchParams.get('tweet.fields')).toBe('created_at,author_id,attachments,entities,note_tweet,referenced_tweets,conversation_id,in_reply_to_user_id')
    expect(mocks.db.bookmark.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ text: '長文 https://article.example/a' }) }))
    expect(mocks.enqueue).toHaveBeenCalledWith(['bookmark-1'])
    await expect(response.json()).resolves.toMatchObject({ imported: 1, total: 1 })
  })

  it('10ページで継続tokenを返し、次のrequestで11ページ目まで到達する', async () => {
    const fetchMock = vi.fn()
    for (let index = 1; index <= 11; index++) fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: String(index), text: `tweet-${index}` }], meta: index < 11 ? { next_token: `token-${index}` } : {} }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const first = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: '{}' }) as never)
    await expect(first.json()).resolves.toMatchObject({ imported: 10, truncated: true, nextToken: 'token-10' })
    const second = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: JSON.stringify({ nextToken: 'token-10' }) }) as never)
    await expect(second.json()).resolves.toMatchObject({ imported: 1, total: 1 })
    expect(new URL(fetchMock.mock.calls[10][0]).searchParams.get('pagination_token')).toBe('token-10')
  })

})
