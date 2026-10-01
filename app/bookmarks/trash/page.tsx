'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCcw, Trash2 } from 'lucide-react'
import type { BookmarkWithMedia, BookmarksResponse } from '@/lib/types'
import { useLanguage } from '@/components/language-provider'
import { uiLocale, uiText } from '@/lib/i18n'

export default function TrashPage() {
  const PAGE_SIZE = 100
  const { language } = useLanguage()
  const [bookmarks, setBookmarks] = useState<BookmarkWithMedia[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/bookmarks?trash=true&sort=newest&page=${page}&limit=${PAGE_SIZE}`)
      .then(async (response) => {
        const data = await response.json() as BookmarksResponse & { error?: string }
        if (!response.ok) throw new Error(data.error ?? 'Failed to load trash')
        return data
      })
      .then((data) => { if (!cancelled) { setBookmarks(data.bookmarks); setTotal(data.total); setError(null) } })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : uiText(language, 'ゴミ箱の読み込みに失敗しました', 'Failed to load trash'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [language, page])

  async function restore(id: string) {
    setPendingId(id)
    setError(null)
    try {
      const response = await fetch(`/api/bookmarks/${encodeURIComponent(id)}/restore`, { method: 'POST' })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Failed to restore bookmark')
      if (page > 1 && bookmarks.length === 1 && bookmarks[0]?.id === id) setPage((previous) => previous - 1)
      setBookmarks((previous) => previous.filter((bookmark) => bookmark.id !== id))
      setTotal((previous) => Math.max(0, previous - 1))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : uiText(language, '復元に失敗しました', 'Failed to restore bookmark'))
    } finally {
      setPendingId(null)
    }
  }

  async function permanentlyDelete(id: string) {
    if (!window.confirm(uiText(
      language,
      'このブックマークを完全に削除しますか？\nこの操作は元に戻せません。関連データも削除されます。',
      'Permanently delete this bookmark?\nThis cannot be undone and its related data will also be deleted.',
    ))) return

    setPendingId(id)
    setError(null)
    try {
      const response = await fetch(`/api/bookmarks/${encodeURIComponent(id)}/permanent`, { method: 'DELETE' })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Failed to permanently delete bookmark')
      if (page > 1 && bookmarks.length === 1 && bookmarks[0]?.id === id) setPage((previous) => previous - 1)
      setBookmarks((previous) => previous.filter((bookmark) => bookmark.id !== id))
      setTotal((previous) => Math.max(0, previous - 1))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : uiText(language, '完全削除に失敗しました', 'Failed to permanently delete bookmark'))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">{uiText(language, 'ゴミ箱', 'Trash')}</h1>
          <p className="mt-1 text-sm text-zinc-500">{uiText(language, '復元するか、完全に削除できます。', 'Restore bookmarks or permanently delete them.')}</p>
        </div>
        <Link href="/bookmarks" className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
          <ArrowLeft size={14} /> {uiText(language, '一覧へ戻る', 'Back to bookmarks')}
        </Link>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {loading && <p className="text-sm text-zinc-500">{uiText(language, '読み込み中…', 'Loading…')}</p>}
      {!loading && bookmarks.length === 0 && <p className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">{uiText(language, 'ゴミ箱は空です。', 'Trash is empty.')}</p>}
      <div className="space-y-3">
        {bookmarks.map((bookmark) => {
          const pending = pendingId === bookmark.id
          return (
            <article key={bookmark.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-sm text-zinc-200 whitespace-pre-wrap">{bookmark.text || uiText(language, '本文なし', 'No text')}</p>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-500">
                <span>{bookmark.authorHandle !== 'unknown' ? `@${bookmark.authorHandle}` : bookmark.authorName}{bookmark.deletedAt ? ` · ${uiText(language, '削除日', 'Trashed')} ${new Date(bookmark.deletedAt).toLocaleDateString(uiLocale(language))}` : ''}</span>
                <div className="flex gap-2">
                  <button onClick={() => void restore(bookmark.id)} disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50">
                    <RotateCcw size={13} /> {uiText(language, '復元', 'Restore')}
                  </button>
                  <button onClick={() => void permanentlyDelete(bookmark.id)} disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 px-2.5 py-1.5 text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                    <Trash2 size={13} /> {uiText(language, '完全に削除', 'Delete permanently')}
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
      {total > PAGE_SIZE && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((previous) => Math.max(1, previous - 1))}
            disabled={page <= 1 || loading}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            <ChevronLeft size={15} /> {uiText(language, '前へ', 'Previous')}
          </button>
          <span className="text-sm text-zinc-500">{uiText(language, `${page} / ${Math.ceil(total / PAGE_SIZE)}ページ`, `Page ${page} of ${Math.ceil(total / PAGE_SIZE)}`)}</span>
          <button
            onClick={() => setPage((previous) => Math.min(Math.ceil(total / PAGE_SIZE), previous + 1))}
            disabled={page >= Math.ceil(total / PAGE_SIZE) || loading}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            {uiText(language, '次へ', 'Next')} <ChevronRight size={15} />
          </button>
        </div>
      )}
    </main>
  )
}
