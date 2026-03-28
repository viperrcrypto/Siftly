'use client'

import React, { useRef, useEffect, useState } from 'react'
import { ExternalLink, Download, Play, Pencil, X, Check, ImageOff, Bookmark, Globe } from 'lucide-react'
import type { BookmarkWithMedia, Category } from '@/lib/types'

// ── URL helpers ────────────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s]+/g
// Twitter always shortens links to t.co — strip these from display text
const TCO_REGEX = /https?:\/\/t\.co\/[^\s]+/g

function extractUrls(text: string): string[] {
  return text.match(URL_REGEX) ?? []
}

/** Always strip t.co shortlinks — Twitter appends them to every tweet with a link or media */
function stripTcoUrls(text: string): string {
  return text.replace(TCO_REGEX, '').trim()
}

// ── Link preview ───────────────────────────────────────────────────────────────

interface LinkPreviewData {
  title: string
  description: string
  image: string
  siteName: string
  domain: string
  url: string
}

// Module-level cache: url → preview data (or null on error)
const previewCache = new Map<string, LinkPreviewData | null>()

function LinkPreview({ url, tweetUrl, tweetId, prominent = false }: { url: string; tweetUrl: string; tweetId?: string; prominent?: boolean }) {
  const [data, setData] = useState<LinkPreviewData | null | 'loading'>('loading')

  useEffect(() => {
    const cacheKey = tweetId ? `${url}:${tweetId}` : url
    if (previewCache.has(cacheKey)) {
      setData(previewCache.get(cacheKey) ?? null)
      return
    }
    let cancelled = false
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}${tweetId ? `&tweetId=${tweetId}` : ''}`)
      .then((r) => r.json())
      .then((d: LinkPreviewData & { error?: string }) => {
        if (cancelled) return
        const result = d.error || !d.title ? null : d
        previewCache.set(cacheKey, result)
        setData(result)
      })
      .catch(() => {
        if (!cancelled) { previewCache.set(cacheKey, null); setData(null) }
      })
    return () => { cancelled = true }
  }, [url, tweetId])

  if (data === 'loading') {
    return (
      <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-800/40 h-16 animate-pulse" />
    )
  }

  // Fallback: OG fetch failed or returned no title — show a minimal link chip
  if (!data) {
    return (
      <a
        href={tweetUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${prominent ? 'mt-1' : 'mt-2'} inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-800/40 hover:border-zinc-700 hover:bg-zinc-800/70 transition-all text-xs text-zinc-400 hover:text-zinc-200 max-w-full overflow-hidden`}
      >
        <Globe size={11} className="shrink-0 text-zinc-600" />
        <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
        <ExternalLink size={10} className="shrink-0 text-zinc-600 ml-auto" />
      </a>
    )
  }

  // X article pages return useless OG data — show a styled "View article" card instead
  const isGenericXArticle = (data.domain === 'x.com' || data.domain === 'twitter.com') && !data.image && !data.description

  const href = data.url || url

  // X article / generic X link with no useful OG data — show a clean "View on X" card
  if (isGenericXArticle) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${prominent ? 'mt-1' : 'mt-2'} flex items-center gap-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800/40 hover:border-zinc-700 hover:bg-zinc-800/70 transition-all group/link px-4 py-3`}
      >
        <div className="w-10 h-10 rounded-lg bg-zinc-700/60 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-zinc-400" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-200 group-hover/link:text-white transition-colors">
            {data.title?.includes('Article') ? 'View Article on X' : data.title || 'View on X'}
          </p>
          <p className="text-xs text-zinc-500 truncate">{data.domain}{data.url ? new URL(data.url).pathname : ''}</p>
        </div>
        <ExternalLink size={14} className="text-zinc-600 group-hover/link:text-zinc-400 transition-colors shrink-0" />
      </a>
    )
  }

  // Prominent mode: vertical layout with large image — used for link-only bookmarks
  if (prominent) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="mt-1 flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800/40 hover:border-zinc-700 hover:bg-zinc-800/70 transition-all group/link"
      >
        {data.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.image}
            alt=""
            className="w-full h-40 object-cover border-b border-zinc-800"
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <div className="flex flex-col px-3 py-2.5 min-w-0 gap-1">
          <p className="text-sm font-semibold text-zinc-200 line-clamp-2 group-hover/link:text-white transition-colors leading-snug">
            {data.title}
          </p>
          {data.description && (
            <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed">
              {data.description}
            </p>
          )}
          <div className="flex items-center gap-1 mt-0.5">
            <Globe size={10} className="text-zinc-600 shrink-0" />
            <span className="text-[10px] text-zinc-600 truncate">
              {data.siteName || data.domain}
            </span>
          </div>
        </div>
      </a>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-2 flex overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800/40 hover:border-zinc-700 hover:bg-zinc-800/70 transition-all group/link"
    >
      {data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.image}
          alt=""
          className="w-24 h-full object-cover shrink-0 border-r border-zinc-800"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <div className="flex flex-col justify-center px-3 py-2.5 min-w-0 gap-0.5">
        <p className="text-xs font-semibold text-zinc-200 line-clamp-1 group-hover/link:text-white transition-colors">
          {data.title}
        </p>
        {data.description && (
          <p className="text-xs text-zinc-500 line-clamp-2 leading-snug">
            {data.description}
          </p>
        )}
        <div className="flex items-center gap-1 mt-1">
          <Globe size={10} className="text-zinc-600 shrink-0" />
          <span className="text-[10px] text-zinc-600 truncate">
            {data.siteName || data.domain}
          </span>
        </div>
      </div>
    </a>
  )
}

// Module-level cache so all cards share the same fetched list
let cachedCategories: Category[] | null = null
let cacheFetchPromise: Promise<Category[]> | null = null

async function fetchAllCategories(): Promise<Category[]> {
  if (cachedCategories !== null) return cachedCategories
  if (cacheFetchPromise !== null) return cacheFetchPromise

  cacheFetchPromise = fetch('/api/categories')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch categories: ${res.status}`)
      return res.json()
    })
    .then((data: { categories: Category[] }) => {
      cachedCategories = data.categories
      cacheFetchPromise = null
      return data.categories
    })
    .catch((err) => {
      cacheFetchPromise = null
      throw err
    })

  return cacheFetchPromise
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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Author Avatar ──────────────────────────────────────────────────────────────

