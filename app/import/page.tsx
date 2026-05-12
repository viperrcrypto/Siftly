'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { Upload, CheckCircle, ChevronRight, Loader2, Copy, Check, ExternalLink, Sparkles, Eye, Tag, Brain, Layers, StopCircle, RefreshCw, Clock, KeyRound, Trash2, AlertCircle, User, LogOut } from 'lucide-react'
import * as Progress from '@radix-ui/react-progress'

type Step = 1 | 2 | 3
type Method = 'bookmarklet' | 'console' | 'live'

interface ImportResult {
  imported: number
  skipped: number
  total: number
  parsed: number
}

type Stage = 'vision' | 'entities' | 'enrichment' | 'categorize' | 'parallel' | null

interface StageCounts {
  visionTagged: number
  entitiesExtracted: number
  enriched: number
  categorized: number
}

interface CategorizeStatus {
  status: 'idle' | 'running' | 'stopping'
  stage: Stage
  done: number
  total: number
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

// Bookmarklet / console capture scripts live in public/js; InstructionsStep fetches them on mount.

const IMPORT_CAPTURE_SCRIPTS = {
  bookmarklet: '/js/import-bookmarklet.js',
  console: '/js/import-console.js',
} as const

function compactBookmarkletScript(script: string) {
  return script
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      if (line.startsWith('//')) return false
      if (line.startsWith('/*') && line.endsWith('*/')) return false
      return true
    })
    .join(' ')
}

// ── Draggable bookmarklet link ────────────────────────────────────────────────
// React blocks javascript: URLs set via JSX href as a security precaution.
// We bypass this by setting the href attribute imperatively after mount so the
// drag-to-bookmark-bar flow still works correctly in all browsers.

function DraggableBookmarklet({ bookmarkletHref }: { bookmarkletHref: string }) {
  const linkRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    // Set href imperatively — bypasses React's javascript: URL XSS guard
    if (bookmarkletHref) linkRef.current?.setAttribute('href', bookmarkletHref)
  }, [bookmarkletHref])

  return (
    <a
      ref={linkRef}
      draggable={!!bookmarkletHref}
      onClick={(e) => e.preventDefault()}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold select-none transition-colors ${
        bookmarkletHref ? 'hover:bg-indigo-500 cursor-grab active:cursor-grabbing' : 'opacity-40 cursor-not-allowed pointer-events-none'
      }`}
      title="Drag this to your bookmarks bar — do not click"
    >
      📥 Export X Bookmarks
    </a>
  )
}

// ── Components ────────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps = ['Upload', 'Importing', 'Categorize']
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((label, i) => {
        const num = (i + 1) as Step
        const isActive = num === current
        const isDone = num < current
        return (
          <div key={label} className="flex items-center gap-2">
            <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all ${
              isDone ? 'bg-emerald-500 text-white' : isActive ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-500'
            }`}>
              {isDone ? <CheckCircle size={14} /> : num}
            </div>
            <span className={`text-sm ${isActive ? 'text-zinc-100' : 'text-zinc-500'}`}>{label}</span>
            {i < steps.length - 1 && <ChevronRight size={14} className="text-zinc-700 ml-1" />}
          </div>
        )
      })}
    </div>
  )
}

