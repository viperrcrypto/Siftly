'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Search,
  BookmarkX,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LayoutGrid,
  List,
  AlignJustify,
  X,
  ChevronDown,
  ArrowUpDown,
  Trash2,
} from 'lucide-react'
import * as Select from '@radix-ui/react-select'
import BookmarkCard from '@/components/bookmark-card'
import BookmarkRow from '@/components/bookmark-row'
import BookmarkDetailModal from '@/components/bookmark-detail-modal'
import type { BookmarkWithMedia, BookmarksResponse, Category } from '@/lib/types'
import { getKeyboardPageChange, isKeyboardPageNavigationTarget } from '@/lib/keyboard-page-navigation'
import { useLanguage } from '@/components/language-provider'
import { uiText } from '@/lib/i18n'

const DEFAULT_PAGE_SIZE = 24
const COMPACT_PAGE_SIZE = 100

interface Filters {
  q: string
  category: string
  mediaType: string
  source: string
  sort: string
  page: number
  uncategorized: boolean
}

const DEFAULT_FILTERS: Filters = {
  q: '',
  category: '',
  mediaType: '',
  source: '',
  sort: 'newest',
  page: 1,
  uncategorized: false,
}

function buildUrl(filters: Filters, limit: number): string {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.uncategorized) {
    params.set('uncategorized', 'true')
  } else if (filters.category) {
    params.set('category', filters.category)
  }
  if (filters.mediaType) params.set('mediaType', filters.mediaType)
  if (filters.source) params.set('source', filters.source)
  params.set('sort', filters.sort)
  params.set('page', String(filters.page))
  params.set('limit', String(limit))
  return `/api/bookmarks?${params.toString()}`
}

