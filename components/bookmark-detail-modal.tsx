'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { X, RotateCw } from 'lucide-react'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia } from '@/lib/types'

interface BookmarkDetailModalProps {
  bookmark: BookmarkWithMedia
  onClose: () => void
}

type ArchiveState = NonNullable<BookmarkWithMedia['archive']>
type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function recordItems(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function archiveState(body: unknown, current: ArchiveState | null, fallbackStatus = 'pending'): ArchiveState {
  const data = isRecord(body) ? body : {}
  const lastError = data.lastError
  return {
    status: stringValue(data.status) ?? fallbackStatus,
    attemptCount: typeof data.attemptCount === 'number' ? data.attemptCount : current?.attemptCount ?? 0,
    lastError: typeof lastError === 'string' || lastError === null ? lastError : current?.lastError ?? null,
    updatedAt: stringValue(data.updatedAt) ?? new Date().toISOString(),
    result: isRecord(data.result) ? data.result : current?.result ?? {},
  }
}

function errorMessage(body: unknown, fallback: string): string {
  return isRecord(body) ? stringValue(body.error) ?? fallback : fallback
}

function pauseForPoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Polling aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Polling aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 1_000)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function stage(result: JsonRecord, key: string): JsonRecord | undefined {
  const value = result[key]
  return isRecord(value) ? value : undefined
}

function archiveSummary(result: JsonRecord): Array<{ label: string; value: string }> {
  const thread = stage(result, 'thread')
  const sources = stage(result, 'sources')
  const clips = stage(result, 'clips')
  const threadNote = stage(result, 'threadNote')
  const media = stage(result, 'media')
  const sourceItems = recordItems(sources?.items)
  const mediaItems = recordItems(media?.items)
  const mediaState = mediaItems.length === 0 ? 'なし' : mediaItems.some((item) => item.status === 'failed') ? '失敗' : mediaItems.some((item) => item.status === 'success') ? 'ダウンロード済み' : 'なし'
  return [
    { label: 'Thread', value: `${thread?.status === 'success' ? '解決済み' : '未解決'}（${recordItems(thread?.tweets).length}件）` },
    { label: 'Sources', value: `${sourceItems.length}件` },
    { label: 'Clipped', value: `${recordItems(clips?.items).filter((item) => item.status === 'success').length}件成功` },
    { label: 'Obsidian thread note', value: !threadNote ? '未実行' : threadNote.status === 'success' ? '保存済み' : '失敗' },
    { label: 'X native media', value: mediaState },
    { label: 'External video', value: `${sourceItems.filter((item) => item.sourceType === 'external_video').length}件` },
  ]
}

export default function BookmarkDetailModal({ bookmark, onClose }: BookmarkDetailModalProps) {
  const [archiving, setArchiving] = useState(false)
  const [archive, setArchive] = useState<ArchiveState | null>(bookmark.archive ?? null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const mounted = useRef(true)
  const activeArchive = useRef<AbortController | null>(null)
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

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      activeArchive.current?.abort()
      activeArchive.current = null
    }
  }, [])

  async function retryArchive() {
    if (activeArchive.current) return
    const controller = new AbortController()
    activeArchive.current = controller
    setArchiving(true)
    setArchiveError(null)
    try {
      const response = await fetch(`/api/archive/${bookmark.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ background: true }), signal: controller.signal })
      const body: unknown = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(errorMessage(body, 'アーカイブを開始できませんでした'))
      let next = archiveState(body, archive)
      if (mounted.current) setArchive(next)
      while (mounted.current && !controller.signal.aborted && (next.status === 'pending' || next.status === 'processing')) {
        await pauseForPoll(controller.signal)
        const state = await fetch(`/api/archive/${bookmark.id}`, { signal: controller.signal })
        const stateBody: unknown = await state.json().catch(() => ({}))
        if (!state.ok) throw new Error(errorMessage(stateBody, 'アーカイブ状態を取得できませんでした'))
        next = archiveState(stateBody, next)
        if (mounted.current) setArchive(next)
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setArchiveError(error instanceof Error ? error.message : 'アーカイブに失敗しました')
    } finally {
      if (activeArchive.current === controller) activeArchive.current = null
      if (mounted.current) setArchiving(false)
    }
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
        <button
          onClick={onClose}
          className="absolute -top-10 right-4 p-2 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <BookmarkCard bookmark={bookmark} />
        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-400" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <span>アーカイブ: <strong className="text-zinc-200">{archive?.status ?? '未実行'}</strong></span>
            <button onClick={() => void retryArchive()} disabled={archiving} className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50" aria-label="アーカイブを再実行">
              <RotateCw size={12} className={archiving ? 'animate-spin' : ''} /> {archiving ? '実行中' : '再実行'}
            </button>
          </div>
          {(archiveError ?? archive?.lastError) && <p className="mt-2 text-xs text-amber-400 break-words">{archiveError ?? archive?.lastError}</p>}
          {archive?.result && <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-500">
            {archiveSummary(archive.result).map((item) => <div key={item.label} className="contents"><dt>{item.label}</dt><dd className="text-zinc-300">{item.value}</dd></div>)}
          </dl>}
        </div>
      </div>
    </div>
  )
}