function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    if (!text || disabled) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled || !text}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors disabled:opacity-40 disabled:pointer-events-none"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function UploadZone({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.json')) onFile(file)
  }, [onFile])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }, [onFile])

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
        dragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/30'
      }`}
    >
      <Upload size={28} className="mx-auto mb-3 text-zinc-500" />
      <p className="text-zinc-300 font-medium text-sm">Drop your JSON file here</p>
      <p className="text-zinc-600 text-xs mt-1">or click to browse</p>
      <input ref={inputRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} />
    </div>
  )
}

function BookmarkletTab({
  onFile,
  importSource,
  bookmarkletHref,
  captureScriptsLoading,
  captureScriptsError,
}: {
  onFile: (file: File) => void
  importSource: 'bookmark' | 'like'
  bookmarkletHref: string
  captureScriptsLoading: boolean
  captureScriptsError: string | null
}) {
  const targetUrl = importSource === 'like' ? 'https://x.com' : 'https://x.com/i/bookmarks'
  const targetLabel = importSource === 'like' ? 'x.com/YourUsername/likes' : 'x.com/i/bookmarks'
  const sourceLabel = importSource === 'like' ? 'likes' : 'bookmarks'
  const steps = [
    {
      num: 1,
      title: 'Add the bookmarklet to your bookmark bar',
      content: (
        <div className="mt-2 space-y-3">
          {captureScriptsError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{captureScriptsError}</p>
          )}
          {captureScriptsLoading && !captureScriptsError && (
            <p className="text-xs text-zinc-500 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin shrink-0" />
              Loading bookmarklet…
            </p>
          )}
          <p className="text-xs text-zinc-500">
            Show your bookmark bar first: <strong className="text-zinc-300">View → Show Bookmarks Bar</strong>
          </p>
          {/* Option A: Drag */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-800/60 border border-zinc-700/50">
            <div className="shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold">A</div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-300 mb-1.5">Drag to bookmark bar</p>
              <DraggableBookmarklet bookmarkletHref={bookmarkletHref} />
            </div>
          </div>
          {/* Option B: Manual (more reliable in Chrome) */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-800/60 border border-zinc-700/50">
            <div className="shrink-0 w-6 h-6 rounded-full bg-zinc-600/40 text-zinc-400 flex items-center justify-center text-xs font-bold mt-0.5">B</div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-zinc-300 mb-1.5">Manual (works in all browsers)</p>
              <ol className="text-xs text-zinc-500 space-y-0.5 mb-2">
                <li>1. Copy the URL below</li>
                <li>2. Right-click bookmark bar → <strong className="text-zinc-400">Add bookmark / New bookmark</strong></li>
                <li>3. Name it <em className="text-zinc-400">Export X Bookmarks</em> and paste the URL</li>
              </ol>
              <CopyButton text={bookmarkletHref} disabled={captureScriptsLoading || !!captureScriptsError} />
            </div>
          </div>
        </div>
      ),
    },
    {
      num: 2,
      title: (
        <span>
          Click this{' '}
          <button
            type="button"
            onClick={() => window.open(targetUrl, 'siftly_x_capture')}
            className="text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-1 align-baseline bg-transparent border-0 p-0 cursor-pointer font-inherit"
          >
            {targetLabel} <ExternalLink size={11} />
          </button>{' '}
          in a <kbd className="text-xs bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded font-mono">linked-window</kbd> while logged in
        </span>
      ),
      content: (
        <p className="text-xs text-zinc-500 mt-1">
          Keep this Import tab open to receive captured bookmarks and import them automatically.
        </p>
      ),
    },
    {
      num: 3,
      title: `Click "Export X Bookmarks" in your bookmark bar`,
      content: (
        <p className="text-xs text-zinc-500 mt-1">
          A purple Export button will appear on the page
        </p>
      ),
    },
    {
      num: 4,
      title: 'Click "▶ Auto-scroll" to capture all bookmarks automatically',
      content: (
        <p className="text-xs text-zinc-500 mt-1">
          A second button appears below the export button. Click it and it will scroll through all your bookmarks automatically — stopping when done. Or scroll manually if you prefer.
          When scrolling finishes, bookmarks are sent to this tab automatically (no file upload). You can still use Export to download JSON.
        </p>
      ),
    },
    {
      num: 5,
      title: `Optional: Click the purple "Export N ${sourceLabel}" button`,
      content: (
        <p className="text-xs text-zinc-500 mt-1">
          A <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">{sourceLabel}.json</code> file will download automatically.
          Upload it below. <kbd className="text-xs bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded font-mono">linked-window</kbd> will import automatically and skip this step. 
        </p>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-400 mt-0.5">
              {step.num}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-zinc-300 leading-relaxed">{step.title}</p>
              {step.content}
            </div>
          </li>
        ))}
      </ol>

      <div className="border-t border-zinc-800 pt-5">
        <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider font-medium">Upload the downloaded file</p>
        <UploadZone onFile={onFile} />
      </div>
    </div>
  )
}

function ConsoleTab({
  onFile,
  importSource,
  consoleScript,
  captureScriptsLoading,
  captureScriptsError,
}: {
  onFile: (file: File) => void
  importSource: 'bookmark' | 'like'
  consoleScript: string
  captureScriptsLoading: boolean
  captureScriptsError: string | null
}) {
  const targetUrl = importSource === 'like' ? 'https://x.com' : 'https://x.com/i/bookmarks'
  const targetLabel = importSource === 'like' ? 'x.com/YourUsername/likes' : 'x.com/i/bookmarks'
  const sourceLabel = importSource === 'like' ? 'likes' : 'bookmarks'
  const steps = [
    {
      num: 1,
      title: (
        <span>
          Click this{' '}
          <button
            type="button"
            onClick={() => window.open(targetUrl, 'siftly_x_capture')}
            className="text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-1 align-baseline bg-transparent border-0 p-0 cursor-pointer font-inherit"
          >
            {targetLabel} <ExternalLink size={11} />
          </button>{' '}
          in a <kbd className="text-xs bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded font-mono">linked-window</kbd> while logged in
        </span>
      ),
      content: (
        <p className="text-xs text-zinc-500 mt-1">
           Keep this Import tab open to receive captured bookmarks and import them automatically.
        </p>
      ),
    },
    {
      num: 2,
      title: 'Open browser DevTools and go to the Console tab',
      content: (
        <p className="text-xs text-zinc-500 mt-1">
          Press <kbd className="text-xs bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded font-mono">F12</kbd> on Windows/Linux or{' '}
          <kbd className="text-xs bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded font-mono">⌘⌥J</kbd> on Mac,
          then click the <strong className="text-zinc-300">Console</strong> tab
        </p>
      ),
    },
    {
      num: 3,
      title: 'Paste and run the script below',
      content: (
        <div className="mt-2">
          {captureScriptsError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-2">{captureScriptsError}</p>
          )}
          <div className="relative rounded-xl overflow-hidden border border-zinc-700 bg-zinc-950">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
              <span className="text-xs text-zinc-600 font-mono">console script</span>
              <CopyButton text={consoleScript} disabled={captureScriptsLoading || !!captureScriptsError} />
            </div>
            <pre className="text-xs text-zinc-400 p-3 overflow-auto max-h-40 font-mono leading-relaxed">
              {captureScriptsLoading && !captureScriptsError ? (
                <span className="text-zinc-500 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin shrink-0" />
                  Loading script…
                </span>
              ) : (
                <>{consoleScript.slice(0, 300)}...</>
              )}
            </pre>
          </div>
        </div>
      ),
    },
    {
      num: 4,
      title: `Press Enter, then scroll through all your ${sourceLabel}`,
      content: (
        <p className="text-xs text-zinc-500 mt-1">
          A purple button will appear. Scroll slowly to capture all {sourceLabel}, then click the button to download.
          <kbd className="text-xs bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded font-mono">linked-window</kbd> will import automatically no need to upload.
        </p>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center text-xs font-bold text-zinc-400 mt-0.5">
              {step.num}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-zinc-300 leading-relaxed">{step.title}</p>
              {step.content}
            </div>
          </li>
        ))}
      </ol>

      <div className="border-t border-zinc-800 pt-5">
        <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider font-medium">Upload the downloaded file</p>
        <UploadZone onFile={onFile} />
      </div>
    </div>
  )
}

// ── Live Import Tab (OAuth 2.0 PKCE) ─────────────────────────────────────────

interface OAuthStatus {
  configured: boolean
  connected: boolean
  tokenExpired?: boolean
  user?: { id?: string; name?: string; username?: string } | null
  error?: string
}

function LiveImportTab({ onSynced }: { onSynced: (result: ImportResult) => void }) {
  const [status, setStatus] = useState<OAuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState('')

  // Check for OAuth callback params in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('x_connected') === 'true') {
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('x_error')) {
      setError(`OAuth error: ${params.get('x_error')}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Fetch status on mount
  useEffect(() => {
    fetch('/api/import/x-oauth/status')
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to check status')
        const data: OAuthStatus = await r.json()
        setStatus(data)
      })
      .catch(() => setError('Could not connect to the server'))
      .finally(() => setLoading(false))
  }, [])

  async function handleConnect() {
    setError('')
    setConnecting(true)
    try {
      const res = await fetch('/api/import/x-oauth/authorize')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to start OAuth')
      window.location.href = data.authUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    setError('')
    setDisconnecting(true)
    try {
      const res = await fetch('/api/import/x-oauth/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to disconnect')
      setStatus({ configured: true, connected: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleFetchBookmarks() {
    setError('')
    setSyncing(true)
    try {
      const res = await fetch('/api/import/x-oauth/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 10 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Fetch failed')
      onSynced({
        imported: data.imported ?? 0,
        skipped: data.skipped ?? 0,
        total: data.total ?? 0,
        parsed: data.total ?? 0,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-zinc-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="text-xs text-zinc-500 space-y-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
        <p className="text-zinc-300 font-medium text-sm mb-2 flex items-center gap-2">
          <ExternalLink size={14} className="text-indigo-400" />
          X OAuth 2.0 (Recommended)
        </p>
        <p>Connect your X account using the official OAuth 2.0 flow. This is the X-approved method — no cookies or session tokens needed.</p>
        <p className="text-zinc-600 mt-1">Requires X OAuth Client ID in Settings. Scopes: bookmark.read, tweet.read, users.read</p>
        <p className="text-amber-400/80 mt-2 font-medium">Note: The X API requires a paid Basic tier ($200/mo) or higher for bookmark.read scope access. The free tier does not support fetching bookmarks.</p>
      </div>

      {/* Not configured */}
      {!status?.configured && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-500/8 border border-amber-500/20">
          <AlertCircle size={15} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-sm text-amber-300">X OAuth not configured</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Add your X OAuth Client ID (and optionally Client Secret) in{' '}
              <Link href="/settings" className="text-indigo-400 hover:underline">Settings</Link>
            </p>
          </div>
        </div>
      )}

      {/* Configured but not connected */}
      {status?.configured && !status?.connected && (
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-white font-medium transition-colors flex items-center justify-center gap-2.5"
        >
          {connecting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Redirecting to X...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              Connect X Account
            </>
          )}
        </button>
      )}

      {/* Connected */}
      {status?.connected && (
        <>
          <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
            <div className="flex items-center gap-2.5">
              <CheckCircle size={15} className="text-emerald-400 shrink-0" />
              <div>
                <span className="text-sm text-emerald-300">Connected to X</span>
                {status.user?.username && (
                  <span className="text-xs text-zinc-500 ml-2">
                    <User size={11} className="inline -mt-0.5 mr-0.5" />
                    @{status.user.username}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Disconnect X account"
            >
              {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            </button>
          </div>

          {status.tokenExpired && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
              <AlertCircle size={14} className="text-amber-400 shrink-0" />
              <p className="text-xs text-amber-300">Token expired. Siftly will try to auto-refresh, or you can reconnect.</p>
            </div>
          )}

          <button
            onClick={handleFetchBookmarks}
            disabled={syncing}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            {syncing ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Fetching bookmarks...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Fetch Bookmarks from X
              </>
            )}
          </button>
        </>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  )
}

function InstructionsStep({ onFile, importSource, onLiveSynced }: { onFile: (file: File) => void; importSource: 'bookmark' | 'like'; onLiveSynced: (result: ImportResult) => void }) {
  const [method, setMethod] = useState<Method>('bookmarklet')
  const [captureBookmarklet, setCaptureBookmarklet] = useState('')
  const [captureConsole, setCaptureConsole] = useState('')
  const [captureScriptsLoading, setCaptureScriptsLoading] = useState(true)
  const [captureScriptsError, setCaptureScriptsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(IMPORT_CAPTURE_SCRIPTS.bookmarklet).then((r) => {
        if (!r.ok) throw new Error(`bookmarklet ${r.status}`)
        return r.text()
      }),
      fetch(IMPORT_CAPTURE_SCRIPTS.console).then((r) => {
        if (!r.ok) throw new Error(`console ${r.status}`)
        return r.text()
      }),
    ])
      .then(([bm, cs]) => {
        if (cancelled) return
        setCaptureBookmarklet(bm)
        setCaptureConsole(cs)
      })
      .catch(() => {
        if (!cancelled) {
          setCaptureScriptsError('Could not load export scripts. Refresh the page or check that /js/import-*.js are deployed.')
        }
      })
      .finally(() => {
        if (!cancelled) setCaptureScriptsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const bookmarkletHref = captureBookmarklet
    ? `javascript:${encodeURIComponent(compactBookmarkletScript(captureBookmarklet))}`
    : ''

  return (
    <div>
      {/* Method tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-zinc-800 rounded-xl">
        <button
          onClick={() => setMethod('live')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            method === 'live'
              ? 'bg-zinc-900 text-zinc-100 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <RefreshCw size={13} className="inline -mt-0.5 mr-1" />
          Live Import
          <span className="ml-1.5 text-xs text-indigo-400 font-normal">Recommended</span>
        </button>
        <button
          onClick={() => setMethod('bookmarklet')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            method === 'bookmarklet'
              ? 'bg-zinc-900 text-zinc-100 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Bookmarklet
        </button>
        <button
          onClick={() => setMethod('console')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            method === 'console'
              ? 'bg-zinc-900 text-zinc-100 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {'</>'} Console
        </button>
      </div>

      {method === 'live' ? (
        <LiveImportTab onSynced={onLiveSynced} />
      ) : method === 'bookmarklet' ? (
        <BookmarkletTab
          onFile={onFile}
          importSource={importSource}
          bookmarkletHref={bookmarkletHref}
          captureScriptsLoading={captureScriptsLoading}
          captureScriptsError={captureScriptsError}
        />
      ) : (
        <ConsoleTab
          onFile={onFile}
          importSource={importSource}
          consoleScript={captureConsole}
          captureScriptsLoading={captureScriptsLoading}
          captureScriptsError={captureScriptsError}
        />
      )}
    </div>
  )
}

function ImportingStep({ result }: {
  result: ImportResult | null
}) {
  if (!result) {
    return (
      <div className="flex flex-col items-center gap-4 py-10">
        <Loader2 size={40} className="text-indigo-400 animate-spin" />
        <p className="text-zinc-300 text-lg font-medium">Importing bookmarks...</p>
        <p className="text-zinc-500 text-sm">This may take a moment</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
        <CheckCircle size={32} className="text-emerald-400" />
      </div>
      <div className="text-center">
        <p className="text-xl font-bold text-zinc-100">Import Complete</p>
        <p className="text-zinc-400 mt-1">
          <span className="text-emerald-400 font-semibold">{result.imported}</span> imported,{' '}
          <span className="text-zinc-500">{result.skipped} skipped</span> as duplicates
        </p>
      </div>
      <div className="flex items-center gap-2 text-indigo-400 text-sm">
        <Loader2 size={14} className="animate-spin" />
        Starting AI categorization…
      </div>
    </div>
  )
}

function CategorizeStep({ importedCount, force = false }: { importedCount: number; force?: boolean }) {
  const [status, setStatus] = useState<CategorizeStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // On mount: attach to running pipeline, or start one if new bookmarks were imported.
  // importedCount: -1 = direct trigger (not from import), 0 = all skipped, >0 = new bookmarks
  useEffect(() => {
    // All skipped — nothing to categorize
    if (importedCount === 0) return

    void (async () => {
      try {
        const res = await fetch('/api/categorize')
        const data = await res.json() as CategorizeStatus
        if (data.status === 'running' || data.status === 'stopping') {
          // Pipeline already in progress — attach to it
          setStatus(data)
          setRunning(true)
          setStopping(data.status === 'stopping')
          pollStatus()
        } else {
          // Start a fresh pipeline for the newly imported bookmarks
          void startCategorization(force)
        }
      } catch {
        void startCategorization(force)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function stopCategorization() {
    setStopping(true)
    try {
      const res = await fetch('/api/categorize', { method: 'DELETE' })
      if (!res.ok) throw new Error('Server returned ' + res.status)
    } catch {
      setStopping(false)
      setError('Failed to stop pipeline — try again')
    }
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
        body: JSON.stringify(force ? { force: true } : {}),
      })
      if (!res.ok && res.status !== 409) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to start categorization')
      }
      pollStatus()
    } catch (err) {
      setError(`Failed to start: ${err instanceof Error ? err.message : String(err)}`)
      setRunning(false)
    }
  }

  function pollStatus() {
    if (pollRef.current) clearInterval(pollRef.current)
    let pollFailures = 0
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/categorize')
        const data = await res.json() as CategorizeStatus
        pollFailures = 0
        setStatus(data)
        if (data.status === 'stopping') setStopping(true)
        if (data.status === 'idle') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setDone(true)
          setRunning(false)
          setStopping(false)
        }
      } catch {
        pollFailures++
        if (pollFailures >= 5) {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setRunning(false)
          setError('Lost connection to the server. The pipeline may still be running — refresh to check.')
        }
      }
    }, 1000)
  }

  const progress = status ? Math.round((status.done / Math.max(status.total, 1)) * 100) : 0
  const currentStageInfo = status?.stage ? STAGE_INFO[status.stage] : null

  return (
    <div className="space-y-6">
      {!running && !done && error && (
        <div className="space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => void startCategorization()}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
          >
            Retry Categorization
          </button>
        </div>
      )}

      {running && (
        <div className="space-y-4">
          {/* Current stage */}
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

          {/* Stage counters */}
          {status?.stageCounts && (
            <div className="space-y-1.5">
              {([
                { key: 'visionTagged', label: 'images analyzed', icon: <Eye size={13} />, active: status.stage === 'vision' || status.stage === 'parallel' },
                { key: 'entitiesExtracted', label: 'entities extracted', icon: <Tag size={13} />, active: status.stage === 'entities' },
                { key: 'enriched', label: 'bookmarks enriched', icon: <Brain size={13} />, active: status.stage === 'enrichment' || status.stage === 'parallel' },
                { key: 'categorized', label: 'categorized', icon: <Layers size={13} />, active: status.stage === 'categorize' || status.stage === 'parallel' },
              ] as { key: keyof StageCounts; label: string; icon: React.ReactNode; active: boolean }[]).map(({ key, label, icon, active }) => {
                const count = status.stageCounts[key]
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

          {status?.lastError && (
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              ⚠ {status.lastError}
            </p>
          )}

          {/* Progress bar during categorize/parallel stage */}
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
        <div className="flex flex-col items-center gap-5 py-6">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle size={32} className="text-emerald-400" />
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-zinc-100">Categorization Complete!</p>
            {status?.stageCounts && (
              <p className="text-zinc-500 text-sm mt-1">
                {status.stageCounts.visionTagged} images analyzed ·{' '}
                {status.stageCounts.enriched} bookmarks enriched ·{' '}
                {status.stageCounts.categorized} categorized
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/bookmarks"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
            >
              View your bookmarks
              <ChevronRight size={16} />
            </Link>
            <button
              onClick={() => void startCategorization(true)}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors border border-zinc-700"
            >
              <RefreshCw size={14} />
              Reprocess all
            </button>
          </div>
        </div>
      )}

      {/* All bookmarks already existed — nothing new to categorize */}
      {importedCount === 0 && !running && (
        <div className="flex flex-col items-center gap-5 py-6">
          <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center">
            <CheckCircle size={32} className="text-zinc-500" />
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-zinc-100">Already up to date</p>
            <p className="text-zinc-500 text-sm mt-1">All bookmarks in this file were already imported</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/bookmarks"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
            >
              View your bookmarks
              <ChevronRight size={16} />
            </Link>
            <button
              onClick={() => void startCategorization(true)}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors border border-zinc-700"
            >
              <RefreshCw size={14} />
              Reprocess all
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function UncategorizedBanner({ onCategorize, onReprocess }: { onCategorize: () => void; onReprocess: () => void }) {
  const [totalBookmarks, setTotalBookmarks] = useState<number | null>(null)
  const [uncategorized, setUncategorized] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => {
        if (!r.ok) throw new Error('Stats fetch failed')
        return r.json()
      })
      .then((d: { totalBookmarks?: number; uncategorizedCount?: number }) => {
        setTotalBookmarks(d.totalBookmarks ?? 0)
        setUncategorized(d.uncategorizedCount ?? 0)
      })
      .catch(() => {
        // Stats unavailable — banner stays hidden, not a critical failure
      })
  }, [])

  if (!totalBookmarks || totalBookmarks === 0) return null

  return (
    <div className="space-y-3 mb-6">
      {uncategorized != null && uncategorized > 0 && (
        <div className="flex items-center justify-between gap-4 px-4 py-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/25">
          <div className="flex items-center gap-2.5 min-w-0">
            <Sparkles size={15} className="text-indigo-400 shrink-0" />
            <p className="text-sm text-indigo-300">
              <span className="font-semibold">{uncategorized.toLocaleString()}</span> bookmarks not yet processed
            </p>
          </div>
          <button
            onClick={onCategorize}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shrink-0"
          >
            <Sparkles size={12} />
            Process
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 px-4 py-3.5 rounded-xl bg-zinc-800/60 border border-zinc-700/40">
        <div className="flex items-center gap-2.5 min-w-0">
          <RefreshCw size={15} className="text-zinc-400 shrink-0" />
          <p className="text-sm text-zinc-400">
            Re-analyze all <span className="font-semibold text-zinc-300">{totalBookmarks.toLocaleString()}</span> bookmarks from scratch
          </p>
        </div>
        <button
          onClick={onReprocess}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs font-semibold transition-colors shrink-0"
        >
          <RefreshCw size={12} />
          Reprocess all
        </button>
      </div>
    </div>
  )
}

export default function ImportPage() {
  const [step, setStep] = useState<Step>(1)
  const importSource = 'bookmark' as const
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [forceReprocess, setForceReprocess] = useState(false)

  // Auto-resume to step 3 if the pipeline is already running (e.g. user navigated away and back)
  useEffect(() => {
    fetch('/api/categorize')
      .then((r) => r.json())
      .then((d: { status: string }) => {
        if (d.status === 'running' || d.status === 'stopping') setStep(3)
      })
      .catch(() => {})
  }, [])

  function handleLiveSynced(result: ImportResult) {
    setImportResult(result)
    setStep(2)
    setTimeout(() => setStep(3), 1500)
  }

  const handleFile = useCallback(async (file: File, sourceOverride?: 'bookmark' | 'like') => {
    const source = sourceOverride ?? importSource
    setStep(2)
    setImporting(true)
    setImportError('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('source', source)

      const res = await fetch('/api/import', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error ?? 'Import failed')

      const imported = data.imported ?? 0
      const skipped = data.skipped ?? 0
      const parsed = data.parsed ?? (imported + skipped)
      const result: ImportResult = {
        imported,
        skipped,
        total: imported + skipped,
        parsed,
      }
      setImportResult(result)

      if (parsed === 0) {
        // Parser couldn't extract any bookmarks — likely wrong format
        throw new Error('Could not parse any bookmarks from this file. Make sure you\'re uploading a Twitter/X bookmarks JSON export.')
      }

      // Auto-advance to categorization after a brief moment to show the result
      setTimeout(() => setStep(3), 1500)
    } catch (err) {
      console.error('Import error:', err)
      setImportError(err instanceof Error ? err.message : 'Import failed')
      setStep(1)
    } finally {
      setImporting(false)
    }
  }, [importSource])

  useEffect(() => {
    const xOrigins = new Set(['https://x.com', 'https://twitter.com'])
    function onMessage(e: MessageEvent) {
      if (!xOrigins.has(e.origin)) return
      if (e.data?.type === 'SIFTLY_LAST_JOB_FIRST_TIMELINE_QUERY') {
        const win = e.source as Window | null
        if (!win) return
        const reply = (payload: {
          bookmarkTweetId: string | null
          likeTweetId: string | null
        }) => {
          win.postMessage({ type: 'SIFTLY_LAST_JOB_FIRST_TIMELINE_REPLY', ...payload }, e.origin)
        }
        void fetch('/api/import/last-job-first-timeline-tweets')
          .then((r) => r.json())
          .then((d: { bookmarkTweetId?: unknown; likeTweetId?: unknown }) => {
            const bm = typeof d.bookmarkTweetId === 'string' && d.bookmarkTweetId ? d.bookmarkTweetId : null
            const lk = typeof d.likeTweetId === 'string' && d.likeTweetId ? d.likeTweetId : null
            reply({ bookmarkTweetId: bm, likeTweetId: lk })
          })
          .catch(() => {
            reply({ bookmarkTweetId: null, likeTweetId: null })
          })
        return
      }
      if (e.data?.type !== 'SIFTLY_BOOKMARK_CAPTURE' || !Array.isArray(e.data.bookmarks)) return
      const src = e.data.source === 'like' ? 'like' : 'bookmark'
      const json = JSON.stringify({ bookmarks: e.data.bookmarks, source: src }, null, 2)
      const d = new Date()
      const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
      const name = `${src === 'like' ? 'likes' : 'bookmarks'}-${ts}.json`
      const file = new File([json], name, { type: 'application/json' })
      void handleFile(file, src)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handleFile])

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-100">Import Bookmarks</h1>
        <p className="text-zinc-400 mt-1">Export your X/Twitter bookmarks as JSON, then upload below.</p>
      </div>

      {step === 1 && <UncategorizedBanner onCategorize={() => setStep(3)} onReprocess={() => { setForceReprocess(true); setStep(3) }} />}

      {importError && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
          Import failed: {importError}
        </p>
      )}

      <StepIndicator current={step} />

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        {step === 1 && <InstructionsStep onFile={handleFile} importSource={importSource} onLiveSynced={handleLiveSynced} />}
        {step === 2 && (
          <ImportingStep
            result={importing ? null : importResult}
          />
        )}
        {step === 3 && <CategorizeStep importedCount={importResult ? importResult.imported : -1} force={forceReprocess} />}
      </div>
    </div>
  )
}
