'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, ArrowRight, Loader2 } from 'lucide-react'
import type { BookmarkWithMedia } from '@/lib/types'
import { useLanguage } from '@/components/language-provider'
import { uiLocale, uiText } from '@/lib/i18n'

export default function CommandPalette() {
  const { language } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BookmarkWithMedia[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()

  // Open on Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (open) {
          setOpen(false)
        } else {
          setQuery('')
          setResults([])
          setSelected(0)
          setOpen(true)
        }
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setTotal(0)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/bookmarks?q=${encodeURIComponent(q)}&limit=8&sort=newest`)
      const data = await res.json() as { bookmarks: BookmarkWithMedia[]; total: number }
      setResults(data.bookmarks ?? [])
      setTotal(data.total ?? 0)
      setSelected(0)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  function handleInput(q: string) {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void search(q), 200)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, results.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selected === results.length || results.length === 0) {
        // "See all results" option
        if (query.trim()) {
          router.push(`/bookmarks?q=${encodeURIComponent(query.trim())}`)
          setOpen(false)
        }
      } else if (results[selected]) {
        router.push(`/bookmarks?q=${encodeURIComponent(query.trim())}`)
        setOpen(false)
      }
    }
  }

  function openBookmarkUrl(b: BookmarkWithMedia) {
    const url = `https://twitter.com/${b.authorHandle}/status/${b.tweetId}`
    window.open(url, '_blank', 'noopener noreferrer')
    setOpen(false)
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Palette */}
      <div className="fixed top-[15%] left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-zinc-800">
            {loading ? (
              <Loader2 size={16} className="text-zinc-500 animate-spin shrink-0" />
            ) : (
              <Search size={16} className="text-zinc-500 shrink-0" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={uiText(language, 'キーワードでブックマークを検索…', 'Search bookmarks by keyword…')}
              className="flex-1 bg-transparent text-zinc-100 placeholder:text-zinc-500 text-sm focus:outline-none"
            />
            {query && (
              <button
                onClick={() => handleInput('')}
                className="text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <X size={14} />
              </button>
            )}
            <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-500 text-xs font-mono">
              esc
            </kbd>
          </div>

          {/* Results */}
          {results.length > 0 && (
            <ul className="max-h-96 overflow-y-auto py-2">
              {results.map((b, i) => {
                const thumb = b.mediaItems[0]?.thumbnailUrl ?? (b.mediaItems[0]?.type === 'photo' ? b.mediaItems[0]?.url : null)
                const isSelected = i === selected
                return (
                  <li key={b.id}>
                    <button
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isSelected ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
                      }`}
                      onClick={() => openBookmarkUrl(b)}
                      onMouseEnter={() => setSelected(i)}
                    >
                      {/* Thumbnail or icon */}
                      <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <Search size={14} className="text-zinc-600" />
                        )}
                      </div>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-200 truncate leading-snug">
                          {b.text.slice(0, 100) || uiText(language, '本文なし', 'No text')}
                        </p>
                        <p className="text-xs text-zinc-500 mt-0.5 truncate">
                          {b.categories[0]?.name ?? uiText(language, '未分類', 'Uncategorized')}
                          {b.tweetCreatedAt && (
                            <span className="ml-2 opacity-60">
                              {new Date(b.tweetCreatedAt).toLocaleDateString(uiLocale(language), { month: 'short', year: 'numeric' })}
                            </span>
                          )}
                        </p>
                      </div>

                      <ArrowRight size={12} className={`shrink-0 transition-opacity ${isSelected ? 'text-indigo-400 opacity-100' : 'opacity-0'}`} />
                    </button>
                  </li>
                )
              })}

              {/* See all results row */}
              {total > results.length && (
                <li>
                  <button
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                      selected === results.length ? 'bg-zinc-800 text-indigo-400' : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300'
                    }`}
                    onClick={() => {
                      router.push(`/bookmarks?q=${encodeURIComponent(query.trim())}`)
                      setOpen(false)
                    }}
                    onMouseEnter={() => setSelected(results.length)}
                  >
                    <Search size={13} />
                    {uiText(language, `「${query}」の検索結果をすべて表示（${total}件）`, `See all ${total} results for “${query}”`)}
                  </button>
                </li>
              )}
            </ul>
          )}

          {/* Empty state */}
          {query && !loading && results.length === 0 && (
            <div className="px-4 py-8 text-center text-zinc-600 text-sm">
              {uiText(language, `「${query}」に一致するブックマークはありません`, `No bookmarks found for “${query}”`)}
            </div>
          )}

          {/* Idle state */}
          {!query && (
            <div className="px-4 py-5 flex items-center justify-between text-xs text-zinc-600">
              <span>{uiText(language, '入力してブックマークを検索', 'Type to search your bookmarks')}</span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-mono">↑↓</kbd>
                  {uiText(language, '移動', 'navigate')}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-mono">↵</kbd>
                  {uiText(language, '開く', 'open')}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