function AuthorAvatar({ name, handle, avatarUrl }: { name: string; handle: string; avatarUrl?: string | null }) {
  const [imgFailed, setImgFailed] = useState(false)
  const bg = stringToColor(handle)
  const initials = getInitials(name)

  // Prefer stored avatar URL, fall back to unavatar.io for any Twitter handle
  const cleanHandle = handle.replace(/^@/, '')
  const src = avatarUrl ?? (cleanHandle && cleanHandle !== 'unknown' ? `https://unavatar.io/twitter/${cleanHandle}` : null)

  if (src && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className="flex-shrink-0 w-8 h-8 rounded-full object-cover select-none"
        loading="lazy"
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <div
      className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold select-none"
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

// ── Top media slot (no margins — rendered full-bleed at top of card) ────────

function proxyUrl(url: string): string {
  return `/api/media?url=${encodeURIComponent(url)}`
}

/** Returns true if the URL points to an actual video file (not a thumbnail JPEG) */
function isVideoUrl(url: string): boolean {
  return url.includes('video.twimg.com') || url.includes('.mp4')
}

/** Derive a thumbnail URL from a Twitter video URL */
function deriveVideoThumb(url: string): string | null {
  // amplify_video/{id}/vid/... → pbs.twimg.com/amplify_video_thumb/{id}/img/default.jpg
  const amplify = url.match(/video\.twimg\.com\/amplify_video\/(\d+)/)
  if (amplify) return `https://pbs.twimg.com/amplify_video_thumb/${amplify[1]}/img/default.jpg`
  // ext_tw_video/{id}/pu/vid/... → pbs.twimg.com/ext_tw_video_thumb/{id}/pu/img/default.jpg
  const ext = url.match(/video\.twimg\.com\/ext_tw_video\/(\d+)/)
  if (ext) return `https://pbs.twimg.com/ext_tw_video_thumb/${ext[1]}/pu/img/default.jpg`
  // tweet_video/{id}.mp4 → pbs.twimg.com/tweet_video_thumb/{id}.jpg
  const tweet = url.match(/video\.twimg\.com\/tweet_video\/([^.]+)\.mp4/)
  if (tweet) return `https://pbs.twimg.com/tweet_video_thumb/${tweet[1]}.jpg`
  return null
}

interface TopMediaSlotProps {
  item: BookmarkWithMedia['mediaItems'][number]
  tweetUrl: string
}

/** Consistent overlay shown on top of a thumbnail — used for both video and X-link cases */
function MediaOverlay({ label, icon }: { label?: string; icon?: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/50 transition-colors">
      {icon ?? (
        <span className="px-3 py-1.5 rounded-full bg-black/60 text-white text-xs font-semibold backdrop-blur-sm">
          {label ?? 'Watch on X ↗'}
        </span>
      )}
    </div>
  )
}

/** Placeholder shown when no thumbnail is available — styled as a proper video preview */
function MediaPlaceholder({ onClick, label, isVideo }: { onClick?: (e: React.MouseEvent) => void; label: string; isVideo?: boolean }) {
  if (isVideo) {
    return (
      <div
        className="h-48 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-zinc-800 to-zinc-900 hover:from-zinc-750 hover:to-zinc-850 transition-colors cursor-pointer select-none"
        onClick={onClick}
      >
        <div className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center border border-white/10">
          <Play size={22} className="text-white fill-white ml-1" />
        </div>
        <span className="text-xs text-zinc-400 font-medium">{label}</span>
      </div>
    )
  }
  return (
    <div
      className="h-48 flex items-center justify-center bg-zinc-800/70 hover:bg-zinc-800 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <span className="px-3 py-1.5 rounded-full bg-zinc-700 text-zinc-300 text-xs font-semibold">
        {label}
      </span>
    </div>
  )
}

function TopMediaSlot({ item, tweetUrl }: TopMediaSlotProps) {
  const [imgError, setImgError] = useState(false)

  // ── Photo: show inline ─────────────────────────────────────────────────────
  if (item.type === 'photo') {
    if (imgError) {
      return (
        <a href={tweetUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <div className="h-48 flex flex-col items-center justify-center gap-2 bg-zinc-800/50 hover:bg-zinc-800/70 transition-colors">
            <ImageOff size={18} className="text-zinc-600" />
            <span className="px-3 py-1.5 rounded-full bg-zinc-700 text-zinc-400 text-xs font-semibold">
              View on X ↗
            </span>
          </div>
        </a>
      )
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={proxyUrl(item.url)}
        alt="Bookmark media"
        className="w-full h-48 object-cover"
        loading="lazy"
        onError={() => setImgError(true)}
      />
    )
  }

  // ── Video/GIF: always redirect to tweet — can't play locally ──────────────
  // Guard: thumbnailUrl that is itself a video URL is not usable as an <img>
  const rawThumb = item.thumbnailUrl ?? null
  const thumb = rawThumb && !isVideoUrl(rawThumb) ? rawThumb
    : (!isVideoUrl(item.url) ? item.url : deriveVideoThumb(item.url))

  return (
    <a href={tweetUrl} target="_blank" rel="noopener noreferrer" className="relative block" onClick={(e) => e.stopPropagation()}>
      {thumb && !imgError ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={proxyUrl(thumb)}
            alt=""
            className="w-full h-48 object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
          <MediaOverlay />
        </div>
      ) : (
        <MediaPlaceholder label="Watch on X ↗" isVideo={item.type === 'video'} />
      )}
    </a>
  )
}

// ── Category chip ──────────────────────────────────────────────────────────────

function CategoryChip({
  category,
  onRemove,
}: {
  category: BookmarkWithMedia['categories'][number]
  onRemove?: (id: string) => void
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: `${category.color}18`,
        color: category.color,
        border: `1px solid ${category.color}30`,
      }}
    >
      <Bookmark
        size={9}
        className="flex-shrink-0"
        style={{ color: category.color, fill: category.color }}
      />
      {category.name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove(category.id)
          }}
          className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
          aria-label={`Remove ${category.name}`}
        >
          <X size={10} />
        </button>
      )}
    </span>
  )
}

