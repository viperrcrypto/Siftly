'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, ArrowLeft } from 'lucide-react'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia, Category } from '@/lib/types'

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
        Previous
      </button>
      <span className="text-sm text-zinc-500">
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Next
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [data, setData] = useState<CategoryPageData | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const [catRes, bookmarksRes] = await Promise.all([
        fetch(`/api/categories/${slug}`),
        fetch(`/api/bookmarks?category=${slug}&page=${p}&limit=${PAGE_SIZE}`),
      ])

      if (!catRes.ok) {
        router.push('/categories')
        return
      }

      const catData = await catRes.json()
      const bmData = await bookmarksRes.json()

      setData({
        category: catData.category,
        bookmarks: bmData.bookmarks ?? [],
        total: bmData.total ?? 0,
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [slug, router])

  useEffect(() => {
    fetchData(page)
  }, [fetchData, page])

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
        All Categories
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
              <p className="text-zinc-500 text-sm mt-1">{total.toLocaleString()} tweet{total !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors shrink-0"
          >
            <Download size={15} />
            Export ZIP
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
          <p className="text-xl font-semibold text-zinc-400">No tweets in this category</p>
        </div>
      )}

      {!loading && bookmarks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {bookmarks.map((bookmark) => (
            <BookmarkCard key={bookmark.id} bookmark={bookmark} />
          ))}
        </div>
      )}

      <Pagination page={page} total={total} limit={PAGE_SIZE} onChange={setPage} />
    </div>
  )
}
