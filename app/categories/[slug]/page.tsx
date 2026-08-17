'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, ArrowLeft } from 'lucide-react'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia, Category } from '@/lib/types'
import { getKeyboardPageChange, isKeyboardPageNavigationTarget } from '@/lib/keyboard-page-navigation'
import { useLanguage } from '@/components/language-provider'
import { uiText } from '@/lib/i18n'

const PAGE_SIZE = 24

interface CategoryPageData {
  category: Category
  bookmarks: BookmarkWithMedia[]
  total: number
}

function Pagination({ page, total, limit, onChange }: {
  page: number
  total: number
  limit: number
  onChange: (p: number) => void
}) {
  const { language } = useLanguage()
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-3 mt-8">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={16} />
        {uiText(language, '前へ', 'Previous')}
      </button>
      <span className="text-sm text-zinc-500">
        {uiText(language, `${page} / ${totalPages}ページ`, `Page ${page} of ${totalPages}`)}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {uiText(language, '次へ', 'Next')}
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

export default function CategoryPage() {
  const { language } = useLanguage()
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [data, setData] = useState<CategoryPageData | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async (p: number) => {
    try {
      const [catRes, bookmarksRes] = await Promise.all([
        fetch(`/api/categories/${slug}`),
        fetch(`/api/bookmarks?category=${slug}&page=${p}&limit=${PAGE_SIZE}`),
      ])

      if (!catRes.ok) {
        router.push('/categories')
        return null
      }

      const catData = await catRes.json()
      const bmData = await bookmarksRes.json()

      return {
        category: catData.category,
        bookmarks: bmData.bookmarks ?? [],
        total: bmData.total ?? 0,
      }
    } catch (err) {
      console.error(err)
      return null
    }
  }, [slug, router])

  useEffect(() => {
    let cancelled = false
    void fetchData(page).then((nextData) => {
      if (cancelled) return
      if (nextData) setData(nextData)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [fetchData, page])

  function handlePageChange(nextPage: number) {
    setLoading(true)
    setPage(nextPage)
  }

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isKeyboardPageNavigationTarget(event.target)) return
      const nextPage = getKeyboardPageChange(event.key, page, totalPages, event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      if (nextPage === null) return
      setLoading(true)
      setPage(nextPage)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [page, totalPages])

  function handleExport() {
    window.location.href = `/api/export?type=zip&category=${slug}`
  }

  if (loading && !data) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl h-48 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  const category = data?.category
  const bookmarks = data?.bookmarks ?? []
  const total = data?.total ?? 0

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <button
        onClick={() => router.push('/categories')}
        className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {uiText(language, 'すべてのカテゴリ', 'All categories')}
      </button>

      {category && (
        <div className="flex items-start justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full shrink-0"
              style={{ backgroundColor: category.color }}
            />
            <div>
              <h1 className="text-2xl font-bold text-zinc-100">{category.name}</h1>
              {category.description && (
                <p className="text-zinc-400 text-sm mt-0.5">{category.description}</p>
              )}
              <p className="text-zinc-500 text-sm mt-1">{uiText(language, `${total.toLocaleString()}件のブックマーク`, `${total.toLocaleString()} bookmarks`)}</p>
            </div>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors shrink-0"
          >
            <Download size={15} />
            {uiText(language, 'ZIPでエクスポート', 'Export ZIP')}
          </button>
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl h-48 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && bookmarks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-xl font-semibold text-zinc-400">{uiText(language, 'このカテゴリにブックマークはありません', 'No bookmarks in this category')}</p>
        </div>
      )}

      {!loading && bookmarks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {bookmarks.map((bookmark) => (
            <BookmarkCard key={bookmark.id} bookmark={bookmark} />
          ))}
        </div>
      )}

      <Pagination page={page} total={total} limit={PAGE_SIZE} onChange={handlePageChange} />
    </div>
  )
}