// ── Inline category editor ─────────────────────────────────────────────────────

interface CategoryEditorProps {
  bookmarkId: string
  currentCategoryIds: Set<string>
  onSave: (newIds: string[]) => void
  onClose: () => void
}

function CategoryEditor({ bookmarkId, currentCategoryIds, onSave, onClose }: CategoryEditorProps) {
  const [allCategories, setAllCategories] = useState<Category[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set(currentCategoryIds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchAllCategories()
      .then((cats) => {
        if (!cancelled) { setAllCategories(cats); setLoading(false) }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load categories')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (editorRef.current && !editorRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  function toggleCategory(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const ids = Array.from(selected)
    try {
      const res = await fetch(`/api/bookmarks/${bookmarkId}/categories`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryIds: ids }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      onSave(ids)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={editorRef}
      className="absolute left-0 right-0 bottom-full mb-2 z-50 bg-zinc-900 border border-zinc-700 rounded-xl p-3 shadow-2xl shadow-black/50"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wide">Edit categories</p>

      {loading && <p className="text-xs text-zinc-600 py-2">Loading…</p>}

      {!loading && allCategories.length === 0 && (
        <p className="text-xs text-zinc-600 py-2">No categories found.</p>
      )}

      {!loading && allCategories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {allCategories.map((cat) => {
            const isSelected = selected.has(cat.id)
            return (
              <button
                key={cat.id}
                onClick={() => toggleCategory(cat.id)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all"
                style={
                  isSelected
                    ? { backgroundColor: `${cat.color}33`, color: cat.color, border: `1px solid ${cat.color}88` }
                    : { backgroundColor: 'transparent', color: '#71717a', border: '1px solid #3f3f46' }
                }
              >
                {isSelected
                  ? <Check size={10} className="flex-shrink-0" />
                  : <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 opacity-40" style={{ backgroundColor: cat.color }} />
                }
                {cat.name}
              </button>
            )
          })}
        </div>
      )}

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-zinc-800">
        <button onClick={onClose} className="px-2.5 py-1 text-xs rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Main card ──────────────────────────────────────────────────────────────────

interface BookmarkCardProps {
  bookmark: BookmarkWithMedia
}

export default function BookmarkCard({ bookmark }: BookmarkCardProps) {
  const [categories, setCategories] = useState(bookmark.categories)
  const [expanded, setExpanded] = useState(false)
  const [editingCategories, setEditingCategories] = useState(false)

  const tweetUrl = (bookmark.authorHandle && bookmark.authorHandle !== 'unknown')
    ? `https://twitter.com/${bookmark.authorHandle}/status/${bookmark.tweetId}`
    : `https://twitter.com/i/web/status/${bookmark.tweetId}`
  const firstMedia = bookmark.mediaItems[0] ?? null
  const hasMedia = bookmark.mediaItems.length > 0
  const dateStr = formatDate(bookmark.tweetCreatedAt ?? bookmark.importedAt ?? null)
  const isKnownAuthor = bookmark.authorHandle !== 'unknown'

  // Always strip t.co shortlinks from display text — Twitter appends them to every tweet
  const tcoUrls = bookmark.text.match(TCO_REGEX) ?? []
  const cleanText = stripTcoUrls(bookmark.text)
  // Show link preview only when there's no real media attached
  const previewUrl = !hasMedia && tcoUrls.length > 0 ? tcoUrls[tcoUrls.length - 1] : null

  const TEXT_LIMIT = 280
  const isLong = cleanText.length > TEXT_LIMIT
  const displayText = expanded || !isLong ? cleanText : cleanText.slice(0, TEXT_LIMIT)

  const currentCategoryIds = new Set(categories.map((c) => c.id))

  function handleRemoveCategory(categoryId: string) {
    const newIds = categories.filter((c) => c.id !== categoryId).map((c) => c.id)
    setCategories((prev) => prev.filter((c) => c.id !== categoryId))
    fetch(`/api/bookmarks/${bookmark.id}/categories`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryIds: newIds }),
    }).catch(() => { setCategories(bookmark.categories) })
  }

  function handleSaveCategories(newIds: string[]) {
    const allCats = cachedCategories ?? []
    const newCategories = newIds
      .map((id) => {
        const found = allCats.find((c) => c.id === id)
        if (!found) return null
        return { id: found.id, name: found.name, slug: found.slug, color: found.color, confidence: 1.0 }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
    setCategories(newCategories)
    setEditingCategories(false)
  }

  function handleDownload() {
    if (!firstMedia) return
    const a = document.createElement('a')
    a.href = `/api/media?url=${encodeURIComponent(firstMedia.url)}&download=1`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // Only show download if media is a photo or a real video (not a thumbnail JPEG stored as video)
  const isDownloadable = firstMedia !== null &&
    (firstMedia.type === 'photo' || isVideoUrl(firstMedia.url))

  return (
    <div className="group relative bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-zinc-700 hover:shadow-xl hover:shadow-black/30 transition-all duration-200 flex flex-col flex-1">

      {/* Top media — full bleed, no padding */}
      {firstMedia && (
        <div className="border-b border-zinc-800/60 rounded-t-2xl overflow-hidden shrink-0">
          <TopMediaSlot item={firstMedia} tweetUrl={tweetUrl} />
        </div>
      )}

      {/* Card body */}
      <div className="p-4 flex flex-col flex-1">

        {/* Author row + hover actions */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {isKnownAuthor && (
              <AuthorAvatar name={bookmark.authorName} handle={bookmark.authorHandle} />
            )}
            <div className="min-w-0">
              {isKnownAuthor && (
                <p className="text-sm font-semibold text-zinc-100 truncate leading-tight">
                  {bookmark.authorName}
                </p>
              )}
              <p className="text-xs text-zinc-500 truncate">
                {isKnownAuthor ? `@${bookmark.authorHandle}` : dateStr}
              </p>
            </div>
          </div>

          {/* Actions — visible on hover */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
            {isDownloadable && (
              <button
                onClick={handleDownload}
                className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                title="Download media"
              >
                <Download size={13} />
              </button>
            )}
            <a
              href={tweetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Open on X"
            >
              <ExternalLink size={13} />
            </a>
          </div>
        </div>

        {/* Tweet text */}
        <div className={`flex-1 ${previewUrl && !displayText ? '' : 'min-h-[4.5rem]'}`}>
          {displayText.length > 0 && (
            <p className="text-sm text-zinc-200 leading-relaxed">
              {displayText}
              {isLong && !expanded && (
                <span>
                  {'… '}
                  <button
                    onClick={() => setExpanded(true)}
                    className="text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    more
                  </button>
                </span>
              )}
              {isLong && expanded && (
                <span>
                  {' '}
                  <button
                    onClick={() => setExpanded(false)}
                    className="text-zinc-500 hover:text-zinc-400 transition-colors text-xs"
                  >
                    less
                  </button>
                </span>
              )}
            </p>
          )}
          {!displayText && !firstMedia && !previewUrl && (
            <p className="text-xs text-zinc-700 italic">No text content</p>
          )}
          {previewUrl && (
            <LinkPreview url={previewUrl} tweetUrl={tweetUrl} tweetId={bookmark.tweetId} prominent={!displayText} />
          )}
        </div>

        {/* Footer: categories + meta — fixed two-row structure keeps all cards aligned */}
        <div className="relative mt-auto pt-3 border-t border-zinc-800/50">
          {/* Row 1: chips + date — consistent height across all cards */}
          <div className="flex items-center gap-1.5 flex-wrap min-h-[1.5rem]">
            {categories.map((cat) => (
              <CategoryChip key={cat.id} category={cat} onRemove={handleRemoveCategory} />
            ))}
            {categories.length === 0 && (
              <span className="text-xs text-zinc-700 italic">Uncategorized</span>
            )}
            {isKnownAuthor && dateStr && (
              <span className="ml-auto text-xs text-zinc-600 flex-shrink-0">
                {dateStr}
              </span>
            )}
          </div>

          {/* Row 2: edit button — always in DOM to reserve space; invisible until hover */}
          <div className="mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setEditingCategories((v) => !v)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs text-zinc-700 hover:text-zinc-300 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all"
              title="Edit categories"
            >
              <Pencil size={10} />
              edit
            </button>
          </div>

          {editingCategories && (
            <CategoryEditor
              bookmarkId={bookmark.id}
              currentCategoryIds={currentCategoryIds}
              onSave={handleSaveCategories}
              onClose={() => setEditingCategories(false)}
            />
          )}
        </div>

      </div>
    </div>
  )
}
