import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  category: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ default: { category: mocks.category } }))

import { DELETE, PATCH } from '@/app/api/categories/[slug]/route'
import { isDefaultCategorySlug, seedDefaultCategories } from '@/lib/categorizer'

const context = { params: Promise.resolve({ slug: 'news' }) }

describe('カテゴリ管理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.category.findUnique.mockResolvedValue({
      id: 'category-1',
      name: 'ニュース・政治',
      slug: 'news',
      color: '#6366f1',
      description: '旧説明',
      isAiGenerated: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      _count: { bookmarks: 12 },
    })
    mocks.category.update.mockResolvedValue({
      id: 'category-1',
      name: 'ニュース・時事',
      slug: 'news',
      color: '#ef4444',
      description: '災害は災害カテゴリを優先する',
      isAiGenerated: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      _count: { bookmarks: 12 },
    })
    mocks.category.findFirst.mockResolvedValue(null)
  })

  it('名前・説明・色を更新してもslugを維持する', async () => {
    const response = await PATCH(new Request('http://localhost/api/categories/news', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'ニュース・時事',
        description: '災害は災害カテゴリを優先する',
        color: '#ef4444',
      }),
    }) as never, context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      category: {
        name: 'ニュース・時事',
        slug: 'news',
        description: '災害は災害カテゴリを優先する',
        color: '#ef4444',
        bookmarkCount: 12,
        canDelete: false,
      },
    })
    expect(mocks.category.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: 'news' },
      data: {
        name: 'ニュース・時事',
        description: '災害は災害カテゴリを優先する',
        color: '#ef4444',
      },
    }))
  })

  it('追加カテゴリを削除できる', async () => {
    mocks.category.findUnique.mockResolvedValue({
      id: 'category-custom',
      name: '一時カテゴリ',
      slug: 'temporary',
      isAiGenerated: true,
    })
    mocks.category.delete.mockResolvedValue({ id: 'category-custom' })

    const response = await DELETE(new Request('http://localhost/api/categories/temporary', {
      method: 'DELETE',
    }) as never, { params: Promise.resolve({ slug: 'temporary' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ deleted: true, slug: 'temporary' })
    expect(mocks.category.delete).toHaveBeenCalledWith({ where: { slug: 'temporary' } })
  })

  it('標準カテゴリは削除せず編集を案内する', async () => {
    const response = await DELETE(new Request('http://localhost/api/categories/news', {
      method: 'DELETE',
    }) as never, context)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: '標準カテゴリは削除できません。名前・説明・色は編集できます。',
    })
    expect(mocks.category.delete).not.toHaveBeenCalled()
  })

  it('災害を標準カテゴリとして維持する', () => {
    expect(isDefaultCategorySlug('disaster')).toBe(true)
  })

  it('既存のカテゴリ名への変更は競合として返す', async () => {
    mocks.category.findFirst.mockResolvedValue({ id: 'another-category' })

    const response = await PATCH(new Request('http://localhost/api/categories/news', {
      method: 'PATCH',
      body: JSON.stringify({ name: '一般', description: '', color: '#64748b' }),
    }) as never, context)

    expect(response.status).toBe(409)
    expect(mocks.category.update).not.toHaveBeenCalled()
  })

  it('作成APIで許可済みの3桁カラーでも編集できる', async () => {
    const response = await PATCH(new Request('http://localhost/api/categories/news', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'ニュース・政治', description: '', color: '#fff' }),
    }) as never, context)

    expect(response.status).toBe(200)
  })

  it('AI分類前の初期化でユーザー編集を上書きしない', async () => {
    mocks.category.findMany.mockResolvedValue([{ slug: 'news' }])
    mocks.category.create.mockResolvedValue({})

    await seedDefaultCategories()

    expect(mocks.category.update).not.toHaveBeenCalled()
    expect(mocks.category.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ slug: 'news' }),
    }))
    expect(mocks.category.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ slug: 'disaster' }),
    }))
  })
})
