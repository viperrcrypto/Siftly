'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, CheckCircle, ChevronRight, Eye, Tag, Brain, Layers, StopCircle } from 'lucide-react'
import * as Progress from '@radix-ui/react-progress'
import { useLanguage } from '@/components/language-provider'
import { uiText, type UiLanguage } from '@/lib/i18n'

type Stage = 'vision' | 'entities' | 'enrichment' | 'categorize' | 'parallel' | null

interface StageCounts {
  visionTagged: number
  entitiesExtracted: number
  enriched: number
  categorized: number
}

interface CategorizeStatus {
  runId: string | null
  done: number
  total: number
  status: 'idle' | 'running' | 'stopping'
  stage: Stage
  stageCounts: StageCounts
  lastError: string | null
  error: string | null
}

const STAGE_INFO: Record<NonNullable<Stage>, { label: Record<UiLanguage, string>; icon: React.ReactNode; desc: Record<UiLanguage, string> }> = {
  vision: {
    label: { ja: '画像を分析中', en: 'Analyzing images' },
    icon: <Eye size={14} />,
    desc: { ja: '写真・GIF・動画からテキスト、物体、文脈を抽出します', en: 'Extracting text, objects, and context from images and videos' },
  },
  entities: {
    label: { ja: 'エンティティを抽出中', en: 'Extracting entities' },
    icon: <Tag size={14} />,
    desc: { ja: '投稿データからハッシュタグ、URL、ツール名を抽出します', en: 'Extracting hashtags, URLs, and tool names from posts' },
  },
  enrichment: {
    label: { ja: '意味タグを生成中', en: 'Generating semantic tags' },
    icon: <Brain size={14} />,
    desc: { ja: 'AI検索用にブックマークごとに30〜50個の検索タグを作成します', en: 'Creating search tags for AI-powered retrieval' },
  },
  categorize: {
    label: { ja: 'カテゴリ分類中', en: 'Categorizing bookmarks' },
    icon: <Layers size={14} />,
    desc: { ja: '各ブックマークを最も関連するカテゴリに割り当てます', en: 'Assigning each bookmark to its most relevant categories' },
  },
  parallel: {
    label: { ja: '全ステージを並列処理中', en: 'Running all stages in parallel' },
    icon: <Sparkles size={14} />,
    desc: { ja: '画像分析・情報付加・分類を20ワーカーで並列実行します', en: 'Running image analysis, enrichment, and categorization in parallel' },
  },
}

