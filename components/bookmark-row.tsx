'use client'

import { useState } from 'react'
import { Image, Play } from 'lucide-react'
import type { BookmarkWithMedia } from '@/lib/types'

// ── Helpers ─────────────────────────────────────────────────────────────────

const TCO_REGEX = /https?:\/\/t\.co\/[^\s]+/g

function stripTcoUrls(text: string): string {
  return text.replace(TCO_REGEX, '').trim()
}

function isVideoUrl(url: string): boolean {
  return url.includes('video.twimg.com') || url.includes('.mp4')
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

const COLOR_PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
]

function stringToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Avatar ───────────────────────────────────────────────────────────────────

function MiniAvatar({ name, handle }: { name: string; handle: string }) {
  const [imgFailed, setImgFailed] = useState(false)
  const bg = stringToColor(handle)
  const initials = getInitials(name)
  const cleanHandle = handle.replace(/^@/, '')
  const src = cleanHandle && cleanHandle !== 'unknown'
    ? `https://unavatar.io/twitter/${cleanHandle}`
    : null

  if (src && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className="shrink-0 w-6 h-6 rounded-full object-cover select-none"
        loading="lazy"
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <div
      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold select-none"
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

// ── Media Indicator ──────────────────────────────────────────────────────────

function MediaIndicator({ item }: { item: BookmarkWithMedia['mediaItems'][number] }) {
  const isVideo = item.type === 'video' || isVideoUrl(item.url)
  const thumb = item.thumbnailUrl && !isVideoUrl(item.thumbnailUrl)
    ? item.thumbnailUrl
    : (!isVideoUrl(item.url) ? item.url : null)

  if (thumb) {
    return (
      <div className="relative shrink-0 w-8 h-8 rounded overflow-hidden border border-zinc-700/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumb}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
        {isVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Play size={8} className="text-white fill-white" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="shrink-0 w-8 h-8 rounded flex items-center justify-center border border-zinc-700/50 bg-zinc-800/60">
      {isVideo
        ? <Play size={10} className="text-zinc-500" />
        : <Image size={10} className="text-zinc-500" />
      }
    </div>
  )
}

// ── Main Row ─────────────────────────────────────────────────────────────────

interface BookmarkRowProps {
  bookmark: BookmarkWithMedia
  onClick: (bookmark: BookmarkWithMedia) => void
}

export default function BookmarkRow({ bookmark, onClick }: BookmarkRowProps) {
  const isKnownAuthor = bookmark.authorHandle !== 'unknown'
  const cleanText = stripTcoUrls(bookmark.text)
  const dateStr = formatDate(bookmark.tweetCreatedAt ?? bookmark.importedAt ?? null)
  const firstMedia = bookmark.mediaItems[0] ?? null

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(bookmark)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(bookmark) } }}
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-zinc-800/60 transition-colors group"
    >
      {/* Avatar */}
      {isKnownAuthor ? (
        <MiniAvatar name={bookmark.authorName} handle={bookmark.authorHandle} />
      ) : (
        <div className="shrink-0 w-6 h-6 rounded-full bg-zinc-700" />
      )}

      {/* Author — fixed width */}
      <div className="shrink-0 w-36 min-w-0">
        {isKnownAuthor ? (
          <>
            <p className="text-xs font-semibold text-zinc-200 truncate leading-tight">
              {bookmark.authorName}
            </p>
            <p className="text-[10px] text-zinc-500 truncate leading-tight">
              @{bookmark.authorHandle}
            </p>
          </>
        ) : (
          <p className="text-xs text-zinc-500 truncate">Unknown</p>
        )}
      </div>

      {/* Tweet text snippet — flex-1 */}
      <p className="flex-1 min-w-0 text-xs text-zinc-300 truncate">
        {cleanText || <span className="text-zinc-600 italic">No text</span>}
      </p>

      {/* Category dots */}
      {bookmark.categories.length > 0 && (
        <div className="shrink-0 flex items-center gap-1.5">
          {bookmark.categories.map((cat) => (
            <span
              key={cat.id}
              className="relative group/dot shrink-0 cursor-default"
            >
              <span
                className="block w-2 h-2 rounded-full"
                style={{ backgroundColor: cat.color }}
              />
              <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-200 whitespace-nowrap opacity-0 group-hover/dot:opacity-100 transition-opacity duration-100 z-10">
                {cat.name}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Media indicator */}
      {firstMedia ? (
        <MediaIndicator item={firstMedia} />
      ) : (
        <div className="shrink-0 w-8" />
      )}

      {/* Date */}
      <span className="shrink-0 w-20 text-right text-[10px] text-zinc-500 tabular-nums">
        {dateStr}
      </span>
    </div>
  )
}
