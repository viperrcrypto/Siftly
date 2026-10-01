'use client'

import { useState, useEffect } from 'react'
import { Loader2, Bookmark, Sparkles, CheckCircle } from 'lucide-react'
import type { Node, Edge } from '@xyflow/react'
import dynamic from 'next/dynamic'

const MindmapCanvas = dynamic(
  () => import('@/components/mindmap/mindmap-canvas'),
  { ssr: false, loading: () => <CanvasLoader /> }
)

interface MindmapData {
  nodes: Node[]
  edges: Edge[]
}

interface CategoryLegendItem {
  name: string
  color: string
  slug: string
}

function CanvasLoader() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <Loader2 size={32} className="text-indigo-400 animate-spin" />
    </div>
  )
}

function Legend({ categories }: { categories: CategoryLegendItem[] }) {
  if (categories.length === 0) return null

  return (
    <div className="absolute top-4 left-4 z-10 bg-zinc-900/90 backdrop-blur-sm border border-zinc-800 rounded-xl p-4 max-w-52">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">カテゴリ</p>
      <div className="space-y-2">
        {categories.map((cat) => (
          <div key={cat.slug} className="flex items-center gap-2">
            <Bookmark size={12} className="shrink-0" style={{ color: cat.color, fill: cat.color }} />
            <span className="text-xs text-zinc-300 truncate">{cat.name}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-600 mt-3">カテゴリをクリックして展開</p>
    </div>
  )
}

function extractLegend(nodes: Node[]): CategoryLegendItem[] {
  return nodes
    .filter((n) => n.type === 'category')
    .map((n) => {
      const d = n.data as { name: string; color: string; slug: string }
      return { name: d.name, color: d.color, slug: d.slug }
    })
}

type CategorizeStage = 'vision' | 'entities' | 'enrichment' | 'categorize' | 'parallel' | null

interface CategorizeStatus {
  status: 'idle' | 'running' | 'stopping'
  stage: CategorizeStage
  done: number
  total: number
}

const STAGE_LABELS: Record<NonNullable<CategorizeStage>, string> = {
  entities: 'エンティティを抽出中…',
  vision: '画像を分析中…',
  enrichment: '意味タグを生成中…',
  categorize: 'ブックマークを分類中…',
  parallel: 'ブックマークを並列処理中…',
}

function UncategorizedState({ totalBookmarks }: { totalBookmarks: number }) {
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [status, setStatus] = useState<CategorizeStatus | null>(null)
  const [error, setError] = useState('')

  function pollStatus() {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/categorize')
        const data = await res.json() as CategorizeStatus
        setStatus(data)
        if (data.status === 'idle') {
          clearInterval(interval)
          setDone(true)
          setRunning(false)
          // Reload to show the populated mindmap
          setTimeout(() => window.location.reload(), 800)
        }
      } catch {
        clearInterval(interval)
        setRunning(false)
      }
    }, 1500)
  }

  // Auto-attach if pipeline is already running (e.g. started from import screen)
  useEffect(() => {
    fetch('/api/categorize')
      .then((r) => r.json())
      .then((d: CategorizeStatus) => {
        if (d.status === 'running' || d.status === 'stopping') {
          setStatus(d)
          setRunning(true)
          pollStatus()
        }
      })
      .catch(() => {})
  }, [])

  async function startCategorization() {
    setError('')
    setRunning(true)
    try {
      const res = await fetch('/api/categorize', { method: 'POST' })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? 'Failed to start')
      }
      pollStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start')
      setRunning(false)
    }
  }

  const progress = status?.stage === 'categorize' && status.total > 0
    ? Math.round((status.done / status.total) * 100)
    : null

  const stageLabel = status?.stage ? STAGE_LABELS[status.stage] : '開始中…'

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3">
        <CheckCircle size={36} className="text-emerald-400" />
        <p className="text-zinc-200 font-semibold">分類が完了しました</p>
        <p className="text-zinc-500 text-sm">マインドマップを読み込み中…</p>
        <Loader2 size={18} className="text-indigo-400 animate-spin mt-1" />
      </div>
    )
  }

  if (running) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <Loader2 size={36} className="text-indigo-400 animate-spin" />
        <div>
          <p className="text-zinc-200 font-semibold">{stageLabel}</p>
          {status?.stage === 'categorize' && status.total > 0 && (
            <p className="text-zinc-500 text-sm mt-1">
              {status.done} / {status.total}件
              {progress !== null && ` (${progress}%)`}
            </p>
          )}
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-5 text-center max-w-sm">
      <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
        <Sparkles size={28} className="text-indigo-400" />
      </div>
      <div>
        <p className="text-xl font-semibold text-zinc-100">まだ分類されていません</p>
        <p className="text-zinc-500 text-sm mt-1.5 leading-relaxed">
          <span className="text-zinc-300 font-medium">{totalBookmarks.toLocaleString()}</span>件のブックマークをインポート済みです。
          AI分類を実行するとマインドマップが表示されます。
        </p>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        onClick={() => void startCategorization()}
        className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
      >
        <Sparkles size={16} />
        AI分類を開始
      </button>
    </div>
  )
}

