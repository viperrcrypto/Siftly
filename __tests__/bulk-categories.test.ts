import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bookmark: { findMany: vi.fn() },
  category: { findMany: vi.fn() },
  bookmarkCategory: { findMany: vi.fn(), create: vi.fn() },
  categoryFeedback: { upsert: vi.fn() },
  transaction: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ default: {
  bookmark: mocks.bookmark, category: mocks.category, bookmarkCategory: mocks.bookmarkCategory,
  categoryFeedback: mocks.categoryFeedback, $transaction: mocks.transaction,
} }))

import { POST } from '@/app/api/bookmarks/categories/bulk/route'

describe('カテゴリ一括追加', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.bookmark.findMany.mockResolvedValue([{ id: 'bookmark-1' }, { id: 'bookmark-2' }])
    mocks.category.findMany.mockResolvedValue([{ id: 'category-1' }])
    mocks.bookmarkCategory.findMany.mockResolvedValue([{ bookmarkId: 'bookmark-1', categoryId: 'category-1' }])
    mocks.bookmarkCategory.create.mockResolvedValue({})
    mocks.categoryFeedback.upsert.mockResolvedValue({})
    mocks.transaction.mockImplementation((operation: (tx: Omit<typeof mocks, 'transaction'>) => unknown) => operation({
      bookmark: mocks.bookmark, category: mocks.category, bookmarkCategory: mocks.bookmarkCategory, categoryFeedback: mocks.categoryFeedback,
    }))
  })

  it('既存linkはno-opにし、missing pairだけincludeとしてtransactionで追加する', async () => {
    const response = await POST(new Request('http://localhost/api/bookmarks/categories/bulk', {
      method: 'POST', body: JSON.stringify({ bookmarkIds: [' bookmark-1 ', 'bookmark-2', 'bookmark-2'], categoryIds: ['category-1'] }),
    }) as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ bookmarkCount: 2, categoryCount: 1, addedPairs: 1 })
    expect(mocks.bookmarkCategory.create).toHaveBeenCalledWith({ data: { bookmarkId: 'bookmark-2', categoryId: 'category-1', confidence: 0.8 } })
    expect(mocks.categoryFeedback.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { bookmarkId: 'bookmark-2', categoryId: 'category-1', action: 'include' } }))
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function))
  })

  it.each([
    {}, { bookmarkIds: [], categoryIds: ['category-1'] }, { bookmarkIds: ['bookmark-1'], categoryIds: [''] },
  ])('不正入力は書き込まない: %j', async (body) => {
    const response = await POST(new Request('http://localhost/api/bookmarks/categories/bulk', { method: 'POST', body: JSON.stringify(body) }) as never)
    expect(response.status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