export default function CategorizePage() {
  const { language } = useLanguage()
  const [status, setStatus] = useState<CategorizeStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  function pollStatus() {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/categorize')
        const data = (await res.json()) as CategorizeStatus
        setStatus(data)
        if (data.status === 'stopping') {
          setStopping(true)
        }
        if (data.status === 'idle') {
          clearInterval(interval)
          setDone(true)
          setRunning(false)
          setStopping(false)
        }
      } catch {
        clearInterval(interval)
        setRunning(false)
      }
    }, 1000)
  }

  // On mount, check if pipeline is already running on the server
  useEffect(() => {
    void (async () => {
      try {
        const requestedRunId = new URLSearchParams(window.location.search).get('run')
        const res = await fetch('/api/categorize')
        const data = (await res.json()) as CategorizeStatus
        if (data.status === 'running' || data.status === 'stopping') {
          setStatus(data)
          setRunning(true)
          setStopping(data.status === 'stopping')
          pollStatus()
        } else if (requestedRunId && data.runId === requestedRunId && data.status === 'idle') {
          setStatus(data)
          setDone(true)
        }
      } catch { /* ignore */ }
    })()
  }, [])

  async function stopCategorization() {
    setStopping(true)
    try {
      await fetch('/api/categorize', { method: 'DELETE' })
    } catch { /* ignore */ }
  }

  async function startCategorization(force = false) {
    setError('')
    setRunning(true)
    setStopping(false)
    setDone(false)
    try {
      const res = await fetch('/api/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? uiText(language, '開始できませんでした', 'Failed to start'))
      }
      pollStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText(language, '開始できませんでした', 'Failed to start'))
      setRunning(false)
    }
  }

  const progress = status
    ? Math.round((status.done / Math.max(status.total, 1)) * 100)
    : 0

  const currentStageInfo = status?.stage ? STAGE_INFO[status.stage] : null

  return (
    <div className="p-8 max-w-xl mx-auto">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-4">
          <Sparkles size={12} /> {uiText(language, 'AI分類', 'AI Categorization')}
        </div>
        <h1 className="text-2xl font-bold text-zinc-100">{uiText(language, 'ブックマークを分類', 'Categorize bookmarks')}</h1>
        <p className="text-zinc-400 mt-1 text-sm">
          {uiText(language, '4段階のAI処理: 画像分析 → エンティティ抽出 → 意味タグ付け → カテゴリ分類', 'Four AI stages: image analysis → entity extraction → semantic tagging → categorization')}
        </p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-6">
        {!running && !done && (
          <>
            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                {error}
              </p>
            )}
            <p className="text-sm text-zinc-400 leading-relaxed">
              {uiText(language, '画像からテキストや文脈を分析し、投稿のエンティティを抽出し、意味検索タグを生成してから分類します。', 'Analyze images and post entities, generate semantic search tags, and categorize your bookmarks.')}
            </p>
            <div className="space-y-2">
              <button
                onClick={() => void startCategorization(false)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
              >
                <Sparkles size={16} />
                {uiText(language, 'AI分類を開始', 'Start AI categorization')}
              </button>
              <button
                onClick={() => void startCategorization(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm font-medium transition-colors border border-zinc-700"
              >
                {uiText(language, 'すべて再実行（強制）', 'Reprocess everything')}
              </button>
            </div>
          </>
        )}

        {running && (
          <div className="space-y-5">
            {/* Current stage indicator */}
            {currentStageInfo && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-indigo-500/8 border border-indigo-500/20">
                <div className="text-indigo-400 mt-0.5 shrink-0">{currentStageInfo.icon}</div>
                <div>
                  <p className="text-zinc-200 text-sm font-medium">{currentStageInfo.label[language]}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">{currentStageInfo.desc[language]}</p>
                </div>
                <Loader2 size={14} className="text-indigo-400 animate-spin shrink-0 ml-auto mt-0.5" />
              </div>
            )}

            {/* Stage counters — live updating rows */}
            {status?.stageCounts && (
              <div className="space-y-1.5">
                {[
                  { key: 'visionTagged', label: uiText(language, '画像分析済み', 'Images analyzed'), icon: <Eye size={13} />, active: status.stage === 'vision' || status.stage === 'parallel' },
                  { key: 'entitiesExtracted', label: uiText(language, 'エンティティ抽出済み', 'Entities extracted'), icon: <Tag size={13} />, active: status.stage === 'entities' },
                  { key: 'enriched', label: uiText(language, '情報付加済み', 'Bookmarks enriched'), icon: <Brain size={13} />, active: status.stage === 'enrichment' || status.stage === 'parallel' },
                  { key: 'categorized', label: uiText(language, '分類済み', 'Categorized'), icon: <Layers size={13} />, active: status.stage === 'categorize' || status.stage === 'parallel' },
                ].map(({ key, label, icon, active }) => {
                  const count = status.stageCounts[key as keyof StageCounts]
                  const total = key === 'categorized' ? status.total : null
                  return (
                    <div key={key} className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${active ? 'bg-indigo-500/8 border-indigo-500/20' : 'bg-zinc-800/40 border-zinc-700/30'}`}>
                      <span className={active ? 'text-indigo-400' : 'text-zinc-600'}>{icon}</span>
                      <span className={`text-sm font-semibold tabular-nums ${active ? 'text-indigo-300' : count > 0 ? 'text-zinc-200' : 'text-zinc-600'}`}>
                        {count}
                      </span>
                      <span className="text-zinc-500 text-sm">
                        {label}
                        {total != null && total > 0 ? <span className="text-zinc-600"> — {uiText(language, `残り ${total - count}件`, `${total - count} remaining`)}</span> : null}
                      </span>
                      {active && <Loader2 size={12} className="text-indigo-400 animate-spin ml-auto shrink-0" />}
                      {!active && count > 0 && <CheckCircle size={12} className="text-emerald-500 ml-auto shrink-0" />}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Stop button */}
            <button
              onClick={() => void stopCategorization()}
              disabled={stopping}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-red-400 text-sm font-medium transition-colors border border-red-500/20"
            >
              <StopCircle size={15} />
              {stopping ? uiText(language, '停止中…', 'Stopping…') : uiText(language, '処理を停止', 'Stop processing')}
            </button>

            {/* Last error warning */}
            {status?.lastError && (
              <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                ⚠ {status.lastError}
              </p>
            )}

            {/* Overall progress bar */}
            {(status?.stage === 'categorize' || status?.stage === 'parallel') && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>{status.done} / {status.total}{language === 'ja' ? '件' : ''}</span>
                  <span>{progress}%</span>
                </div>
                <Progress.Root className="relative h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                  <Progress.Indicator
                    className="h-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </Progress.Root>
              </div>
            )}
          </div>
        )}

        {done && (
          <div className="flex flex-col items-center gap-5 py-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle size={32} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-zinc-100">{uiText(language, '処理が完了しました', 'Processing complete')}</p>
              {status?.stageCounts && (
                <p className="text-zinc-500 text-sm mt-1">
                  {uiText(language,
                    `画像分析 ${status.stageCounts.visionTagged}件 · 情報付加 ${status.stageCounts.enriched}件 · 分類済み ${status.stageCounts.categorized}件`,
                    `${status.stageCounts.visionTagged} images analyzed · ${status.stageCounts.enriched} enriched · ${status.stageCounts.categorized} categorized`)}
                </p>
              )}
            </div>
            {status?.error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-left w-full">
                {status.error}
              </p>
            )}
            <div className="flex gap-3">
              <Link
                href="/bookmarks"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-colors"
              >
                {uiText(language, 'ブックマークを見る', 'View bookmarks')} <ChevronRight size={14} />
              </Link>
              <button
                onClick={() => { setDone(false); setStatus(null) }}
                className="px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors border border-zinc-700"
              >
                {uiText(language, 'もう一度実行', 'Run again')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
