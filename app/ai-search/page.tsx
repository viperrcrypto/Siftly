'use client'

import { useState, useRef, useEffect } from 'react'
import { Sparkles, Search, Loader2, BookMarked, AlertCircle, ImageIcon } from 'lucide-react'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia } from '@/lib/types'

// Extends BookmarkWithMedia with AI-specific fields returned by the search API
interface AIBookmark extends BookmarkWithMedia {
  aiScore: number
  aiReason: string
}

const EXAMPLES = [
  'funny meme about AI replacing developers',
  'Solana DeFi tools I should try',
  'something about productivity and focus',
  'crypto market crash meme',
  'cool developer tools for building faster',
]

interface ImageStats {
  total: number
  tagged: number
  remaining: number
}

export default function AISearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AIBookmark[]>([])
  const [explanation, setExplanation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [imageStats, setImageStats] = useState<ImageStats | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    // Load image analysis progress
    fetch('/api/analyze/images')
      .then((r) => r.json())
      .then((data: ImageStats) => setImageStats(data))
      .catch(() => {})
    // Hide standalone image analysis when the main pipeline is already handling it
    fetch('/api/categorize')
      .then((r) => r.json())
      .then((d: { status: string }) => {
        if (d.status === 'running' || d.status === 'stopping') setPipelineRunning(true)
      })
      .catch(() => {})
  }, [])

  async function handleAnalyzeImages() {
    if (analyzing) return
    setAnalyzing(true)
    try {
      // Run batches until ALL images are processed (no cap)
      while (true) {
        const res = await fetch('/api/analyze/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchSize: 50 }),
        })
        const data = (await res.json()) as { analyzed: number; remaining: number }
        setImageStats((prev) =>
          prev ? { ...prev, tagged: prev.total - data.remaining, remaining: data.remaining } : null,
        )
        if (data.remaining === 0) break
      }
    } catch {
      // silent — refresh stats on error
      const statsRes = await fetch('/api/analyze/images')
      const stats = (await statsRes.json()) as ImageStats
      setImageStats(stats)
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleSearch() {
    if (!query.trim() || loading) return
    setLoading(true)
    setError('')
    setResults([])
    setExplanation('')
    setSearched(true)
    try {
      const res = await fetch('/api/search/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      })
      const data = (await res.json()) as {
        bookmarks?: AIBookmark[]
        explanation?: string
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Search failed')
      setResults(data.bookmarks ?? [])
      setExplanation(data.explanation ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      void handleSearch()
    }
  }

  function handleExampleClick(example: string) {
    setQuery(example)
    // Use a short timeout so the state update propagates before the search fires
    setTimeout(() => {
      void handleSearch()
    }, 100)
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 md:p-8">
      {/* Header */}
      <div className="mb-6 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-4">
          <Sparkles size={12} /> AI-Powered Search
        </div>
        <h1 className="text-3xl font-bold text-zinc-100 mb-2">
          Find anything in your bookmarks
        </h1>
        <p className="text-zinc-500 text-sm">
          Describe what you&apos;re looking for below.
        </p>
      </div>

      {/* Search box */}
      <div className="mb-3 flex flex-col gap-3 sm:relative sm:block">
        <textarea
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`e.g. "that funny meme about devs crying over AI" or "Solana tools for tracking wallets"`}
          rows={3}
          className="w-full resize-none rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-sm text-zinc-100 transition-all placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 sm:pr-36"
        />
        <button
          onClick={() => void handleSearch()}
          disabled={loading || !query.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-40 sm:absolute sm:bottom-3 sm:right-3 sm:w-auto"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {loading ? 'Searching\u2026' : 'Search'}
        </button>
      </div>
      <p className="mb-8 text-left text-xs text-zinc-600 sm:text-right">⌘+Enter to search</p>

      {/* Image analysis status — hidden while main pipeline is running (it handles vision internally) */}
      {imageStats !== null && !pipelineRunning && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-xs sm:flex-row sm:items-center">
          <ImageIcon size={13} className="text-zinc-500 shrink-0" />
          <div className="flex-1 min-w-0">
            {imageStats.remaining === 0 ? (
              <span className="text-zinc-400">
                <span className="text-emerald-400 font-medium">{imageStats.tagged}</span> images analyzed for visual search
              </span>
            ) : (
              <span className="text-zinc-400">
                <span className="text-indigo-400 font-medium">{imageStats.tagged}</span> of{' '}
                <span className="font-medium">{imageStats.total}</span> images analyzed —{' '}
                <span className="text-zinc-500">{imageStats.remaining} remaining</span>
              </span>
            )}
          </div>
          {imageStats.remaining > 0 && (
            <button
              onClick={() => void handleAnalyzeImages()}
              disabled={analyzing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium transition-colors shrink-0"
            >
              {analyzing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              {analyzing ? 'Analyzing…' : 'Analyze images'}
            </button>
          )}
        </div>
      )}

      {/* Example queries — shown only before first search */}
      {!searched && (
        <div className="mb-8">
          <p className="text-xs text-zinc-600 mb-3 uppercase tracking-wider">Try these</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => handleExampleClick(ex)}
                className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-zinc-200 text-xs transition-all"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-6">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* Empty state */}
      {searched && !loading && results.length === 0 && !error && (
        <div className="text-center py-16 text-zinc-600">
          <BookMarked size={36} className="mx-auto mb-3 opacity-30" />
          <p>No bookmarks matched that description. Try different words.</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-zinc-400">{explanation}</p>
            <span className="text-xs text-zinc-600">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-col gap-6">
            {results.map((b) => (
              <div key={b.id}>
                {b.aiReason && (
                  <div className="flex items-start gap-1.5 mb-2 px-1">
                    <Sparkles size={10} className="text-indigo-400 shrink-0 mt-0.5" />
                    <span className="text-xs text-indigo-400/80 leading-relaxed">{b.aiReason}</span>
                  </div>
                )}
                {/* Cast to BookmarkWithMedia since BookmarkCard does not use the AI-specific fields */}
                <BookmarkCard bookmark={b as BookmarkWithMedia} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unused import guard — Search icon used as aria hint */}
      <span className="sr-only">
        <Search size={0} />
      </span>
    </div>
  )
}
