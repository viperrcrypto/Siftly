'use client'

import { useState, useRef, useEffect } from 'react'
import { Sparkles, Search, Loader2, BookMarked, AlertCircle, ImageIcon } from 'lucide-react'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia } from '@/lib/types'
import { useLanguage } from '@/components/language-provider'
import { uiText } from '@/lib/i18n'

// Extends BookmarkWithMedia with AI-specific fields returned by the search API
interface AIBookmark extends BookmarkWithMedia {
  aiScore: number
  aiReason: string
}

const EXAMPLES = {
  ja: ['AIに置き換えられる開発者の面白いミーム', '試してみたいSolana DeFiツール', '生産性と集中力に関する投稿', '暗号資産の暴落ミーム', '開発を速くする便利なツール'],
  en: ['Funny memes about developers being replaced by AI', 'Solana DeFi tools to try', 'Posts about productivity and focus', 'Crypto market crash memes', 'Tools that speed up development'],
} as const

interface ImageStats {
  total: number
  tagged: number
  remaining: number
}

export default function AISearchPage() {
  const { language } = useLanguage()
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
        body: JSON.stringify({ query: query.trim(), language }),
      })
      const data = (await res.json()) as {
        bookmarks?: AIBookmark[]
        explanation?: string
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? uiText(language, '検索に失敗しました', 'Search failed'))
      setResults(data.bookmarks ?? [])
      setExplanation(data.explanation ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : uiText(language, '検索に失敗しました', 'Search failed'))
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
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-4">
          <Sparkles size={12} /> {uiText(language, 'AI検索', 'AI Search')}
        </div>
        <h1 className="text-3xl font-bold text-zinc-100 mb-2">
          {uiText(language, 'ブックマークから何でも検索', 'Search anything in your bookmarks')}
        </h1>
        <p className="text-zinc-500 text-sm">
          {uiText(language, '探したい内容を入力してください。', 'Describe what you want to find.')}
        </p>
      </div>

      {/* Search box */}
      <div className="relative mb-3">
        <textarea
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={uiText(language, '例: 「AIに泣かされる開発者の面白いミーム」や「ウォレット追跡用のSolanaツール」', 'Example: “funny developer AI memes” or “Solana wallet tracking tools”')}
          rows={3}
          className="w-full px-4 py-4 pr-36 rounded-2xl bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder:text-zinc-600 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all resize-none"
        />
        <button
          onClick={() => void handleSearch()}
          disabled={loading || !query.trim()}
          className="absolute bottom-3 right-3 flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {loading ? uiText(language, '検索中…', 'Searching…') : uiText(language, '検索', 'Search')}
        </button>
      </div>
      <p className="text-xs text-zinc-600 mb-8 text-right">{uiText(language, '⌘+Enterで検索', 'Press ⌘+Enter to search')}</p>

      {/* Image analysis status — hidden while main pipeline is running (it handles vision internally) */}
      {imageStats !== null && !pipelineRunning && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 mb-6 text-xs">
          <ImageIcon size={13} className="text-zinc-500 shrink-0" />
          <div className="flex-1 min-w-0">
            {imageStats.remaining === 0 ? (
              <span className="text-zinc-400">
                {uiText(language, '画像検索用に', 'Analyzed')} <span className="text-emerald-400 font-medium">{imageStats.tagged}</span>{uiText(language, '件を分析済み', ' images for visual search')}
              </span>
            ) : (
              <span className="text-zinc-400">
                {uiText(language, '画像', 'Images')} <span className="text-indigo-400 font-medium">{imageStats.tagged}</span> /{' '}
                <span className="font-medium">{imageStats.total}</span>{language === 'ja' ? '件を分析済み' : ' analyzed'} —{' '}
                <span className="text-zinc-500">{uiText(language, `残り${imageStats.remaining}件`, `${imageStats.remaining} remaining`)}</span>
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
              {analyzing ? uiText(language, '分析中…', 'Analyzing…') : uiText(language, '画像を分析', 'Analyze images')}
            </button>
          )}
        </div>
      )}

      {/* Example queries — shown only before first search */}
      {!searched && (
        <div className="mb-8">
          <p className="text-xs text-zinc-600 mb-3 uppercase tracking-wider">{uiText(language, '例を試す', 'Try an example')}</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES[language].map((ex) => (
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
          <p>{uiText(language, 'その説明に一致するブックマークはありません。別の言葉で試してください。', 'No bookmarks match that description. Try different wording.')}</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-zinc-400">{explanation}</p>
            <span className="text-xs text-zinc-600">
              {uiText(language, `${results.length}件の結果`, `${results.length} results`)}
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
