import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const mocks = vi.hoisted(() => ({
  update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), delete: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ default: { bookmark: mocks } }))

import { DELETE } from '@/app/api/bookmarks/[id]/route'
import { DELETE as PERMANENT_DELETE } from '@/app/api/bookmarks/[id]/permanent/route'
import { POST as RESTORE } from '@/app/api/bookmarks/[id]/restore/route'
import { deleteBookmark } from '@/components/bookmark-card'

const context = (id: string) => ({ params: Promise.resolve({ id }) })

describe('ブックマークのゴミ箱', () => {
  beforeEach(() => vi.clearAllMocks())

  it('空白IDを拒否して削除しない', async () => {
    const response = await DELETE(new Request('http://localhost/api/bookmarks/ ', { method: 'DELETE' }) as never, context('  '))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Bookmark ID is required' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('IDをtrimして関連データを残すゴミ箱移動を行う', async () => {
    mocks.update.mockResolvedValue({ id: 'bookmark-1' })

    const response = await DELETE(new Request('http://localhost/api/bookmarks/bookmark-1', { method: 'DELETE' }) as never, context(' bookmark-1 '))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ trashed: true, id: 'bookmark-1' })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'bookmark-1' }, data: { deletedAt: expect.any(Date) },
    })
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('Prisma P2025を404へ変換する', async () => {
    mocks.update.mockRejectedValue({ code: 'P2025' })

    const response = await DELETE(new Request('http://localhost/api/bookmarks/missing', { method: 'DELETE' }) as never, context('missing'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Bookmark not found' })
  })

  it('予期しないDBエラーを500へ変換する', async () => {
    mocks.update.mockRejectedValue(new Error('database unavailable'))

    const response = await DELETE(new Request('http://localhost/api/bookmarks/bookmark-1', { method: 'DELETE' }) as never, context('bookmark-1'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to move bookmark to trash' })
  })

  it('復元でdeletedAtだけをnullにしてIDと関連データを保持する', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 })

    const response = await RESTORE(new Request('http://localhost/api/bookmarks/bookmark-1/restore', { method: 'POST' }) as never, context(' bookmark-1 '))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ restored: true, id: 'bookmark-1' })
    expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'bookmark-1', deletedAt: { not: null } }, data: { deletedAt: null },
    })
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('完全削除はゴミ箱内のブックマークだけにPrisma deleteを使う', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 })

    const response = await PERMANENT_DELETE(new Request('http://localhost/api/bookmarks/bookmark-1/permanent', { method: 'DELETE' }) as never, context('bookmark-1'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ deleted: true, id: 'bookmark-1' })
    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id: 'bookmark-1', deletedAt: { not: null } } })
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('UIはキャンセル時にAPIを呼ばず、成功時にDELETEとcallbackを実行する', async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ deleted: true }) })
    const onDeleted = vi.fn()
    const reload = vi.fn()
    vi.stubGlobal('window', { confirm, location: { reload } })
    vi.stubGlobal('fetch', fetch)

    await expect(deleteBookmark('bookmark-1', 'en', onDeleted)).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()

    await expect(deleteBookmark('bookmark-1', 'en', onDeleted)).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/bookmarks/bookmark-1', { method: 'DELETE' })
    expect(onDeleted).toHaveBeenCalledExactlyOnceWith('bookmark-1')

    await expect(deleteBookmark('bookmark-2', 'en')).resolves.toBeNull()
    expect(reload).toHaveBeenCalledExactlyOnceWith()
  })

  it('UIは失敗を返し、削除中のカテゴリ編集を無効化する', async () => {
    vi.stubGlobal('window', { confirm: vi.fn().mockReturnValue(true), location: { reload: vi.fn() } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: vi.fn().mockResolvedValue({ error: 'Delete failed' }) }))

    await expect(deleteBookmark('bookmark-1', 'en')).resolves.toBe('Delete failed')

    const card = readFileSync('components/bookmark-card.tsx', 'utf8')
    const modal = readFileSync('components/bookmark-detail-modal.tsx', 'utf8')
    const page = readFileSync('app/bookmarks/page.tsx', 'utf8')

    expect(card).toContain('window.confirm(uiText(')
    expect(card).toContain('Its related data is kept and it can be restored from trash.')
    expect(card).toContain("fetch(`/api/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' })")
    expect(card).toContain('if (onDeleted) onDeleted(id)')
    expect(card).toContain('else window.location.reload()')
    expect(card).toContain('role="alert"')
    expect(card).toContain('disabled={categoryWritePending || deletePending}')
    expect(card).toContain("uiText(language, 'ゴミ箱へ移動', 'Move to trash')")
    expect(card).not.toContain('Trash2')
    expect(modal).toContain('<BookmarkCard bookmark={bookmark} onDeleted={onDeleted} />')
    expect(page).toContain('setBookmarks((previous) => previous.filter((bookmark) => bookmark.id !== id))')
    expect(page).toContain('next.delete(id)')
    expect(page).toContain('previous?.id === id ? null : previous')
  })

  it('schemaは完全削除時だけ関連データをcascadeする契約を定義する', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')

    expect(schema).toMatch(/model ArchiveRecord[\s\S]*?bookmark\s+Bookmark @relation\(fields: \[bookmarkId\], references: \[id\], onDelete: Cascade\)/)
    expect(schema).toMatch(/model BookmarkCategory[\s\S]*?bookmark\s+Bookmark @relation\(fields: \[bookmarkId\], references: \[id\], onDelete: Cascade\)/)
    expect(schema).toMatch(/model CategoryFeedback[\s\S]*?bookmark\s+Bookmark @relation\(fields: \[bookmarkId\], references: \[id\], onDelete: Cascade\)/)
    expect(schema).toMatch(/model MediaItem[\s\S]*?bookmark\s+Bookmark @relation\(fields: \[bookmarkId\], references: \[id\], onDelete: Cascade\)/)
    expect(schema).toContain('deletedAt       DateTime?')
  })

  it('通常の一覧・検索・分類・統計・アーカイブはゴミ箱を除外する', () => {
    for (const path of [
      'app/api/bookmarks/route.ts', 'app/api/search/ai/route.ts', 'app/api/categorize/route.ts',
      'app/api/stats/route.ts', 'app/api/archive/[bookmarkId]/route.ts',
    ]) {
      expect(readFileSync(path, 'utf8')).toContain('deletedAt:')
    }
    expect(readFileSync('lib/categorizer.ts', 'utf8')).toContain('where: { bookmark: { deletedAt: null } }')
    expect(readFileSync('lib/twitter-api.ts', 'utf8')).toContain('自動同期では、明示的にゴミ箱へ移した項目を復元しない。')
  })

  it('ゴミ箱一覧は100件を超える場合にページ移動できる', () => {
    const trash = readFileSync('app/bookmarks/trash/page.tsx', 'utf8')
    expect(trash).toContain('page=${page}&limit=${PAGE_SIZE}')
    expect(trash).toContain('Math.ceil(total / PAGE_SIZE)')
    expect(trash).toContain('setPage((previous) => Math.max(1, previous - 1))')
    expect(trash).toContain('bookmarks.length === 1 && bookmarks[0]?.id === id')
  })
})