function SelectMenu({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: { label: string; value: string }[]
  placeholder: string
}) {
  return (
    <Select.Root value={value || '_all'} onValueChange={(v) => onChange(v === '_all' ? '' : v)}>
      <Select.Trigger className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-all min-w-[120px] shrink-0">
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="ml-auto">
          <ChevronDown size={12} className="text-zinc-600" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="z-50 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
          <Select.Viewport className="p-1">
            <Select.Item
              value="_all"
              className="flex items-center px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 rounded-lg cursor-pointer outline-none transition-colors data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-100"
            >
              <Select.ItemText>{placeholder}</Select.ItemText>
            </Select.Item>
            {options.map((opt) => (
              <Select.Item
                key={opt.value}
                value={opt.value}
                className="flex items-center px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 rounded-lg cursor-pointer outline-none transition-colors data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-100"
              >
                <Select.ItemText>{opt.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

function SkeletonCard() {
  return (
    <div className="masonry-item">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden animate-pulse">
        <div className="h-40 bg-zinc-800" />
        <div className="p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-full bg-zinc-800" />
            <div className="space-y-1.5">
              <div className="w-24 h-3 rounded-lg bg-zinc-800" />
              <div className="w-16 h-2.5 rounded-lg bg-zinc-800" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="w-full h-3 rounded-lg bg-zinc-800" />
            <div className="w-5/6 h-3 rounded-lg bg-zinc-800" />
            <div className="w-3/4 h-3 rounded-lg bg-zinc-800" />
          </div>
          <div className="mt-4 pt-3 border-t border-zinc-800 flex gap-2">
            <div className="w-16 h-5 rounded-full bg-zinc-800" />
            <div className="w-20 h-5 rounded-full bg-zinc-800" />
          </div>
        </div>
      </div>
    </div>
  )
}

function Pagination({
  page,
  total,
  limit,
  onChange,
}: {
  page: number
  total: number
  limit: number
  onChange: (p: number) => void
}) {
  const { language } = useLanguage()
  const totalPages = Math.ceil(total / limit)
  const [jumpValue, setJumpValue] = useState('')

  if (totalPages <= 1) return null

  function handleJumpKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const num = parseInt(jumpValue, 10)
    if (!isNaN(num) && num >= 1 && num <= totalPages) {
      onChange(num)
    }
    setJumpValue('')
  }

  const navBtnClass =
    'flex items-center justify-center w-9 h-9 rounded-xl text-sm bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-25 disabled:cursor-not-allowed transition-all'

  return (
    <div className="flex items-center justify-center gap-3 mt-12">
      {/* Jump to page */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-500 select-none">{uiText(language, 'ページ移動', 'Jump to page')}</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          onKeyDown={handleJumpKeyDown}
          placeholder="—"
          className="w-14 px-2 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-700 text-sm text-center focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>

      {/* Page indicator */}
      <span className="text-sm text-zinc-600 select-none tabular-nums">
        {uiText(language, '', 'Page ')}<span className="text-zinc-400">{page}</span> {uiText(language, '/', 'of')} <span className="text-zinc-400">{totalPages}</span>{language === 'ja' ? 'ページ' : ''}
      </span>

      {/* Navigation arrows */}
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(1)} disabled={page <= 1} className={navBtnClass} title={uiText(language, '最初のページ', 'First page')}>
          <ChevronsLeft size={14} />
        </button>
        <button onClick={() => onChange(page - 1)} disabled={page <= 1} className={navBtnClass} title={uiText(language, '前のページ', 'Previous page')}>
          <ChevronLeft size={14} />
        </button>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages} className={navBtnClass} title={uiText(language, '次のページ', 'Next page')}>
          <ChevronRight size={14} />
        </button>
        <button onClick={() => onChange(totalPages)} disabled={page >= totalPages} className={navBtnClass} title={uiText(language, '最後のページ', 'Last page')}>
          <ChevronsRight size={14} />
        </button>
      </div>
    </div>
  )
}

function SelectionCheckbox({ checked, indeterminate = false, onChange, label, disabled = false }: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  label: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} className="accent-indigo-500 disabled:cursor-not-allowed" />
}

function BookmarksPageInner() {
  const { language } = useLanguage()
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    uncategorized: searchParams.get('uncategorized') === 'true',
    category: searchParams.get('category') ?? '',
    mediaType: searchParams.get('mediaType') ?? '',
    q: searchParams.get('q') ?? '',
  }))
  const [searchInput, setSearchInput] = useState('')
  const [bookmarks, setBookmarks] = useState<BookmarkWithMedia[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('grid')
  const [openBookmark, setOpenBookmark] = useState<BookmarkWithMedia | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [operationPending, setOperationPending] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchBookmarks = useCallback(async (f: Filters, limit: number) => {
    const res = await fetch(buildUrl(f, limit))
    const body = await res.text()
    if (!res.ok) {
      const detail = body.replace(/\s+/g, ' ').trim().slice(0, 240)
      throw new Error(`Bookmarks API (${res.status})${detail ? `: ${detail}` : ''}`)
    }
    return JSON.parse(body) as BookmarksResponse
  }, [])

  const applyBookmarks = useCallback((data: BookmarksResponse) => {
    setBookmarks(data.bookmarks)
    setTotal(data.total)
    setError(null)
    setLoading(false)
  }, [])

  const handleBookmarksError = useCallback((reason: unknown) => {
    setBookmarks([])
    setTotal(0)
    setError(reason instanceof Error ? reason.message : 'Bookmarks API request failed')
    setLoading(false)
  }, [])

  const pageSize = viewMode === 'compact' ? COMPACT_PAGE_SIZE : DEFAULT_PAGE_SIZE

  useEffect(() => {
    let cancelled = false
    void fetchBookmarks(filters, pageSize)
      .then((data) => { if (!cancelled) applyBookmarks(data) })
      .catch((reason: unknown) => { if (!cancelled) handleBookmarksError(reason) })
    return () => { cancelled = true }
  }, [applyBookmarks, fetchBookmarks, filters, handleBookmarksError, pageSize])

  useEffect(() => {
    if (selectedIds.size === 0 || categories.length > 0) return
    void fetch('/api/categories')
      .then(async (response) => {
        const data = await response.json() as { categories?: Category[]; error?: string }
        if (!response.ok) throw new Error(data.error ?? 'Failed to load categories')
        setCategories(data.categories ?? [])
      })
      .catch((reason: unknown) => setOperationError(reason instanceof Error ? reason.message : 'Failed to load categories'))
  }, [categories.length, selectedIds.size])

  function retryBookmarks() {
    setLoading(true)
    void fetchBookmarks(filters, pageSize).then(applyBookmarks).catch(handleBookmarksError)
  }

  function handleSetViewMode(mode: 'grid' | 'list' | 'compact') {
    setLoading(true)
    setViewMode(mode)
    setFilters((prev) => ({ ...prev, page: 1 }))
  }

  function updateSearch(q: string) {
    setSearchInput(q)
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => {
      setLoading(true)
      setFilters((prev) => ({ ...prev, q, page: 1 }))
    }, 300)
  }

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setLoading(true)
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }))
  }

  function clearAllFilters() {
    setLoading(true)
    setSearchInput('')
    setFilters(DEFAULT_FILTERS)
  }

  function handlePageChange(page: number) {
    setLoading(true)
    setFilters((prev) => ({ ...prev, page }))
  }

  const totalPages = Math.ceil(total / pageSize)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isKeyboardPageNavigationTarget(event.target)) return
      const nextPage = getKeyboardPageChange(event.key, filters.page, totalPages, event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      if (nextPage === null) return
      setLoading(true)
      setFilters((previous) => ({ ...previous, page: nextPage }))
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filters.page, totalPages])

  const visibleSelected = bookmarks.filter((bookmark) => selectedIds.has(bookmark.id)).length
  const allVisibleSelected = bookmarks.length > 0 && visibleSelected === bookmarks.length

  function toggleBookmark(bookmarkId: string) {
    setOperationError(null)
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(bookmarkId)) next.delete(bookmarkId)
      else if (next.size < 500) next.add(bookmarkId)
      else setOperationError(uiText(language, '選択は最大500件です', 'You can select up to 500 bookmarks'))
      return next
    })
  }

  function toggleVisibleBookmarks() {
    setOperationError(null)
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (allVisibleSelected) bookmarks.forEach((bookmark) => next.delete(bookmark.id))
      else for (const bookmark of bookmarks) {
        if (next.has(bookmark.id)) continue
        if (next.size >= 500) { setOperationError(uiText(language, '選択は最大500件です', 'You can select up to 500 bookmarks')); break }
        next.add(bookmark.id)
      }
      return next
    })
  }

  async function applyCorrections() {
    if (selectedIds.size === 0 || operationPending) return
    setOperationError(null)
    setOperationPending(true)
    try {
      const response = await fetch('/api/categorize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarkIds: [...selectedIds], categoryOnly: true, language }),
      })
      const data = await response.json() as { error?: string; runId?: string }
      if (!response.ok) throw new Error(data.error ?? 'Failed to start categorization')
      window.location.assign(`/categorize?run=${encodeURIComponent(data.runId ?? '')}`)
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : uiText(language, '修正の反映に失敗しました', 'Failed to apply corrections'))
    } finally {
      setOperationPending(false)
    }
  }

  async function addCategories() {
    if (selectedIds.size === 0 || selectedCategoryIds.length === 0 || operationPending) return
    setOperationError(null)
    setOperationPending(true)
    try {
      const response = await fetch('/api/bookmarks/categories/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarkIds: [...selectedIds], categoryIds: selectedCategoryIds }),
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Failed to add categories')
      const refreshed = await fetchBookmarks(filters, pageSize)
      applyBookmarks(refreshed)
      setSelectedIds(new Set())
      setSelectedCategoryIds([])
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : uiText(language, 'カテゴリの追加に失敗しました', 'Failed to add categories'))
    } finally {
      setOperationPending(false)
    }
  }

  function handleBookmarkDeleted(id: string) {
    if (filters.page > 1 && bookmarks.length === 1 && bookmarks[0]?.id === id) {
      setLoading(true)
      setFilters((previous) => ({ ...previous, page: previous.page - 1 }))
    }
    setBookmarks((previous) => previous.filter((bookmark) => bookmark.id !== id))
    setTotal((previous) => Math.max(0, previous - 1))
    setSelectedIds((previous) => {
      const next = new Set(previous)
      next.delete(id)
      return next
    })
    setOpenBookmark((previous) => previous?.id === id ? null : previous)
  }

  const mediaOptions = [
    { label: uiText(language, '写真', 'Photos'), value: 'photo' },
    { label: uiText(language, '動画', 'Videos'), value: 'video' },
  ]

  const sourceOptions = [
    { label: uiText(language, 'ブックマーク', 'Bookmarks'), value: 'bookmark' },
    { label: uiText(language, 'いいね', 'Likes'), value: 'like' },
  ]

  const sortOptions = [
    { label: uiText(language, '新しい順', 'Newest first'), value: 'newest' },
    { label: uiText(language, '古い順', 'Oldest first'), value: 'oldest' },
  ]

  const hasActiveFilters = !!(filters.q || filters.category || filters.mediaType || filters.source || filters.sort !== 'newest' || filters.uncategorized)

  const sortLabel = sortOptions.find((o) => o.value === filters.sort)?.label ?? uiText(language, '新しい順', 'Newest first')

  return (
    <div className="flex flex-col h-full">

      {/* ── Sticky top bar ── */}
      <div className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur-lg border-b border-zinc-800/60">
        <div className="px-6 md:px-8 py-4">
          <div className="flex items-center gap-3">

            {/* Search */}
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
              <input
                type="text"
                placeholder={uiText(language, 'ブックマークを検索…', 'Search bookmarks…')}
                value={searchInput}
                onChange={(e) => updateSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 text-sm focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20 transition-all"
              />
              {searchInput && (
                <button
                  onClick={() => updateSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Filters */}
            <SelectMenu
              value={filters.mediaType}
              onChange={(v) => updateFilter('mediaType', v)}
              options={mediaOptions}
              placeholder={uiText(language, 'すべてのメディア', 'All media')}
            />

            {/* Source */}
            <SelectMenu
              value={filters.source}
              onChange={(v) => updateFilter('source', v)}
              options={sourceOptions}
              placeholder={uiText(language, 'すべてのソース', 'All sources')}
            />

            {/* Sort */}
            <button
              onClick={() => updateFilter('sort', filters.sort === 'newest' ? 'oldest' : 'newest')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-all shrink-0"
              title={`${uiText(language, '並び順', 'Sort')}: ${sortLabel}`}
            >
              <ArrowUpDown size={13} />
              <span className="hidden sm:inline">{sortLabel}</span>
            </button>

            {/* View toggle */}
            <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 rounded-xl p-1 shrink-0">
              <button
                onClick={() => handleSetViewMode('grid')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === 'grid' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-600 hover:text-zinc-300'
                }`}
                aria-label={uiText(language, 'タイル表示', 'Masonry view')}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => handleSetViewMode('list')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === 'list' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-600 hover:text-zinc-300'
                }`}
                aria-label={uiText(language, 'リスト表示', 'List view')}
              >
                <List size={14} />
              </button>
              <button
                onClick={() => handleSetViewMode('compact')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === 'compact' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-600 hover:text-zinc-300'
                }`}
                aria-label={uiText(language, 'コンパクト表示', 'Compact view')}
              >
                <AlignJustify size={14} />
              </button>
            </div>
            <Link
              href="/bookmarks/trash"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-all shrink-0"
              title={uiText(language, 'ゴミ箱', 'Trash')}
            >
              <Trash2 size={13} />
              <span className="hidden sm:inline">{uiText(language, 'ゴミ箱', 'Trash')}</span>
            </Link>

          </div>

          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {filters.uncategorized && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium">
                  {uiText(language, '未分類', 'Uncategorized')}
                  <button onClick={() => updateFilter('uncategorized', false)} className="text-amber-400 hover:text-amber-200 transition-colors"><X size={10} /></button>
                </span>
              )}
              {filters.category && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
                  {filters.category.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  <button onClick={() => updateFilter('category', '')} className="text-indigo-400 hover:text-indigo-200 transition-colors"><X size={10} /></button>
                </span>
              )}
              {filters.mediaType && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
                  {mediaOptions.find((o) => o.value === filters.mediaType)?.label}
                  <button onClick={() => updateFilter('mediaType', '')} className="text-indigo-400 hover:text-indigo-200 transition-colors"><X size={10} /></button>
                </span>
              )}
              {filters.source && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
                  {sourceOptions.find((o) => o.value === filters.source)?.label}
                  <button onClick={() => updateFilter('source', '')} className="text-indigo-400 hover:text-indigo-200 transition-colors"><X size={10} /></button>
                </span>
              )}
              {filters.sort !== 'newest' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
                  {sortLabel}
                  <button onClick={() => updateFilter('sort', 'newest')} className="text-indigo-400 hover:text-indigo-200 transition-colors"><X size={10} /></button>
                </span>
              )}
              <button onClick={clearAllFilters} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors underline underline-offset-2">
                {uiText(language, 'すべて解除', 'Clear all')}
              </button>
            </div>
          )}
          {bookmarks.length > 0 && (
            <div className="mt-3 flex items-center gap-3 flex-wrap text-sm">
              <SelectionCheckbox checked={allVisibleSelected} indeterminate={visibleSelected > 0 && !allVisibleSelected} onChange={toggleVisibleBookmarks} disabled={operationPending} label={uiText(language, 'このページをすべて選択', 'Select all on this page')} />
              <span className="text-zinc-400">{uiText(language, `${selectedIds.size}件を選択`, `${selectedIds.size} selected`)}</span>
              {selectedIds.size > 0 && <button type="button" onClick={() => setSelectedIds(new Set())} disabled={operationPending} className="text-zinc-500 hover:text-zinc-200 disabled:opacity-50">{uiText(language, 'すべて解除', 'Clear selection')}</button>}
            </div>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 px-6 md:px-8 py-6 max-w-7xl mx-auto w-full">

        {selectedIds.size > 0 && (
          <section className="mb-5 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 space-y-3" aria-label={uiText(language, '選択したブックマークの操作', 'Selected bookmark actions')}>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={applyCorrections} disabled={operationPending} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium text-white">
                {operationPending ? uiText(language, '処理中…', 'Working…') : uiText(language, `選択した${selectedIds.size}件に修正を反映`, `Apply corrections to ${selectedIds.size} selected`)}
              </button>
              <label className="text-sm text-zinc-300" htmlFor="bulk-category-select">{uiText(language, 'カテゴリを追加', 'Add categories')}</label>
              <select id="bulk-category-select" multiple value={selectedCategoryIds} disabled={operationPending} onChange={(event) => setSelectedCategoryIds([...event.currentTarget.selectedOptions].map((option) => option.value))} className="min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200">
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <button type="button" onClick={addCategories} disabled={operationPending || selectedCategoryIds.length === 0} className="px-3 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50 text-sm text-zinc-100">
                {uiText(language, '選択カテゴリを追加', 'Add selected categories')}
              </button>
            </div>
            {operationError && <p role="alert" className="text-sm text-red-400">{operationError}</p>}
          </section>
        )}

        {/* Results count */}
        {!loading && (
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm text-zinc-500">
              {total > 0 ? (
                <>
                  <span className="text-zinc-200 font-semibold">{total.toLocaleString()}</span>
                  {' '}{uiText(language, '件のブックマーク', `bookmark${total === 1 ? '' : 's'}`)}
                  {filters.q && <span className="text-zinc-600"> {uiText(language, '検索:', 'for')} &quot;{filters.q}&quot;</span>}
                </>
              ) : (
                uiText(language, 'ブックマークが見つかりません', 'No bookmarks found')
              )}
            </p>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="masonry-grid">
            {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Empty state */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
              <X size={26} className="text-red-400" />
            </div>
            <h3 className="text-base font-semibold text-zinc-300 mb-2">{uiText(language, 'ブックマークの読み込みに失敗しました', 'Failed to load bookmarks')}</h3>
            <p className="text-zinc-500 text-sm mb-6 max-w-lg break-words">{error}</p>
            <button
              onClick={retryBookmarks}
              className="px-4 py-2 text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-xl border border-zinc-800"
            >
              {uiText(language, '再試行', 'Retry')}
            </button>
          </div>
        )}

        {!loading && !error && bookmarks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-5">
              <BookmarkX size={26} className="text-zinc-700" />
            </div>
            <h3 className="text-base font-semibold text-zinc-400 mb-2">{uiText(language, '条件に一致するブックマークがありません', 'No bookmarks match your filters')}</h3>
            <p className="text-zinc-600 text-sm mb-6 max-w-xs">
              {uiText(language, '検索条件を変更するか、フィルターを解除してください。', 'Try adjusting your search or removing some filters.')}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-xl transition-colors border border-zinc-800"
              >
                <X size={13} />
                {uiText(language, 'フィルターを解除', 'Clear filters')}
              </button>
            )}
          </div>
        )}

        {/* Masonry grid */}
        {!loading && bookmarks.length > 0 && viewMode === 'grid' && (
          <div className="masonry-grid">
            {bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="masonry-item relative">
                <label className="absolute z-10 top-2 left-2 rounded bg-zinc-950/90 p-1" onClick={(event) => event.stopPropagation()}>
                  <SelectionCheckbox checked={selectedIds.has(bookmark.id)} onChange={() => toggleBookmark(bookmark.id)} disabled={operationPending} label={uiText(language, `${bookmark.authorName}を選択`, `Select ${bookmark.authorName}`)} />
                </label>
                <BookmarkCard bookmark={bookmark} onDeleted={handleBookmarkDeleted} />
              </div>
            ))}
          </div>
        )}

        {/* List view */}
        {!loading && bookmarks.length > 0 && viewMode === 'list' && (
          <div className="flex flex-col gap-3 max-w-3xl mx-auto">
            {bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="relative"><label className="absolute z-10 top-2 left-2 rounded bg-zinc-950/90 p-1" onClick={(event) => event.stopPropagation()}><SelectionCheckbox checked={selectedIds.has(bookmark.id)} onChange={() => toggleBookmark(bookmark.id)} disabled={operationPending} label={uiText(language, `${bookmark.authorName}を選択`, `Select ${bookmark.authorName}`)} /></label><BookmarkCard bookmark={bookmark} onDeleted={handleBookmarkDeleted} /></div>
            ))}
          </div>
        )}

        {/* Compact view */}
        {!loading && bookmarks.length > 0 && viewMode === 'compact' && (
          <div className="flex flex-col divide-y divide-zinc-800/50 border border-zinc-800 rounded-2xl overflow-hidden max-w-5xl mx-auto">
            {bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="flex items-center gap-2 px-3"><SelectionCheckbox checked={selectedIds.has(bookmark.id)} onChange={() => toggleBookmark(bookmark.id)} disabled={operationPending} label={uiText(language, `${bookmark.authorName}を選択`, `Select ${bookmark.authorName}`)} /><BookmarkRow bookmark={bookmark} onClick={setOpenBookmark} /></div>
            ))}
          </div>
        )}

        <Pagination
          page={filters.page}
          total={total}
          limit={pageSize}
          onChange={handlePageChange}
        />
      </div>

      {openBookmark && (
        <BookmarkDetailModal
          bookmark={openBookmark}
          onClose={() => setOpenBookmark(null)}
          onDeleted={handleBookmarkDeleted}
        />
      )}
    </div>
  )
}

export default function BookmarksPage() {
  return (
    <Suspense>
      <BookmarksPageInner />
    </Suspense>
  )
}
