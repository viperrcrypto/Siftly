'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Eye,
  EyeOff,
  Download,
  Check,
  AlertCircle,
  Key,
  Database,
  Info,
  Trash2,
  Shield,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Zap,
  Copy,
  Coffee,
  Terminal,
  Loader2,
  X,
  BookOpen,
  Folder,
  FolderOpen,
} from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { uiText } from '@/lib/i18n'

const ANTHROPIC_MODELS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: '高速・低コスト' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', description: '高性能・バランス型' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6', description: '最高性能' },
]

const OPENAI_MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini', description: '高速・低コスト' },
  { value: 'gpt-4o', label: 'GPT-4o', description: '高性能・マルチモーダル' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: '高速・低コスト' },
  { value: 'gpt-4.1', label: 'GPT-4.1', description: '最高性能' },
  { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', description: '最速' },
  { value: 'o4-mini', label: 'o4-mini', description: '推論（mini）' },
  { value: 'o3', label: 'o3', description: '推論' },
]

const CODEX_MODELS = [
  { value: '', label: 'CLIの既定モデル', description: 'Codexの設定に従う' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini', description: '高速・低コスト' },
  { value: 'gpt-4o', label: 'GPT-4o', description: '高性能・マルチモーダル' },
  { value: 'o4-mini', label: 'o4-mini', description: '推論（mini）' },
  { value: 'o3', label: 'o3', description: '推論' },
]

const MINIMAX_MODELS = [
  { value: 'MiniMax-M2.7', label: 'M2.7', description: '100万コンテキスト・最新版' },
  { value: 'MiniMax-M2.5', label: 'M2.5', description: '20.4万コンテキスト' },
  { value: 'MiniMax-M2.5-highspeed', label: 'M2.5 Highspeed', description: '20.4万・最速' },
]


interface Toast {
  type: 'success' | 'error'
  message: string
}

function ToastAlert({ toast }: { toast: Toast }) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium border ${
        toast.type === 'success'
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          : 'bg-red-500/10 text-red-400 border-red-500/20'
      }`}
    >
      {toast.type === 'success' ? <Check size={15} className="shrink-0" /> : <AlertCircle size={15} className="shrink-0" />}
      {toast.message}
    </div>
  )
}

interface SectionProps {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  description: string
  children: React.ReactNode
  variant?: 'default' | 'danger'
}

function Section({ icon: Icon, title, description, children, variant = 'default' }: SectionProps) {
  const isDanger = variant === 'danger'
  return (
    <div
      className={`bg-zinc-900 rounded-2xl p-6 transition-all duration-200 ${
        isDanger
          ? 'border border-red-700/60 hover:border-red-600/70'
          : 'border border-zinc-800 hover:border-zinc-700'
      }`}
    >
      <div className="flex items-start gap-3 mb-5">
        <div
          className={`p-2.5 rounded-xl shrink-0 ${
            isDanger ? 'bg-red-800/40' : 'bg-indigo-500/10'
          }`}
        >
          <Icon size={16} className={isDanger ? 'text-red-500' : 'text-indigo-400'} />
        </div>
        <div>
          <h2 className={`text-base font-semibold ${isDanger ? 'text-red-400' : 'text-zinc-100'}`}>
            {title}
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5 leading-relaxed">{description}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function ApiKeyField({
  label,
  placeholder,
  fieldKey,
  hint,
  docHref,
  onToast,
  testProvider,
}: {
  label: string
  placeholder: string
  fieldKey: 'anthropicApiKey' | 'openaiApiKey' | 'minimaxApiKey'
  hint: string
  docHref: string
  onToast: (t: Toast) => void
  testProvider?: string
}) {
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [savedMasked, setSavedMasked] = useState<string | null>(null)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testError, setTestError] = useState('')

  // Load existing saved key status on mount
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: Record<string, unknown>) => {
        const hasKeyField = fieldKey === 'openaiApiKey' ? 'hasOpenaiKey' : fieldKey === 'minimaxApiKey' ? 'hasMinimaxKey' : 'hasAnthropicKey'
        const hasKey = d[hasKeyField]
        const masked = d[fieldKey] as string | null
        if (hasKey && masked) setSavedMasked(masked)
      })
      .catch(() => {})
  }, [fieldKey])

  async function handleSave() {
    if (!key.trim()) {
      onToast({ type: 'error', message: 'APIキーを入力してください' })
      return
    }
    setSaving(true)
    setTestState('idle')
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [fieldKey]: key.trim() }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? '保存に失敗しました')
      }
      setSavedMasked(key.trim().slice(0, 6) + '••••••••' + key.trim().slice(-4))
      setKey('')
      // Auto-test after save
      if (testProvider) void handleTest()
      else onToast({ type: 'success', message: `${label}を保存しました` })
    } catch (err) {
      onToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'APIキーの保存に失敗しました',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setRemoving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: fieldKey }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? '削除に失敗しました')
      }
      setSavedMasked(null)
      setTestState('idle')
      onToast({ type: 'success', message: `${label}を削除しました` })
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'キーの削除に失敗しました' })
    } finally {
      setRemoving(false)
    }
  }

  async function handleTest() {
    if (!testProvider) return
    setTestState('testing')
    setTestError('')
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: testProvider }),
      })
      const data = await res.json() as { working: boolean; error?: string }
      if (data.working) {
        setTestState('ok')
        onToast({ type: 'success', message: `${label}は利用できます` })
      } else {
        setTestState('fail')
        setTestError(data.error ?? 'キーのテストに失敗しました')
      }
    } catch {
      setTestState('fail')
      setTestError('接続エラー')
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <p className="text-sm font-medium text-zinc-300 shrink-0">{label}</p>
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          {savedMasked && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-lg min-w-0 overflow-hidden">
              <Check size={11} className="shrink-0" /> <span className="shrink-0">保存済み:</span> <span className="font-mono truncate">{savedMasked}</span>
            </span>
          )}
          {savedMasked && (
            <button
              onClick={() => void handleRemove()}
              disabled={removing}
              className="shrink-0 text-xs text-red-500/70 hover:text-red-400 transition-colors disabled:opacity-50"
              title="保存済みキーを削除"
            >
              {removing ? '削除中…' : '削除'}
            </button>
          )}
          {testProvider && savedMasked && testState === 'idle' && (
            <button
              onClick={() => void handleTest()}
              className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              テスト
            </button>
          )}
          {testState === 'testing' && (
            <span className="flex items-center gap-1 text-xs text-zinc-400 shrink-0">
              <Loader2 size={11} className="animate-spin" /> テスト中…
            </span>
          )}
          {testState === 'ok' && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 shrink-0">
              <Check size={11} /> 利用可能
            </span>
          )}
          {testState === 'fail' && (
            <span className="flex items-center gap-1 text-xs text-red-400 shrink-0" title={testError}>
              <X size={11} /> {testError.slice(0, 30) || '失敗'}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-2.5">
        <div className="relative flex-1">
          <input
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
            placeholder={savedMasked ? '新しいキーで置き換え…' : placeholder}
            className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all duration-200 pr-10 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label={showKey ? 'キーを隠す' : 'キーを表示'}
          >
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shrink-0"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-600">{hint}</p>
        <a
          href={docHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-400 transition-colors"
        >
          APIキーを取得 <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}

function ModelSelector({
  models,
  settingKey,
  defaultValue,
  label = 'モデル',
  onToast,
}: {
  models: { value: string; label: string; description: string }[]
  settingKey: 'anthropicModel' | 'openaiModel' | 'minimaxModel' | 'claudeCliModel' | 'codexCliModel'
  defaultValue: string
  label?: string
  onToast: (t: Toast) => void
}) {
  const [value, setValue] = useState(defaultValue)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => { if (d[settingKey]) setValue(d[settingKey] as string) })
      .catch(() => {})
  }, [settingKey])

  async function handleChange(newVal: string) {
    setValue(newVal)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [settingKey]: newVal }),
      })
      if (!res.ok) throw new Error('Failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      onToast({ type: 'error', message: 'Failed to save model preference' })
    }
  }

  const selected = models.find((m) => m.value === value) ?? models[0]

  return (
    <>
      <div className="flex items-center gap-2 mt-2.5">
        <span className="text-xs text-zinc-500 shrink-0">{label}:</span>
        <div className="relative flex-1">
          <select
            value={value}
            onChange={(e) => void handleChange(e.target.value)}
            className="w-full appearance-none pl-3 pr-8 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
          >
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label} — {m.description}
              </option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        </div>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-400 shrink-0">
            <Check size={12} /> 保存済み
          </span>
        )}
        {!saved && selected && (
          <span className="text-xs text-zinc-600 shrink-0 hidden sm:block">{selected.description}</span>
        )}
      </div>
      {value === 'claude-opus-4-6' && (
        <p className="text-xs text-amber-500/80 mt-1.5">
          Opusは20並列ワーカーでは時間がかかります。大量分類を速くするならSonnetまたはHaikuがおすすめです。
        </p>
      )}
    </>
  )
}

function AuthModeSelector({
  settingKey,
  defaultValue,
  cliLabel,
  onToast,
}: {
  settingKey: 'anthropicAuthMode' | 'openaiAuthMode'
  defaultValue: 'api' | 'cli'
  cliLabel: string
  onToast: (t: Toast) => void
}) {
  const [value, setValue] = useState<'api' | 'cli'>(defaultValue)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: Record<string, unknown>) => {
        if (d[settingKey] === 'api' || d[settingKey] === 'cli') setValue(d[settingKey])
      })
      .catch(() => {})
  }, [settingKey])

  async function handleChange(next: 'api' | 'cli') {
    const previous = value
    setValue(next)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [settingKey]: next }),
      })
      if (!res.ok) throw new Error('Failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setValue(previous)
      onToast({ type: 'error', message: '認証方式の保存に失敗しました' })
    }
  }

  return (
    <div className="flex items-center gap-2 mt-2.5">
      <span className="text-xs text-zinc-500 shrink-0">認証方式:</span>
      <div className="flex gap-1 p-1 rounded-lg bg-zinc-800 border border-zinc-700">
        <button
          type="button"
          onClick={() => void handleChange('api')}
          className={`px-2.5 py-1 rounded-md text-xs transition-colors ${value === 'api' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
        >
          APIキー
        </button>
        <button
          type="button"
          onClick={() => void handleChange('cli')}
          className={`px-2.5 py-1 rounded-md text-xs transition-colors ${value === 'cli' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
        >
          {cliLabel}
        </button>
      </div>
      {saved && <span className="flex items-center gap-1 text-xs text-emerald-400"><Check size={12} /> 保存済み</span>}
    </div>
  )
}

interface CliStatus {
  available: boolean
  subscriptionType?: string
  expired?: boolean
}

function ClaudeCliStatusBox() {
  const [status, setStatus] = useState<CliStatus | null>(null)

  useEffect(() => {
    fetch('/api/settings/cli-status')
      .then((r) => r.json())
      .then((d: CliStatus) => setStatus(d))
      .catch(() => setStatus({ available: false }))
  }, [])

  if (status === null) return null // loading — don't flash UI

  if (status.available && !status.expired) {
    const tier = status.subscriptionType
      ? status.subscriptionType.charAt(0).toUpperCase() + status.subscriptionType.slice(1)
      : 'CLI'
    return (
      <div className="flex gap-3 p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 mb-5">
        <Check size={15} className="text-emerald-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-emerald-300">
            Claude CLIを検出しました（APIキー不要）
          </p>
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
            Claude Codeの<span className="text-zinc-300">{tier}</span>としてサインイン中です。Siftlyはサブスクリプションを自動利用します。下のAPIキーを設定すると、そちらが優先されます。
          </p>
        </div>
      </div>
    )
  }

  if (status.available && status.expired) {
    return (
      <div className="flex gap-3 p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 mb-5">
        <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-300">Claude CLIのセッションが期限切れです</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            ターミナルで<span className="font-mono text-zinc-300">claude</span>を実行してセッションを更新し、このページを再読み込みしてください。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 p-3.5 rounded-xl bg-zinc-800/60 border border-zinc-700 mb-5">
      <Terminal size={15} className="text-zinc-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200">Claude CLIを検出できません</p>
        <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
          Claude CodeをインストールしてサインインすればAPIキーは不要です。利用しない場合は下にAPIキーを入力してください。
        </p>
      </div>
    </div>
  )
}

function CodexCliStatusBox() {
  const [status, setStatus] = useState<{ available: boolean; expired?: boolean; planType?: string; authMode?: string; hasCredentials?: boolean } | null>(null)

  useEffect(() => {
    fetch('/api/settings/cli-status')
      .then((r) => r.json())
      .then((d: { codex?: { available: boolean; expired?: boolean; planType?: string; authMode?: string; hasCredentials?: boolean } }) => setStatus(d.codex ?? { available: false }))
      .catch(() => setStatus({ available: false }))
  }, [])

  if (status === null) return null

  if (status.available && !status.expired) {
    const tier = status.planType
      ? status.planType.charAt(0).toUpperCase() + status.planType.slice(1)
      : 'CLI'
    const isChatGPT = status.authMode === 'chatgpt'
    return (
      <div className="flex gap-3 p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 mb-5">
        <Check size={15} className="text-emerald-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-emerald-300">
            Codex CLIを検出しました{isChatGPT ? '（ChatGPTログイン）' : '（APIキー不要）'}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
            {isChatGPT ? (
              <>ChatGPTの<span className="text-zinc-300">{tier}</span>としてサインイン中です。AI機能はCodex CLI経由で実行されます。下のAPIキーを設定すると、そちらが優先されます。</>
            ) : (
              <>Codex CLIの<span className="text-zinc-300">{tier}</span>としてサインイン中です。Siftlyは認証情報を自動利用します。下のAPIキーを設定すると、そちらが優先されます。</>
            )}
          </p>
        </div>
      </div>
    )
  }

  if (status.hasCredentials && status.expired) {
    return (
      <div className="flex gap-3 p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 mb-5">
        <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-300">Codex CLIのセッションが期限切れです</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            ターミナルで<span className="font-mono text-zinc-300">codex</span>を実行して更新し、このページを再読み込みしてください。
          </p>
        </div>
      </div>
    )
  }

  if (status.hasCredentials && !status.available) {
    return (
      <div className="flex gap-3 p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 mb-5">
        <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-300">Codexの認証情報はありますがCLIを利用できません</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            保存済みの認証情報はありますが、<span className="font-mono text-zinc-300">codex</span>が応答していません。Codex CLIをインストールまたは再インストールするか、下にOpenAI APIキーを入力してください。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 p-3.5 rounded-xl bg-zinc-800/60 border border-zinc-700 mb-5">
      <Terminal size={15} className="text-zinc-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200">Codex CLIを検出できません</p>
        <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
          Codex CLIをインストールしてサインインすればAPIキーは不要です。利用しない場合は下にOpenAI APIキーを入力してください。
        </p>
      </div>
    </div>
  )
}

function ProviderToggle({ value, onChange }: { value: 'anthropic' | 'openai' | 'minimax'; onChange: (v: 'anthropic' | 'openai' | 'minimax') => void }) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-800 border border-zinc-700 mb-5">
      <button
        onClick={() => onChange('anthropic')}
        className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          value === 'anthropic'
            ? 'bg-indigo-600 text-white shadow-sm'
            : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        Anthropic
      </button>
      <button
        onClick={() => onChange('openai')}
        className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          value === 'openai'
            ? 'bg-emerald-600 text-white shadow-sm'
            : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        OpenAI
      </button>
      <button
        onClick={() => onChange('minimax')}
        className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          value === 'minimax'
            ? 'bg-orange-600 text-white shadow-sm'
            : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        MiniMax
      </button>
    </div>
  )
}

function ApiKeySection({ onToast }: { onToast: (t: Toast) => void }) {
  const [provider, setProvider] = useState<'anthropic' | 'openai' | 'minimax' | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: { provider?: string }) => {
        setProvider(d.provider === 'openai' ? 'openai' : d.provider === 'minimax' ? 'minimax' : 'anthropic')
      })
      .catch(() => setProvider('anthropic'))
  }, [])

  async function handleProviderChange(newProvider: 'anthropic' | 'openai' | 'minimax') {
    const prev = provider
    setProvider(newProvider)
    const labels: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', minimax: 'MiniMax' }
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: newProvider }),
      })
      if (!res.ok) throw new Error('プロバイダーの保存に失敗しました')
      onToast({ type: 'success', message: `${labels[newProvider]}に切り替えました` })
    } catch {
      setProvider(prev) // revert on failure
      onToast({ type: 'error', message: 'プロバイダー設定の保存に失敗しました' })
    }
  }

  // Don't render until we know the saved provider — avoids flicker
  if (provider === null) {
    return (
      <Section
        icon={Key}
        title="AIプロバイダー"
        description="AIプロバイダーを選び、キーを設定します。CLI認証を使う場合はキー不要です。"
      >
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={14} className="animate-spin" /> 設定を読み込み中…
        </div>
      </Section>
    )
  }

  return (
    <Section
      icon={Key}
      title="AIプロバイダー"
      description="AIプロバイダーを選び、キーを設定します。CLI認証を使う場合はキー不要です。"
    >
      <ProviderToggle value={provider} onChange={(v) => void handleProviderChange(v)} />

      {provider === 'anthropic' ? (
        <>
          <ClaudeCliStatusBox />
          <div className="space-y-5">
            <div>
              <ApiKeyField
                label="Anthropic (Claude)"
                placeholder="sk-ant-api03-..."
                fieldKey="anthropicApiKey"
                hint="AI分類、検索、画像分析に使用します。"
                docHref="https://console.anthropic.com"
                onToast={onToast}
                testProvider="anthropic"
              />
              <ModelSelector
                models={ANTHROPIC_MODELS}
                settingKey="anthropicModel"
                defaultValue="claude-haiku-4-5-20251001"
                label="APIモデル"
                onToast={onToast}
              />
              <AuthModeSelector
                settingKey="anthropicAuthMode"
                defaultValue="cli"
                cliLabel="Claude CLI"
                onToast={onToast}
              />
              <ModelSelector
                models={ANTHROPIC_MODELS}
                settingKey="claudeCliModel"
                defaultValue="claude-haiku-4-5-20251001"
                label="CLIモデル"
                onToast={onToast}
              />
              <p className="text-xs text-zinc-500 mt-1.5">選択した認証方式のモデルをAI処理に使用します。利用できない場合はAPIキーへフォールバックします。</p>
            </div>
          </div>
        </>
      ) : provider === 'openai' ? (
        <>
          <CodexCliStatusBox />
          <div className="space-y-5">
            <div>
              <ApiKeyField
                label="OpenAI"
                placeholder="sk-..."
                fieldKey="openaiApiKey"
                hint="AI分類、検索、画像分析に使用します。"
                docHref="https://platform.openai.com/api-keys"
                onToast={onToast}
                testProvider="openai"
              />
              <ModelSelector
                models={OPENAI_MODELS}
                settingKey="openaiModel"
                defaultValue="gpt-4.1-mini"
                label="APIモデル"
                onToast={onToast}
              />
              <AuthModeSelector
                settingKey="openaiAuthMode"
                defaultValue="cli"
                cliLabel="Codex CLI"
                onToast={onToast}
              />
              <ModelSelector
                models={CODEX_MODELS}
                settingKey="codexCliModel"
                defaultValue=""
                label="CLIモデル"
                onToast={onToast}
              />
              <p className="text-xs text-zinc-500 mt-1.5">選択した認証方式のモデルをAI処理に使用します。Codex CLIの既定モデルを使う場合は「CLIの既定モデル」を選択してください。</p>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-5">
          <div>
            <ApiKeyField
              label="MiniMax"
              placeholder="eyJ..."
              fieldKey="minimaxApiKey"
              hint="AI分類、検索、画像分析に使用します。"
              docHref="https://platform.minimaxi.com/user-center/basic-information/interface-key"
              onToast={onToast}
              testProvider="minimax"
            />
            <ModelSelector
              models={MINIMAX_MODELS}
              settingKey="minimaxModel"
              defaultValue="MiniMax-M2.7"
              onToast={onToast}
            />
            <p className="text-xs text-zinc-500 mt-1.5">MiniMax M2.7は100万トークンのコンテキストに対応し、大量分類に適しています。</p>
          </div>
        </div>
      )}
      <p className="text-xs text-zinc-600 mt-4">キーはローカルSQLiteデータベース（<code className="font-mono">prisma/dev.db</code>）に平文で保存されます。データベースファイルを公開しないでください。</p>
    </Section>
  )
}

function ExportButton({
  label,
  href,
  description,
}: {
  label: string
  href: string
  description: string
}) {
  return (
    <button
      onClick={() => {
        window.location.href = href
      }}
      className="flex flex-col items-start gap-1 p-4 rounded-xl bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-zinc-600 transition-all duration-200 text-left group w-full"
    >
      <div className="flex items-center gap-2">
        <Download size={14} className="text-zinc-400 group-hover:text-zinc-200 transition-colors" />
        <span className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100 transition-colors">
          {label}
        </span>
      </div>
      <p className="text-xs text-zinc-600">{description}</p>
    </button>
  )
}

interface ObsidianResult {
  written: number
  skipped: number
  errors: Array<{ tweetId: string; error: string }>
  indexesWritten: number
}

interface BrowseDir {
  name: string
  path: string
}

function FolderBrowser({ onSelect, onClose }: { onSelect: (path: string) => void; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [dirs, setDirs] = useState<BrowseDir[]>([])
  const [loading, setLoading] = useState(true)

  const browse = useCallback(async (dirPath?: string) => {
    setLoading(true)
    try {
      const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''
      const res = await fetch(`/api/settings/browse${params}`)
      const data = await res.json()
      if (!res.ok) return
      setCurrent(data.current)
      setParent(data.parent)
      setDirs(data.directories)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { queueMicrotask(() => { void browse() }) }, [browse])

  return (
    <div className="border border-zinc-700 rounded-xl bg-zinc-800/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 bg-zinc-800">
        <p className="text-xs font-mono text-zinc-400 truncate flex-1 mr-2">{current}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onSelect(current)}
            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors"
          >
            このフォルダーを選択
          </button>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="max-h-52 overflow-y-auto">
        {parent && (
          <button
            onClick={() => browse(parent)}
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-700/50 transition-colors border-b border-zinc-800"
          >
            <ChevronUp size={14} className="text-zinc-500" />
            <span>..</span>
          </button>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="text-zinc-500 animate-spin" />
          </div>
        ) : dirs.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center py-4">サブフォルダーはありません</p>
        ) : (
          dirs.map((dir) => (
            <button
              key={dir.path}
              onClick={() => browse(dir.path)}
              className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700/50 transition-colors group"
            >
              <Folder size={14} className="text-zinc-500 group-hover:text-indigo-400 transition-colors shrink-0" />
              <span className="truncate">{dir.name}</span>
              <ChevronRight size={12} className="text-zinc-600 ml-auto shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function ObsidianExportBlock({ onToast }: { onToast: (t: Toast) => void }) {
  const [vaultPath, setVaultPath] = useState('')
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [savingPath, setSavingPath] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<ObsidianResult | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: Record<string, unknown>) => {
        if (d.obsidianVaultPath) setSavedPath(d.obsidianVaultPath as string)
      })
      .catch(() => {})
  }, [])

  async function handleSavePath(pathToSave?: string) {
    const finalPath = pathToSave ?? vaultPath
    if (!finalPath.trim()) {
      onToast({ type: 'error', message: 'Vaultのパスを入力してください' })
      return
    }
    setSavingPath(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obsidianVaultPath: finalPath.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '保存に失敗しました')
      setSavedPath(finalPath.trim())
      setVaultPath(finalPath.trim())
      onToast({ type: 'success', message: 'Vaultのパスを保存しました' })
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'パスの保存に失敗しました' })
    } finally {
      setSavingPath(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    setResult(null)
    try {
      const res = await fetch('/api/export/obsidian', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwrite }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'エクスポートに失敗しました')
      setResult(data)
      onToast({ type: 'success', message: `Obsidianに${data.written}件のノートを書き出しました` })
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'エクスポートに失敗しました' })
    } finally {
      setExporting(false)
    }
  }

  function handleBrowseSelect(selectedPath: string) {
    setVaultPath(selectedPath)
    setBrowserOpen(false)
    handleSavePath(selectedPath)
  }

  return (
    <Section
      icon={BookOpen}
      title="Obsidianへの書き出し"
      description="ブックマークをYAMLフロントマター、wikilink、インデックス付きのMarkdownノートとして書き出します。"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">Vaultのパス</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <FolderOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={vaultPath}
                onChange={(e) => setVaultPath(e.target.value)}
                placeholder={savedPath ?? '/Users/you/ObsidianVault'}
                className="w-full pl-9 pr-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 font-mono"
              />
            </div>
            <button
              onClick={() => setBrowserOpen(!browserOpen)}
              title="フォルダーを参照"
              className="px-3 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
            >
              <Folder size={16} />
            </button>
            <button
              onClick={() => handleSavePath()}
              disabled={savingPath || !vaultPath.trim()}
              className="px-4 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm font-medium text-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savingPath ? '保存中…' : '保存'}
            </button>
          </div>
          {savedPath && (
            <p className="text-xs text-zinc-500 mt-1.5">
              現在の設定: <code className="font-mono text-zinc-400">{savedPath}</code>
            </p>
          )}
        </div>

        {browserOpen && (
          <FolderBrowser
            onSelect={handleBrowseSelect}
            onClose={() => setBrowserOpen(false)}
          />
        )}

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500/50"
            />
            既存ノートを上書き
          </label>
        </div>

        <button
          onClick={handleExport}
          disabled={exporting || !savedPath}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {exporting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              書き出し中…
            </>
          ) : (
            <>
              <Download size={14} />
              Obsidianへ書き出す
            </>
          )}
        </button>

        {result && (
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-3 text-sm">
            <p className="text-green-400">{result.written}件のノートを書き込みました</p>
            {result.skipped > 0 && <p className="text-zinc-400">{result.skipped}件をスキップ（既存）</p>}
            {result.indexesWritten > 0 && <p className="text-zinc-400">{result.indexesWritten}件のインデックスを作成しました</p>}
            {result.errors.length > 0 && <p className="text-red-400">{result.errors.length}件のエラー</p>}
          </div>
        )}
      </div>
    </Section>
  )
}

function ArchiveSettingsBlock({ onToast }: { onToast: (t: Toast) => void }) {
  const [settings, setSettings] = useState({ archiveEnabled: false, autoAfterImport: false, archiveTemplateDir: '', galleryDlPath: '', cookieBrowser: '', downloadXVideo: false, downloadPdf: false, sourceResolverEnabled: true, archiveRoot: 'Clippings/Siftly' })
  useEffect(() => { fetch('/api/settings').then((r) => r.json()).then((data) => setSettings({ archiveEnabled: data.archiveEnabled === true, autoAfterImport: data.autoAfterImport === true, archiveTemplateDir: data.archiveTemplateDir ?? '', galleryDlPath: data.galleryDlPath ?? '', cookieBrowser: data.cookieBrowser ?? '', downloadXVideo: data.downloadXVideo === true, downloadPdf: data.downloadPdf === true, sourceResolverEnabled: data.sourceResolverEnabled !== false, archiveRoot: data.archiveRoot ?? 'Clippings/Siftly' })).catch(() => {}) }, [])
  async function save() {
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
    const body = await res.json().catch(() => ({}))
    onToast({ type: res.ok ? 'success' : 'error', message: res.ok ? 'アーカイブ設定を保存しました' : body.error ?? '保存できませんでした' })
  }
  return <Section icon={BookOpen} title="自動アーカイブ" description="新しいXブックマークをObsidian Web Clipperテンプレートで保存します。">
    <div className="space-y-3 text-sm text-zinc-300">
      {[['archiveEnabled', 'アーカイブを有効化'], ['autoAfterImport', 'インポート後に自動実行'], ['sourceResolverEnabled', '外部Sourceを解決・clip'], ['downloadXVideo', 'Xネイティブ動画を保存'], ['downloadPdf', 'PDFを保存（既定では無効）']].map(([key, label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={settings[key as keyof typeof settings] as boolean} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })} />{label}</label>)}
      {[['archiveTemplateDir', 'Web Clipper テンプレート'], ['galleryDlPath', 'gallery-dl のパス'], ['cookieBrowser', 'Cookieブラウザー名（任意）'], ['archiveRoot', 'アーカイブ保存先']].map(([key, label]) => <label key={key} className="block"><span className="mb-1 block text-xs text-zinc-500">{label}</span><input value={settings[key as keyof typeof settings] as string} onChange={(event) => setSettings({ ...settings, [key]: event.target.value })} className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs" /></label>)}
      <button onClick={() => void save()} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500">保存</button>
    </div>
  </Section>
}

function DataSection() {
  return (
    <Section
      icon={Database}
      title="データ管理"
      description="ブックマークとカテゴリのデータをバックアップまたは移行用に書き出します。"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ExportButton
          label="CSVで書き出す"
          href="/api/export?type=csv"
          description="表計算ソフトで扱える形式"
        />
        <ExportButton
          label="JSONで書き出す"
          href="/api/export?type=json"
          description="すべての項目を含む完全なデータ"
        />
      </div>
    </Section>
  )
}

function DangerZoneSection({ onToast }: { onToast: (t: Toast) => void }) {
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)

  async function handleClearAll() {
    setClearing(true)
    try {
      const res = await fetch('/api/bookmarks', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? '削除に失敗しました')
      }
      onToast({ type: 'success', message: 'すべてのブックマークを削除しました' })
      setConfirming(false)
      setCleared(true)
      setTimeout(() => setCleared(false), 3000)
      window.dispatchEvent(new CustomEvent('siftly:cleared'))
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'ブックマークの削除に失敗しました' })
    } finally {
      setClearing(false)
    }
  }

  return (
    <Section
      icon={Shield}
      title="危険な操作"
      description="すべてのデータに影響する、取り消せない操作です。"
      variant="danger"
    >
      <div className="flex items-center justify-between p-4 rounded-xl bg-red-900/20 border border-red-800/40">
        <div>
          <p className="text-sm font-medium text-zinc-300">すべてのブックマークを削除</p>
          <p className="text-xs text-zinc-500 mt-0.5">インポートしたブックマークを完全に削除します</p>
        </div>
        {cleared ? (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
            <Check size={14} />
            削除しました
          </div>
        ) : !confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-red-400 bg-red-800/30 hover:bg-red-700/40 border border-red-700/50 hover:border-red-600/60 transition-all"
          >
            <Trash2 size={14} />
            すべて削除
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 mr-1">本当に削除しますか？</span>
            <button
              onClick={() => setConfirming(false)}
              disabled={clearing}
              className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={() => void handleClearAll()}
              disabled={clearing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 size={12} />
              {clearing ? '削除中…' : 'はい、すべて削除'}
            </button>
          </div>
        )}
      </div>
    </Section>
  )
}

const TECH_STACK = [
  { label: 'Next.js 15', color: 'bg-zinc-800 text-zinc-300 border-zinc-700' },
  { label: 'Prisma + SQLite', color: 'bg-zinc-800 text-zinc-300 border-zinc-700' },
  { label: 'Anthropic / OpenAI / MiniMax', color: 'bg-blue-500/10 text-blue-300 border-blue-500/20' },
  { label: 'React Flow', color: 'bg-zinc-800 text-zinc-300 border-zinc-700' },
  { label: 'Tailwind CSS', color: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20' },
]

const DONATION_ADDRESS = '0xcF10B967a9e422753812004Cd59990f62E360760'

function AboutSection() {
  const [copied, setCopied] = useState(false)

  function copyAddress() {
    void navigator.clipboard.writeText(DONATION_ADDRESS).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Section icon={Info} title="Siftlyについて" description="自分の環境で動かすXブックマーク管理ツール">
      <p className="text-sm text-zinc-400 leading-relaxed mb-5">
        <strong className="text-zinc-100 font-semibold">Siftly</strong>は、X/Twitterのブックマークを整理するためのローカルアプリです。
        付属のブックマークレットまたはコンソールスクリプトでインポートし、4段階のAIパイプラインで画像分析、エンティティ抽出、意味タグ生成、自動分類を行えます。
        インタラクティブなマインドマップで関連を探索することもできます。
      </p>

      {/* Builder + support row */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Built by */}
        <a
          href="https://x.com/viperr"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800 transition-all group flex-1"
        >
          <span className="text-base leading-none">𝕏</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors">@viperr</p>
            <p className="text-[11px] text-zinc-600">開発・オープンソース化</p>
          </div>
          <ExternalLink size={12} className="text-zinc-600 group-hover:text-zinc-400 transition-colors ml-auto shrink-0" />
        </a>

        {/* Donate */}
        <div className="flex-1 px-4 py-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Coffee size={13} className="text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-amber-300">開発を支援する</span>
          </div>
          <p className="text-[11px] text-zinc-500 mb-2.5 leading-relaxed">
            Siftlyが役に立ったら、開発者へのチップをご検討ください。
          </p>
          <button
            onClick={copyAddress}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-zinc-900/60 border border-amber-500/20 hover:border-amber-500/50 hover:bg-zinc-900 transition-all group"
          >
            <span className="text-[10px] font-mono text-zinc-400 group-hover:text-zinc-200 transition-colors truncate">
              {DONATION_ADDRESS}
            </span>
            {copied
              ? <Check size={13} className="text-emerald-400 shrink-0" />
              : <Copy size={13} className="text-zinc-600 group-hover:text-amber-400 transition-colors shrink-0" />
            }
          </button>
          {copied && (
            <p className="text-[10px] text-emerald-400 mt-1.5 text-center">アドレスをコピーしました</p>
          )}
        </div>
      </div>
    </Section>
  )
}

function XOAuthSection({ onToast }: { onToast: (t: Toast) => void }) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedSecret, setSavedSecret] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: Record<string, unknown>) => {
        if (d.hasXOAuth && d.xOAuthClientId) setSavedId(d.xOAuthClientId as string)
        if (d.xOAuthClientSecret) setSavedSecret(d.xOAuthClientSecret as string)
      })
      .catch(() => {})
  }, [])

  async function handleSave() {
    if (!clientId.trim()) {
      onToast({ type: 'error', message: 'Client IDを入力してください' })
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, string> = { xOAuthClientId: clientId.trim() }
      if (clientSecret.trim()) payload.xOAuthClientSecret = clientSecret.trim()
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? '保存に失敗しました')
      }
      setSavedId(clientId.trim().slice(0, 6) + '••••' + clientId.trim().slice(-4))
      if (clientSecret.trim()) setSavedSecret(clientSecret.trim().slice(0, 4) + '••••')
      setClientId('')
      setClientSecret('')
      onToast({ type: 'success', message: 'X OAuthの認証情報を保存しました' })
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    try {
      await fetch('/api/settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'x_oauth_client_id' }),
      })
      await fetch('/api/settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'x_oauth_client_secret' }),
      })
      setSavedId(null)
      setSavedSecret(null)
      onToast({ type: 'success', message: 'X OAuthの認証情報を削除しました' })
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : '削除に失敗しました' })
    }
  }

  const callbackUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/import/x-oauth/callback`
    : '/api/import/x-oauth/callback'

  return (
    <Section
      icon={Shield}
      title="X（Twitter）OAuth 2.0"
      description="公式APIを使ってXアカウントからブックマークをインポートします。"
    >
      <div className="space-y-4">
        {savedId ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
              <div className="flex items-center gap-2.5">
                <Check size={15} className="text-emerald-400 shrink-0" />
                <div className="text-sm">
                  <span className="text-emerald-300">Client ID: </span>
                  <span className="text-zinc-400 font-mono text-xs">{savedId}</span>
                  {savedSecret && (
                    <>
                      <span className="text-zinc-600 mx-2">·</span>
                      <span className="text-emerald-300">Secret: </span>
                      <span className="text-zinc-400 font-mono text-xs">{savedSecret}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={handleRemove}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="X OAuthの認証情報を削除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Client ID"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 font-mono"
              />
              <input
                type="password"
                placeholder="Client Secret（公開クライアントでは任意）"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 font-mono"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !clientId.trim()}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
              {saving ? '保存中…' : 'X OAuth認証情報を保存'}
            </button>
          </div>
        )}

        <div className="text-xs text-zinc-600 space-y-1">
          <p>
            認証情報は{' '}
            <a href="https://developer.x.com/en/portal/dashboard" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
              X Developer Portal
            </a>
          </p>
          <p>
            コールバックURL: <code className="bg-zinc-800 px-1.5 py-0.5 rounded font-mono text-zinc-400">{callbackUrl}</code>
          </p>
        </div>
      </div>
    </Section>
  )
}

export default function SettingsPage() {
  const { language } = useLanguage()
  const [toast, setToast] = useState<Toast | null>(null)

  function showToast(t: Toast) {
    setToast(t)
    setTimeout(() => setToast(null), 4000)
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">

      {/* Page Header */}
      <div className="mb-8">
        <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium mb-1">{uiText(language, '設定', 'Configuration')}</p>
        <h1 className="text-2xl font-bold text-zinc-100">{uiText(language, '設定', 'Settings')}</h1>
        <p className="text-zinc-400 mt-1 text-sm">{uiText(language, 'Siftlyの環境を設定します', 'Configure your Siftly instance')}</p>
      </div>

      {/* Toast */}
      {toast && (
        <div className="mb-6">
          <ToastAlert toast={toast} />
        </div>
      )}

      <div className="space-y-4">
        <ApiKeySection onToast={showToast} />
        <XOAuthSection onToast={showToast} />
        <DataSection />
        <ObsidianExportBlock onToast={showToast} />
        <ArchiveSettingsBlock onToast={showToast} />
        <DangerZoneSection onToast={showToast} />
        <AboutSection />
      </div>
    </div>
  )
}
