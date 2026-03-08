'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, CheckCircle, ChevronRight, Eye, Tag, Brain, Layers, StopCircle } from 'lucide-react'
import * as Progress from '@radix-ui/react-progress'

type Stage = 'vision' | 'entities' | 'enrichment' | 'categorize' | 'parallel' | null

interface StageCounts {
  visionTagged: number
  entitiesExtracted: number
  enriched: number
  categorized: number
}

interface CategorizeStatus {
  done: number
  total: number
  status: 'idle' | 'running' | 'stopping'
  stage: Stage
  stageCounts: StageCounts
  lastError: string | null
  error: string | null
}

const STAGE_INFO: Record<NonNullable<Stage>, { label: string; icon: React.ReactNode; desc: string }> = {
  vision: {
    label: 'Analyzing images',
    icon: <Eye size={14} />,
    desc: 'Extracting text, objects, and context from photos, GIFs, and videos',
  },
  entities: {
    label: 'Extracting entities',
    icon: <Tag size={14} />,
    desc: 'Mining hashtags, URLs, and tool mentions from tweet data',
  },
  enrichment: {
    label: 'Generating semantic tags',
    icon: <Brain size={14} />,
    desc: 'Creating 30-50 searchable tags per bookmark for AI search',
  },
  categorize: {
    label: 'Categorizing',
    icon: <Layers size={14} />,
    desc: 'Assigning each bookmark to the most relevant categories',
  },
  parallel: {
    label: 'Processing all stages in parallel',
    icon: <Sparkles size={14} />,
    desc: 'Vision, enrichment, and categorization running concurrently across 20 workers',
  },
}

export default function CategorizePage() {
  const [status, setStatus] = useState<CategorizeStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // On mount, check if pipeline is already running on the server
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/categorize')
        const data = (await res.json()) as CategorizeStatus
        if (data.status === 'running' || data.status === 'stopping') {
          setStatus(data)
          setRunning(true)
          setStopping(data.status === 'stopping')
          pollStatus()
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
        throw new Error(data.error ?? 'Failed to start')
      }
      pollStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start')
      setRunning(false)
    }
  }

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

  const progress = status
    ? Math.round((status.done / Math.max(status.total, 1)) * 100)
    : 0

  const currentStageInfo = status?.stage ? STAGE_INFO[status.stage] : null

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6 md:p-8">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-4">
          <Sparkles size={12} /> AI Categorization
        </div>
        <h1 className="text-2xl font-bold text-zinc-100">Categorize Bookmarks</h1>
        <p className="text-zinc-400 mt-1 text-sm">
          4-stage AI pipeline: vision analysis → entity extraction → semantic tagging → categorization.
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
              Analyzes images for text and context, mines tweet entities for free, generates
              semantic search tags, then categorizes — all automatically.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => void startCategorization(false)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
              >
                <Sparkles size={16} />
                Start AI Categorization
              </button>
              <button
                onClick={() => void startCategorization(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm font-medium transition-colors border border-zinc-700"
              >
                Re-run everything (force all)
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
                  <p className="text-zinc-200 text-sm font-medium">{currentStageInfo.label}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">{currentStageInfo.desc}</p>
                </div>
                <Loader2 size={14} className="text-indigo-400 animate-spin shrink-0 ml-auto mt-0.5" />
              </div>
            )}

            {/* Stage counters — live updating rows */}
            {status?.stageCounts && (
              <div className="space-y-1.5">
                {[
                  { key: 'visionTagged', label: 'images analyzed', icon: <Eye size={13} />, active: status.stage === 'vision' || status.stage === 'parallel' },
                  { key: 'entitiesExtracted', label: 'entities extracted', icon: <Tag size={13} />, active: status.stage === 'entities' },
                  { key: 'enriched', label: 'bookmarks enriched', icon: <Brain size={13} />, active: status.stage === 'enrichment' || status.stage === 'parallel' },
                  { key: 'categorized', label: 'categorized', icon: <Layers size={13} />, active: status.stage === 'categorize' || status.stage === 'parallel' },
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
                        {total != null && total > 0 ? <span className="text-zinc-600"> — {total - count} remaining</span> : null}
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
              {stopping ? 'Stopping…' : 'Stop pipeline'}
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
                  <span>{status.done} / {status.total} bookmarks</span>
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
              <p className="text-xl font-bold text-zinc-100">Pipeline Complete!</p>
              {status?.stageCounts && (
                <p className="text-zinc-500 text-sm mt-1">
                  {status.stageCounts.visionTagged} images analyzed ·{' '}
                  {status.stageCounts.enriched} bookmarks enriched ·{' '}
                  {status.stageCounts.categorized} categorized
                </p>
              )}
            </div>
            {status?.error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-left w-full">
                {status.error}
              </p>
            )}
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link
                href="/bookmarks"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 sm:w-auto"
              >
                View bookmarks <ChevronRight size={14} />
              </Link>
              <button
                onClick={() => { setDone(false); setStatus(null) }}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 sm:w-auto"
              >
                Run again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
