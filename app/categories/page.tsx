'use client'

import { useState, useEffect } from 'react'
import { Plus, Tag, X, ArrowRight, Folder, Bookmark } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import Link from 'next/link'
import type { Category } from '@/lib/types'

const PRESET_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
]

interface AddCategoryModalProps {
  open: boolean
  onClose: () => void
  onAdd: (category: Category) => void
}

function AddCategoryModal({ open, onClose, onAdd }: AddCategoryModalProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Category name is required')
      return
    }
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color, description: description.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create category')
      onAdd(data.category)
      setName('')
      setDescription('')
      setColor(PRESET_COLORS[0])
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setError('')
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 animate-in fade-in duration-200" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl shadow-black/50 focus:outline-none animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <Dialog.Title className="text-lg font-semibold text-zinc-100">New Category</Dialog.Title>
              <Dialog.Description className="text-sm text-zinc-500 mt-0.5">
                Create a category to organize your bookmarks
              </Dialog.Description>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Machine Learning"
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all duration-200"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Color</label>
              <div className="flex gap-2.5 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    title={c}
                    className={`w-8 h-8 rounded-full transition-all duration-150 focus:outline-none ${
                      color === c
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110'
                        : 'hover:scale-110 hover:ring-1 hover:ring-white/30 hover:ring-offset-1 hover:ring-offset-zinc-900'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="w-4 h-4 rounded-full border border-zinc-700" style={{ backgroundColor: color }} />
                <span className="text-xs text-zinc-500 font-mono">{color}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Description{' '}
                <span className="text-zinc-600 font-normal">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this category..."
                rows={3}
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all duration-200 resize-none"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <X size={14} className="shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors border border-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Creating...' : 'Create Category'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface CategoryDisplayCardProps {
  category: Category
}

function CategoryDisplayCard({ category }: CategoryDisplayCardProps) {
  return (
    <div
      className="bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-zinc-700 transition-all duration-200 overflow-hidden group"
      style={{ borderLeftColor: category.color, borderLeftWidth: '4px' }}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-semibold text-zinc-100 text-base truncate">{category.name}</span>
            {category.isAiGenerated && (
              <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                AI
              </span>
            )}
          </div>
        </div>

        {category.description ? (
          <p className="text-sm text-zinc-400 leading-relaxed line-clamp-2 mb-4">{category.description}</p>
        ) : (
          <p className="text-sm text-zinc-600 italic mb-4">No description</p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark size={14} style={{ color: category.color, fill: category.color }} className="shrink-0" />
            <span className="text-3xl font-bold text-zinc-100">{category.bookmarkCount.toLocaleString()}</span>
          </div>
          <Link
            href={`/categories/${category.slug}`}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-indigo-400 transition-colors group-hover:text-zinc-400 font-medium"
          >
            View bookmarks
            <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 h-36 animate-pulse border-l-4 border-l-zinc-700">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-32 h-4 rounded bg-zinc-800" />
      </div>
      <div className="w-full h-3 rounded bg-zinc-800 mb-2" />
      <div className="w-2/3 h-3 rounded bg-zinc-800 mb-4" />
      <div className="flex items-center justify-between">
        <div className="w-16 h-7 rounded bg-zinc-800" />
        <div className="w-28 h-3 rounded bg-zinc-800" />
      </div>
    </div>
  )
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [totalBookmarks, setTotalBookmarks] = useState(0)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/categories').then((r) => r.json()),
      fetch('/api/stats').then((r) => r.json()),
    ])
      .then(([catData, statsData]) => {
        setCategories(catData.categories ?? [])
        if (statsData.totalBookmarks !== undefined) setTotalBookmarks(statsData.totalBookmarks)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function handleAdd(category: Category) {
    setCategories((prev) => [...prev, category])
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">

      {/* Page Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium mb-1">Organization</p>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-100">Categories</h1>
            {!loading && categories.length > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs font-medium">
                {categories.length}
              </span>
            )}
          </div>
          <p className="text-zinc-400 mt-1 text-sm">
            {loading
              ? 'Loading your categories...'
              : categories.length > 0
              ? `${totalBookmarks.toLocaleString()} tweets across ${categories.length} categories`
              : 'Organize your tweets by topic'}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20"
        >
          <Plus size={16} />
          Add Category
        </button>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && categories.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-5">
            <Folder size={28} className="text-zinc-700" />
          </div>
          <h3 className="text-lg font-semibold text-zinc-300 mb-2">No categories yet</h3>
          <p className="text-zinc-500 text-sm mb-6 max-w-xs leading-relaxed">
            Create your first category to start organizing your tweets by topic.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors"
          >
            <Plus size={15} />
            Create first category
          </button>
        </div>
      )}

      {/* Category Grid */}
      {!loading && categories.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((cat) => (
            <CategoryDisplayCard key={cat.id} category={cat} />
          ))}
        </div>
      )}

      {/* Hint for empty categories */}
      {!loading && categories.length > 0 && (
        <div className="mt-8 flex items-center gap-3 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
          <Tag size={15} className="text-indigo-400 shrink-0" />
          <p className="text-sm text-zinc-500">
            Tip: Use{' '}
            <Link href="/categorize" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              AI Categorize
            </Link>{' '}
            to automatically assign tweets to your categories.
          </p>
        </div>
      )}

      <AddCategoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={handleAdd}
      />
    </div>
  )
}