function MindmapOverlay({
  totalBookmarks,
  pipeline,
  onDismiss,
}: {
  totalBookmarks: number
  pipeline: CategorizeStatus | null
  onDismiss: () => void
}) {
  const [running, setRunning] = useState(pipeline?.status === 'running' || pipeline?.status === 'stopping')
  const [done, setDone] = useState(false)
  const [status, setStatus] = useState<CategorizeStatus | null>(pipeline)
  const [error, setError] = useState('')

  function pollStatus() {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/categorize')
        const data = await res.json() as CategorizeStatus
        setStatus(data)
        if (data.status === 'idle') {
          clearInterval(interval)
          setDone(true)
          setRunning(false)
          setTimeout(() => window.location.reload(), 800)
        }
      } catch {
        clearInterval(interval)
        setRunning(false)
      }
    }, 1500)
  }

  // Auto-attach if pipeline is running
  useEffect(() => {
    if (pipeline?.status === 'running' || pipeline?.status === 'stopping') {
      pollStatus()
    }
  }, [pipeline?.status])

  async function startCategorization() {
    setError('')
    setRunning(true)
    try {
      const res = await fetch('/api/categorize', { method: 'POST' })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? 'Failed to start')
      }
      pollStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start')
      setRunning(false)
    }
  }

  const isPipelineRunning = pipeline?.status === 'running' || pipeline?.status === 'stopping'
  const stageLabel = status?.stage ? STAGE_LABELS[status.stage] : '開始中…'
  const progress = status?.stage === 'categorize' && status.total > 0
    ? Math.round((status.done / status.total) * 100)
    : null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl text-center">
        {done ? (
          <div className="flex flex-col items-center gap-4">
            <CheckCircle size={44} className="text-emerald-400" />
            <p className="text-xl font-bold text-zinc-100">分類が完了しました</p>
            <p className="text-zinc-500 text-sm">マインドマップを再読み込み中…</p>
            <Loader2 size={18} className="text-indigo-400 animate-spin" />
          </div>
        ) : running ? (
          <div className="flex flex-col items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Loader2 size={32} className="text-indigo-400 animate-spin" />
            </div>
            <div>
              <p className="text-xl font-bold text-zinc-100">AI分類を実行中</p>
              <p className="text-zinc-400 text-sm mt-1.5">{stageLabel}</p>
              {status?.stage === 'categorize' && status.total > 0 && (
                <p className="text-zinc-500 text-sm mt-1">
                  {status.done} / {status.total}件
                  {progress !== null && ` (${progress}%)`}
                </p>
              )}
            </div>
            <p className="text-zinc-600 text-xs">
              完了するとマインドマップが自動的に表示されます。
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Sparkles size={28} className="text-indigo-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-zinc-100">まだ分類されていません</p>
              <p className="text-zinc-400 text-sm mt-2 leading-relaxed">
                <span className="text-zinc-200 font-semibold">{totalBookmarks.toLocaleString()}</span>件のブックマークをインポート済みです。
                AI分類が完了するとマインドマップが表示されます。
              </p>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex flex-col gap-2 w-full">
              <button
                onClick={() => void startCategorization()}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
              >
                <Sparkles size={16} />
                AI分類を開始
              </button>
              {isPipelineRunning && (
                <button
                  onClick={onDismiss}
                  className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors py-1"
                >
                  閉じて空のマップを見る
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MindmapPage() {
  const [data, setData] = useState<MindmapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [totalBookmarks, setTotalBookmarks] = useState(0)
  const [pipeline, setPipeline] = useState<CategorizeStatus | null>(null)
  const [overlayDismissed, setOverlayDismissed] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/mindmap').then((r) => {
        if (!r.ok) throw new Error('マインドマップの読み込みに失敗しました')
        return r.json() as Promise<MindmapData>
      }),
      fetch('/api/stats').then((r) => r.json() as Promise<{ totalBookmarks?: number }>),
      fetch('/api/categorize').then((r) => r.json() as Promise<CategorizeStatus>),
    ])
      .then(([mindmapData, stats, pipelineStatus]) => {
        setData(mindmapData)
        setTotalBookmarks(stats.totalBookmarks ?? 0)
        setPipeline(pipelineStatus)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '不明なエラーが発生しました'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen w-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={36} className="text-indigo-400 animate-spin" />
          <p className="text-zinc-400 text-sm">マインドマップを読み込み中…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen w-full">
        <p className="text-zinc-400">{error}</p>
      </div>
    )
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen w-full">
        {totalBookmarks > 0 ? (
          <UncategorizedState totalBookmarks={totalBookmarks} />
        ) : (
          <div className="text-center">
            <p className="text-xl font-semibold text-zinc-400">表示するデータがありません</p>
            <p className="text-zinc-600 text-sm mt-1">まずブックマークをインポートして分類してください。</p>
          </div>
        )}
      </div>
    )
  }

  // Check if categories exist but nothing is assigned yet
  const totalCategorized = data.nodes
    .filter((n) => n.type === 'category')
    .reduce((sum, n) => sum + (((n.data as { count?: number }).count) ?? 0), 0)

  const showOverlay = !overlayDismissed && totalBookmarks > 0 && totalCategorized === 0

  const legend = extractLegend(data.nodes)

  return (
    <div className="relative w-full h-screen">
      <Legend categories={legend} />
      <MindmapCanvas initialNodes={data.nodes} initialEdges={data.edges} />
      {showOverlay && (
        <MindmapOverlay
          totalBookmarks={totalBookmarks}
          pipeline={pipeline}
          onDismiss={() => setOverlayDismissed(true)}
        />
      )}
    </div>
  )
}
