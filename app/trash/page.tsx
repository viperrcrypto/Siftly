'use client'

import { useState, useEffect, useCallback } from 'react'
import { Trash2, RotateCcw, X, Loader2 } from 'lucide-react'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia, BookmarksResponse } from '@/lib/types'

const PAGE_SIZE = 20

/** Tell the nav badges the trash/inbox counts changed. */
function notifyTrashDelta(delta: number) {
  window.dispatchEvent(new CustomEvent('siftly:trash-change', { detail: { delta } }))
}
function notifyInboxDelta(delta: number) {
  window.dispatchEvent(new CustomEvent('siftly:inbox-change', { detail: { delta } }))
}

function TrashItem({
  bookmark,
  onRemoved,
}: {
  bookmark: BookmarkWithMedia
  onRemoved: (id: string) => void
}) {
  const [busy, setBusy] = useState<'restore' | 'purge' | null>(null)

  async function restore() {
    if (busy) return
    setBusy('restore')
    onRemoved(bookmark.id)
    notifyTrashDelta(-1)
    notifyInboxDelta(1) // restored items go back to the inbox
    try {
      const res = await fetch(`/api/bookmarks/${bookmark.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triageState: 'inbox' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('Restore failed:', err)
      notifyTrashDelta(1)
      notifyInboxDelta(-1)
      alert('Could not restore this bookmark. Please try again.')
    }
  }

  async function purge() {
    if (busy) return
    if (!confirm('Permanently delete this bookmark? This cannot be undone.')) return
    setBusy('purge')
    onRemoved(bookmark.id)
    notifyTrashDelta(-1)
    try {
      const res = await fetch(`/api/bookmarks/${bookmark.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('Permanent delete failed:', err)
      notifyTrashDelta(1)
      alert('Could not delete this bookmark. Please try again.')
    }
  }

  return (
    <div className="flex flex-col gap-2 opacity-90">
      <BookmarkCard bookmark={bookmark} />
      <div className="flex items-center gap-2">
        <button
          onClick={restore}
          disabled={!!busy}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 disabled:opacity-50 transition-all"
          title="Restore — send back to the inbox"
        >
          {busy === 'restore' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          Restore
        </button>
        <button
          onClick={purge}
          disabled={!!busy}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-sm font-medium text-red-300 hover:bg-red-500/20 hover:border-red-500/40 disabled:opacity-50 transition-all"
          title="Delete forever — permanently remove"
        >
          {busy === 'purge' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
          Delete forever
        </button>
      </div>
    </div>
  )
}

export default function TrashPage() {
  const [bookmarks, setBookmarks] = useState<BookmarkWithMedia[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [emptying, setEmptying] = useState(false)

  const fetchPage = useCallback(async (p: number) => {
    const res = await fetch(`/api/bookmarks?triageState=deleted&sort=newest&page=${p}&limit=${PAGE_SIZE}`)
    if (!res.ok) throw new Error('Failed to fetch trash')
    const data: BookmarksResponse = await res.json()
    return data
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchPage(1)
      .then((data) => {
        if (cancelled) return
        setBookmarks(data.bookmarks)
        setTotal(data.total)
        setPage(1)
      })
      .catch((err) => {
        if (cancelled) return
        console.error(err)
        setBookmarks([])
        setTotal(0)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchPage])

  function handleRemoved(id: string) {
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
    setTotal((prev) => Math.max(0, prev - 1))
  }

  async function loadMore() {
    setLoadingMore(true)
    try {
      const next = page + 1
      const data = await fetchPage(next)
      setBookmarks((prev) => {
        const seen = new Set(prev.map((b) => b.id))
        return [...prev, ...data.bookmarks.filter((b) => !seen.has(b.id))]
      })
      setTotal(data.total)
      setPage(next)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMore(false)
    }
  }

  async function emptyTrash() {
    if (emptying || bookmarks.length === 0) return
    if (!confirm(`Permanently delete all ${total} bookmark${total !== 1 ? 's' : ''} in the trash? This cannot be undone.`)) return
    setEmptying(true)
    // Delete every currently-loaded item; loop pages until trash is empty.
    try {
      let current = bookmarks
      while (current.length > 0) {
        const results = await Promise.allSettled(
          current.map((b) => fetch(`/api/bookmarks/${b.id}`, { method: 'DELETE' }))
        )
        const purged = current.filter((_, i) => results[i].status === 'fulfilled').length
        if (purged > 0) notifyTrashDelta(-purged)
        const data = await fetchPage(1)
        current = data.bookmarks
        setBookmarks(data.bookmarks)
        setTotal(data.total)
        if (data.bookmarks.length === 0) break
      }
    } catch (err) {
      console.error('Empty trash failed:', err)
      alert('Could not empty the trash completely. Please try again.')
    } finally {
      setEmptying(false)
    }
  }

  const hasMore = bookmarks.length < total

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur-lg border-b border-zinc-800/60">
        <div className="px-6 md:px-8 py-4 flex items-center gap-3 max-w-3xl mx-auto w-full">
          <div className="w-9 h-9 rounded-xl bg-zinc-800/60 border border-zinc-700/50 flex items-center justify-center shrink-0">
            <Trash2 size={16} className="text-zinc-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-zinc-100 leading-tight">Trash</h1>
            <p className="text-xs text-zinc-500">
              {loading ? 'Loading…' : total > 0 ? `${total.toLocaleString()} deleted` : 'Empty'}
            </p>
          </div>
          {!loading && bookmarks.length > 0 && (
            <button
              onClick={emptyTrash}
              disabled={emptying}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-sm font-medium text-red-300 hover:bg-red-500/20 hover:border-red-500/40 disabled:opacity-50 transition-all shrink-0"
            >
              {emptying ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Empty trash
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 md:px-8 py-6 max-w-3xl mx-auto w-full">
        {loading && (
          <div className="flex items-center justify-center py-24 text-zinc-600">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {!loading && bookmarks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-5">
              <Trash2 size={26} className="text-zinc-700" />
            </div>
            <h3 className="text-base font-semibold text-zinc-400 mb-2">Trash is empty</h3>
            <p className="text-zinc-600 text-sm max-w-xs">
              Bookmarks you delete from the inbox land here. Restore them or clear them out for good.
            </p>
          </div>
        )}

        {!loading && bookmarks.length > 0 && (
          <div className="flex flex-col gap-6">
            {bookmarks.map((bookmark) => (
              <TrashItem key={bookmark.id} bookmark={bookmark} onRemoved={handleRemoved} />
            ))}
          </div>
        )}

        {!loading && hasMore && (
          <div className="flex justify-center mt-8">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-xl transition-colors border border-zinc-800 disabled:opacity-50"
            >
              {loadingMore && <Loader2 size={14} className="animate-spin" />}
              Load more ({total - bookmarks.length} left)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
