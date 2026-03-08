'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Search,
  BookmarkX,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  X,
  ChevronDown,
  ArrowUpDown,
} from 'lucide-react'
import * as Select from '@radix-ui/react-select'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia, BookmarksResponse } from '@/lib/types'

const PAGE_SIZE = 24

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

function buildUrl(filters: Filters): string {
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
  params.set('limit', String(PAGE_SIZE))
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
      <Select.Trigger className="flex min-h-10 w-full min-w-[140px] items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400 transition-all hover:border-zinc-700 hover:text-zinc-200 focus:outline-none focus:border-indigo-500 sm:w-auto shrink-0">
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
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return null

  const getPageNumbers = (): (number | 'ellipsis')[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages: (number | 'ellipsis')[] = [1]
    if (page > 3) pages.push('ellipsis')
    const start = Math.max(2, page - 1)
    const end = Math.min(totalPages - 1, page + 1)
    for (let i = start; i <= end; i++) pages.push(i)
    if (page < totalPages - 2) pages.push('ellipsis')
    pages.push(totalPages)
    return pages
  }

  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-2 sm:mt-12">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
      >
        <ChevronLeft size={14} />
        Prev
      </button>

      <div className="flex items-center gap-1">
        {getPageNumbers().map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`ellipsis-${i}`} className="px-2 text-zinc-700 text-sm select-none">&hellip;</span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`w-9 h-9 rounded-xl text-sm font-medium transition-all ${
                p === page
                  ? 'bg-indigo-600 text-white border border-indigo-500/50 shadow-lg shadow-indigo-500/20'
                  : 'bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-100 hover:border-zinc-700 hover:bg-zinc-800'
              }`}
            >
              {p}
            </button>
          )
        )}
      </div>

      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
      >
        Next
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

function BookmarksPageInner() {
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    uncategorized: searchParams.get('uncategorized') === 'true',
    category: searchParams.get('category') ?? '',
    mediaType: searchParams.get('mediaType') ?? '',
    q: searchParams.get('q') ?? '',
  }))
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') ?? '')
  const [bookmarks, setBookmarks] = useState<BookmarkWithMedia[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchBookmarks = useCallback(async (f: Filters) => {
    setLoading(true)
    try {
      const res = await fetch(buildUrl(f))
      if (!res.ok) throw new Error('Failed to fetch')
      const data: BookmarksResponse = await res.json()
      setBookmarks(data.bookmarks)
      setTotal(data.total)
    } catch (err) {
      console.error(err)
      setBookmarks([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBookmarks(filters)
  }, [fetchBookmarks, filters])

  function updateSearch(q: string) {
    setSearchInput(q)
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => {
      setFilters((prev) => ({ ...prev, q, page: 1 }))
    }, 300)
  }

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }))
  }

  function clearAllFilters() {
    setSearchInput('')
    setFilters(DEFAULT_FILTERS)
  }

  const mediaOptions = [
    { label: 'Photos', value: 'photo' },
    { label: 'Videos', value: 'video' },
  ]

  const sourceOptions = [
    { label: 'Bookmarks', value: 'bookmark' },
    { label: 'Likes', value: 'like' },
  ]

  const sortOptions = [
    { label: 'Newest first', value: 'newest' },
    { label: 'Oldest first', value: 'oldest' },
  ]

  const hasActiveFilters = !!(filters.q || filters.category || filters.mediaType || filters.source || filters.sort !== 'newest' || filters.uncategorized)

  const sortLabel = sortOptions.find((o) => o.value === filters.sort)?.label ?? 'Newest first'

  return (
    <div className="flex flex-col h-full">

      {/* ── Sticky top bar ── */}
      <div className="sticky top-0 z-20 border-b border-zinc-800/60 bg-zinc-950/90 backdrop-blur-lg">
        <div className="px-4 py-3 sm:px-6 md:px-8 md:py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">

            {/* Search */}
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
              <input
                type="text"
                placeholder="Search bookmarks..."
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

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 lg:ml-auto lg:flex-nowrap">
              <SelectMenu
                value={filters.mediaType}
                onChange={(v) => updateFilter('mediaType', v)}
                options={mediaOptions}
                placeholder="All media"
              />

              {/* Source */}
              <SelectMenu
                value={filters.source}
                onChange={(v) => updateFilter('source', v)}
                options={sourceOptions}
                placeholder="All sources"
              />

              {/* Sort */}
              <button
                onClick={() => updateFilter('sort', filters.sort === 'newest' ? 'oldest' : 'newest')}
                className="flex min-h-10 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400 transition-all hover:border-zinc-700 hover:text-zinc-200 shrink-0"
                title={`Sort: ${sortLabel}`}
              >
                <ArrowUpDown size={13} />
                <span className="hidden sm:inline">{sortLabel}</span>
              </button>

              <div className="flex items-center gap-0.5 rounded-xl border border-zinc-800 bg-zinc-900 p-1 shrink-0">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-lg transition-all ${
                    viewMode === 'grid' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-600 hover:text-zinc-300'
                  }`}
                  aria-label="Masonry view"
                >
                  <LayoutGrid size={14} />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-lg transition-all ${
                    viewMode === 'list' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-600 hover:text-zinc-300'
                  }`}
                  aria-label="List view"
                >
                  <List size={14} />
                </button>
              </div>
            </div>

          </div>

          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {filters.uncategorized && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium">
                  Uncategorized
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
                Clear all
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="mx-auto flex-1 w-full max-w-7xl px-4 py-5 sm:px-6 md:px-8 md:py-6">

        {/* Results count */}
        {!loading && (
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-500">
              {total > 0 ? (
                <>
                  <span className="text-zinc-200 font-semibold">{total.toLocaleString()}</span>
                  {' '}bookmark{total !== 1 ? 's' : ''}
                  {filters.q && <span className="text-zinc-600"> for &ldquo;{filters.q}&rdquo;</span>}
                </>
              ) : (
                'No bookmarks found'
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
        {!loading && bookmarks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-5">
              <BookmarkX size={26} className="text-zinc-700" />
            </div>
            <h3 className="text-base font-semibold text-zinc-400 mb-2">No bookmarks match your filters</h3>
            <p className="text-zinc-600 text-sm mb-6 max-w-xs">
              Try adjusting your search or removing some filters.
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-xl transition-colors border border-zinc-800"
              >
                <X size={13} />
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Masonry grid */}
        {!loading && bookmarks.length > 0 && viewMode === 'grid' && (
          <div className="masonry-grid">
            {bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="masonry-item">
                <BookmarkCard bookmark={bookmark} />
              </div>
            ))}
          </div>
        )}

        {/* List view */}
        {!loading && bookmarks.length > 0 && viewMode === 'list' && (
          <div className="flex flex-col gap-3 max-w-3xl mx-auto">
            {bookmarks.map((bookmark) => (
              <BookmarkCard key={bookmark.id} bookmark={bookmark} />
            ))}
          </div>
        )}

        <Pagination
          page={filters.page}
          total={total}
          limit={PAGE_SIZE}
          onChange={(p) => setFilters((prev) => ({ ...prev, page: p }))}
        />
      </div>
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
