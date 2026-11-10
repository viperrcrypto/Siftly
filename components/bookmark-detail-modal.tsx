'use client'

import { useEffect, useCallback, useState } from 'react'
import { X, EyeOff, Eye } from 'lucide-react'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia } from '@/lib/types'

interface BookmarkDetailModalProps {
  bookmark: BookmarkWithMedia
  onClose: () => void
  onHiddenChange?: (id: string, hidden: boolean) => void
}

export default function BookmarkDetailModal({ bookmark, onClose, onHiddenChange }: BookmarkDetailModalProps) {
  const [hidden, setHidden] = useState(bookmark.hidden ?? false)

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleEscape)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [handleEscape])

  function handleToggleHidden() {
    const next = !hidden
    setHidden(next)
    onHiddenChange?.(bookmark.id, next)
    fetch(`/api/bookmarks/${bookmark.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: next }),
    }).catch(() => {
      setHidden(!next)
      onHiddenChange?.(bookmark.id, !next)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl mx-auto mt-16 mb-16 px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-10 right-4 flex items-center gap-1">
          <button
            onClick={handleToggleHidden}
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-full text-sm transition-colors ${hidden ? 'text-indigo-400 hover:text-indigo-300 hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
            title={hidden ? 'Unhide bookmark' : 'Hide bookmark'}
          >
            {hidden ? <Eye size={16} /> : <EyeOff size={16} />}
            <span className="text-xs font-medium">{hidden ? 'Hidden' : 'Hide'}</span>
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <BookmarkCard bookmark={bookmark} onHiddenChange={(id, h) => { setHidden(h); onHiddenChange?.(id, h) }} />
      </div>
    </div>
  )
}
