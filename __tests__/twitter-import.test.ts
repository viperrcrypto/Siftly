import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  db: {
    bookmark: { findUnique: vi.fn(), create: vi.fn() },
    mediaItem: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
  enqueue: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ default: mocks.db }))
vi.mock('@/lib/archive/pipeline', () => ({ enqueueIncompleteArchives: mocks.enqueue, ensureArchiveRecord: vi.fn() }))

import { POST } from '@/app/api/import/twitter/route'

describe('cookie Twitter import', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.db.bookmark.findUnique.mockResolvedValue(null)
    mocks.db.bookmark.create.mockResolvedValue({ id: 'bookmark-1' })
    mocks.db.$transaction.mockImplementation((fn: (tx: typeof mocks.db) => unknown) => fn(mocks.db))
    mocks.enqueue.mockResolvedValue(undefined)
  })

  it('繰り返されたcursorでページングを停止する', async () => {
    const page = {
      data: { bookmark_timeline_v2: { timeline: { instructions: [{
        type: 'TimelineAddEntries', entries: [
          { content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result: { rest_id: 'tweet-1', legacy: { full_text: 'text' }, core: { user_results: { result: { legacy: { screen_name: 'a', name: 'A' } } } } } } } } },
          { content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'same-cursor' } },
        ],
      }] } } },
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => page })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/twitter', {
      method: 'POST', body: JSON.stringify({ authToken: 'auth', ct0: 'csrf' }),
    }) as never)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(response.json()).resolves.toMatchObject({ imported: 2, skipped: 0 })
  })

  it('20ページ上限では継続cursorを返し、次のリクエストで続きを取得できる', async () => {
    const page = (id: number, cursor: string | null) => ({
      data: { bookmark_timeline_v2: { timeline: { instructions: [{
        type: 'TimelineAddEntries', entries: [
          { content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result: { rest_id: `tweet-${id}`, legacy: { full_text: 'text' }, core: { user_results: { result: { legacy: { screen_name: 'a', name: 'A' } } } } } } } } },
          ...(cursor ? [{ content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: cursor } }] : []),
        ],
      }] } } },
    })
    const fetchMock = vi.fn()
    for (let index = 1; index <= 21; index++) fetchMock.mockResolvedValueOnce({ ok: true, json: async () => page(index, index < 21 ? `cursor-${index}` : null) })
    vi.stubGlobal('fetch', fetchMock)

    const first = await POST(new Request('http://localhost/api/import/twitter', {
      method: 'POST', body: JSON.stringify({ authToken: 'auth', ct0: 'csrf' }),
    }) as never)
    await expect(first.json()).resolves.toMatchObject({ imported: 20, truncated: true, nextCursor: 'cursor-20' })

    const second = await POST(new Request('http://localhost/api/import/twitter', {
      method: 'POST', body: JSON.stringify({ authToken: 'auth', ct0: 'csrf', cursor: 'cursor-20' }),
    }) as never)
    await expect(second.json()).resolves.toMatchObject({ imported: 1 })
    expect(fetchMock.mock.calls[20][0]).toContain(encodeURIComponent('cursor-20'))
  })
})
