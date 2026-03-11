'use client'

import { useState, useEffect } from 'react'
import { Plus, Tag, X, ArrowRight, Folder, Bookmark, Sparkles, Loader2, Check, Trash2 } from 'lucide-react'
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

interface CategorySuggestion {
  name: string
  slug: string
  description: string
  color: string
  bookmarkCount: number
  confidence: number
  exampleBookmarks: Array<{
    tweetId: string
    text: string
    authorHandle: string
  }>
}

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

interface AIAssistantModalProps {
  open: boolean
  onClose: () => void
  onCategoriesCreated: (categories: Category[]) => void
}

function AIAssistantModal({ open, onClose, onCategoriesCreated }: AIAssistantModalProps) {
  const [suggestions, setSuggestions] = useState<CategorySuggestion[]>([])
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && suggestions.length === 0) {
      fetchSuggestions()
    }
  }, [open])

  async function fetchSuggestions() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/categories/suggest')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate suggestions')
      setSuggestions(data.suggestions || [])
      // Auto-select all by default
      setSelectedSuggestions(new Set(data.suggestions?.map((s: CategorySuggestion) => s.slug) || []))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate suggestions')
    } finally {
      setLoading(false)
    }
  }

  function toggleSelection(slug: string) {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) {
        next.delete(slug)
      } else {
        next.add(slug)
      }
      return next
    })
  }

  async function handleCreateSelected() {
    const selected = suggestions.filter((s) => selectedSuggestions.has(s.slug))
    if (selected.length === 0) return

    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/categories/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestions: selected }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create categories')
      
      // Refresh categories list
      const catsRes = await fetch('/api/categories')
      const catsData = await catsRes.json()
      if (catsData.categories) {
        onCategoriesCreated(catsData.categories)
      }
      
      // Close modal
      onClose()
      setSuggestions([])
      setSelectedSuggestions(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create categories')
    } finally {
      setCreating(false)
    }
  }

  function handleClose() {
    if (!creating) {
      onClose()
      setError('')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 animate-in fade-in duration-200" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl shadow-black/50 focus:outline-none animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-hidden">
          <div className="p-6 border-b border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <Dialog.Title className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
                  <Sparkles size={20} className="text-indigo-400" />
                  AI Category Assistant
                </Dialog.Title>
                <Dialog.Description className="text-sm text-zinc-500 mt-1">
                  Analyze your bookmarks and discover natural topic clusters
                </Dialog.Description>
              </div>
              <button
                onClick={handleClose}
                disabled={creating}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="p-6 overflow-y-auto max-h-[60vh]">
            {loading && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 size={32} className="text-indigo-400 animate-spin mb-4" />
                <p className="text-zinc-400">Analyzing your bookmarks...</p>
                <p className="text-zinc-500 text-sm mt-1">This may take a moment</p>
              </div>
            )}

            {!loading && error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4">
                <p className="text-red-400 text-sm">{error}</p>
                <button
                  onClick={fetchSuggestions}
                  className="mt-2 text-sm text-red-400 hover:text-red-300 underline"
                >
                  Try again
                </button>
              </div>
            )}

            {!loading && !error && suggestions.length === 0 && (
              <div className="text-center py-12">
                <p className="text-zinc-400">No suggestions available.</p>
                <p className="text-zinc-500 text-sm mt-1">Make sure you have at least 10 bookmarks imported.</p>
              </div>
            )}

            {!loading && suggestions.length > 0 && (
              <div className="space-y-4">
                <p className="text-zinc-400 text-sm">
                  Found {suggestions.length} potential categories. Select the ones you want to create:
                </p>
                
                {suggestions.map((suggestion) => (
                  <div
                    key={suggestion.slug}
                    onClick={() => toggleSelection(suggestion.slug)}
                    className={`relative border rounded-xl p-4 cursor-pointer transition-all duration-200 ${
                      selectedSuggestions.has(suggestion.slug)
                        ? 'border-indigo-500 bg-indigo-500/5'
                        : 'border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                          selectedSuggestions.has(suggestion.slug)
                            ? 'bg-indigo-500 border-indigo-500'
                            : 'border-zinc-600'
                        }`}
                      >
                        {selectedSuggestions.has(suggestion.slug) && (
                          <Check size={12} className="text-white" />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: suggestion.color }}
                          />
                          <h3 className="font-semibold text-zinc-100">{suggestion.name}</h3>
                          <span className="text-xs text-zinc-500">
                            {suggestion.bookmarkCount} bookmarks
                          </span>
                          <span className="text-xs text-zinc-600">
                            {(suggestion.confidence * 100).toFixed(0)}% confidence
                          </span>
                        </div>
                        
                        <p className="text-sm text-zinc-400 mb-2">{suggestion.description}</p>
                        
                        {suggestion.exampleBookmarks.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs text-zinc-500">Example bookmarks:</p>
                            {suggestion.exampleBookmarks.map((bm) => (
                              <div
                                key={bm.tweetId}
                                className="text-xs text-zinc-600 bg-zinc-800/50 rounded px-2 py-1.5 line-clamp-1"
                              >
                                <span className="text-zinc-500">@{bm.authorHandle}:</span> {bm.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="p-6 border-t border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-500">
                  {selectedSuggestions.size} of {suggestions.length} selected
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSelectedSuggestions(new Set())}
                    disabled={creating}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-zinc-300 transition-colors"
                  >
                    Clear all
                  </button>
                  <button
                    onClick={handleCreateSelected}
                    disabled={creating || selectedSuggestions.size === 0}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {creating ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Plus size={16} />
                        Create {selectedSuggestions.size} categories
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
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
  const [aiModalOpen, setAiModalOpen] = useState(false)

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

  function handleCategoriesCreated(newCategories: Category[]) {
    setCategories(newCategories)
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
              ? `${totalBookmarks.toLocaleString()} bookmarks across ${categories.length} categories`
              : 'Organize your bookmarks by topic'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAiModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 text-sm font-medium transition-colors"
          >
            <Sparkles size={16} className="text-indigo-400" />
            AI Assistant
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20"
          >
            <Plus size={16} />
            Add Category
          </button>
        </div>
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
            Create your first category to start organizing your bookmarks by topic.
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
            to automatically assign bookmarks to your categories.
          </p>
        </div>
      )}

      <AddCategoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={handleAdd}
      />

      <AIAssistantModal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        onCategoriesCreated={handleCategoriesCreated}
      />
    </div>
  )
}
