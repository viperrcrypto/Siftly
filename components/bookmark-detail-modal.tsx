'use client'

import { useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia } from '@/lib/types'

interface BookmarkDetailModalProps {
  bookmark: BookmarkWithMedia
  onClose: () => void
}

export default function BookmarkDetailModal({ bookmark, onClose }: BookmarkDetailModalProps) {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl mx-auto mt-16 mb-16 px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-10 right-4 p-2 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <BookmarkCard bookmark={bookmark} />
      </div>
    </div>
  )
}
