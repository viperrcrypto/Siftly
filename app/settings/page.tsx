'use client'

import { useState, useEffect } from 'react'
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
  Zap,
  Copy,
  Coffee,
  Terminal,
  Loader2,
  X,
} from 'lucide-react'

const ANTHROPIC_MODELS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fast & Cheap' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', description: 'Smart & Balanced' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6', description: 'Most Capable' },
]

const OPENAI_MODELS = [
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Fast & Cheap' },
  { value: 'gpt-4.1', label: 'GPT-4.1', description: 'Most Capable' },
  { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', description: 'Fastest' },
  { value: 'o4-mini', label: 'o4-mini', description: 'Reasoning (mini)' },
  { value: 'o3', label: 'o3', description: 'Reasoning' },
]

const xAI_MODELS = [
  { value: 'grok-4-fast-reasoning', label: 'grok-4-fast-reasoning', description: 'Fast & Cheap' },
  { value: 'grok-4.20-0309-reasoning', label: 'grok-4.20-0309-reasoning', description: 'Smart & Balanced' },
  { value: 'grok-code-fast-1', label: 'grok-code-fast-1', description: 'Most Capable' },
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
  fieldKey: 'anthropicApiKey' | 'openaiApiKey' | 'xAIApiKey'
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
        const hasKeyField = fieldKey === 'openaiApiKey' ? 'hasOpenaiKey' : fieldKey === 'xAIApiKey' ? 'hasXAIKey' : 'hasAnthropicKey'
        const hasKey = d[hasKeyField]
        const masked = d[fieldKey] as string | null
        if (hasKey && masked) setSavedMasked(masked)
      })
      .catch(() => {})
  }, [fieldKey])

  async function handleSave() {
    if (!key.trim()) {
      onToast({ type: 'error', message: 'Please enter an API key' })
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
        throw new Error(data.error ?? 'Failed to save')
      }
      setSavedMasked(key.trim().slice(0, 6) + '••••••••' + key.trim().slice(-4))
      setKey('')
      // Auto-test after save
      if (testProvider) void handleTest()
      else onToast({ type: 'success', message: `${label} saved successfully` })
    } catch (err) {
      onToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save API key',
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
        throw new Error(data.error ?? 'Failed to remove')
      }
      setSavedMasked(null)
      setTestState('idle')
      onToast({ type: 'success', message: `${label} removed` })
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to remove key' })
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
        onToast({ type: 'success', message: `${label} is working` })
      } else {
        setTestState('fail')
        setTestError(data.error ?? 'Key test failed')
      }
    } catch {
      setTestState('fail')
      setTestError('Connection error')
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <p className="text-sm font-medium text-zinc-300 shrink-0">{label}</p>
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          {savedMasked && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-lg min-w-0 overflow-hidden">
              <Check size={11} className="shrink-0" /> <span className="shrink-0">Saved:</span> <span className="font-mono truncate">{savedMasked}</span>
            </span>
          )}
          {savedMasked && (
            <button
              onClick={() => void handleRemove()}
              disabled={removing}
              className="shrink-0 text-xs text-red-500/70 hover:text-red-400 transition-colors disabled:opacity-50"
              title="Remove saved key"
            >
              {removing ? 'Removing…' : 'Remove'}
            </button>
          )}
          {testProvider && savedMasked && testState === 'idle' && (
            <button
              onClick={() => void handleTest()}
              className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Test
            </button>
          )}
          {testState === 'testing' && (
            <span className="flex items-center gap-1 text-xs text-zinc-400 shrink-0">
              <Loader2 size={11} className="animate-spin" /> Testing…
            </span>
          )}
          {testState === 'ok' && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 shrink-0">
              <Check size={11} /> Working
            </span>
          )}
          {testState === 'fail' && (
            <span className="flex items-center gap-1 text-xs text-red-400 shrink-0" title={testError}>
              <X size={11} /> {testError.slice(0, 30) || 'Failed'}
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
            placeholder={savedMasked ? 'Enter new key to replace…' : placeholder}
            className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all duration-200 pr-10 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shrink-0"
        >
          {saving ? 'Saving…' : 'Save'}
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
          Get key <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}

function ModelSelector({
  models,
  settingKey,
  defaultValue,
  onToast,
}: {
  models: { value: string; label: string; description: string }[]
  settingKey: 'anthropicModel' | 'openaiModel' | 'xAIModel'
  defaultValue: string
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
        <span className="text-xs text-zinc-500 shrink-0">Model:</span>
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
            <Check size={12} /> Saved
          </span>
        )}
        {!saved && selected && (
          <span className="text-xs text-zinc-600 shrink-0 hidden sm:block">{selected.description}</span>
        )}
      </div>
      {value === 'claude-opus-4-6' && (
        <p className="text-xs text-amber-500/80 mt-1.5">
          Opus is slow with 20 parallel workers — consider Sonnet or Haiku for faster bulk categorization.
        </p>
      )}
    </>
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
            Claude CLI detected — no API key needed
          </p>
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
            Signed in as <span className="text-zinc-300">{tier}</span> via Claude Code. Siftly will use your subscription automatically. An API key below will take priority if set.
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
          <p className="text-sm font-medium text-amber-300">Claude CLI session expired</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Run <span className="font-mono text-zinc-300">claude</span> in your terminal to refresh the session, then reload this page.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 p-3.5 rounded-xl bg-zinc-800/60 border border-zinc-700 mb-5">
      <Terminal size={15} className="text-zinc-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200">No Claude CLI detected</p>
        <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
          Install Claude Code and sign in to skip the API key entirely, or paste your API key below.
        </p>
      </div>
    </div>
  )
}

function CodexCliStatusBox() {
  const [status, setStatus] = useState<{ available: boolean; expired?: boolean; planType?: string; authMode?: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/cli-status')
      .then((r) => r.json())
      .then((d: { codex?: { available: boolean; expired?: boolean; planType?: string; authMode?: string } }) => setStatus(d.codex ?? { available: false }))
      .catch(() => setStatus({ available: false }))
  }, [])

  if (status === null) return null

  if (status.available && !status.expired) {
    const tier = status.planType
      ? status.planType.charAt(0).toUpperCase() + status.planType.slice(1)
      : 'CLI'
    return (
      <div className="flex gap-3 p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 mb-5">
        <Check size={15} className="text-emerald-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-emerald-300">
            Codex CLI detected — no API key needed
          </p>
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
            Signed in as <span className="text-zinc-300">{tier}</span> via Codex CLI. Siftly will use your credentials automatically. An API key below will take priority if set.
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
          <p className="text-sm font-medium text-amber-300">Codex CLI session expired</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Run <span className="font-mono text-zinc-300">codex</span> in your terminal to refresh, then reload this page.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 p-3.5 rounded-xl bg-zinc-800/60 border border-zinc-700 mb-5">
      <Terminal size={15} className="text-zinc-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200">No Codex CLI detected</p>
        <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
          Install Codex CLI and sign in to skip the API key entirely, or paste your OpenAI API key below.
        </p>
      </div>
    </div>
  )
}

function ProviderToggle({ value, onChange }: { value: 'anthropic' | 'openai' | 'xAI'; onChange: (v: 'anthropic' | 'openai' | 'xAI') => void }) {
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
        Anthropic (Claude)
      </button>
      <button
        onClick={() => onChange('openai')}
        className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          value === 'openai'
            ? 'bg-emerald-600 text-white shadow-sm'
            : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        OpenAI (GPT)
      </button>
      <button
        onClick={() => onChange('xAI')}
        className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          value === 'xAI'
            ? 'bg-emerald-600 text-white shadow-sm'
            : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        xAI (Grok)
      </button>
    </div>
  )
}

function ApiKeySection({ onToast }: { onToast: (t: Toast) => void }) {
  const [provider, setProvider] = useState<'anthropic' | 'openai' | 'xAI' | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: { provider?: string }) => {
        setProvider(d.provider === 'openai' ? 'openai' : d.provider === 'xai' ? 'xAI' : 'anthropic')
      })
      .catch(() => setProvider('anthropic'))
  }, [])

  async function handleProviderChange(newProvider: 'anthropic' | 'openai' | 'xAI') {
    const prev = provider
    setProvider(newProvider)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: newProvider === 'xAI' ? 'xai' : newProvider }),
      })
      if (!res.ok) throw new Error('Failed to save provider')
      onToast({ type: 'success', message: `Switched to ${newProvider === 'openai' ? 'OpenAI' : newProvider === 'xAI' ? 'xAI' : 'Anthropic'}` })
    } catch {
      setProvider(prev) // revert on failure
      onToast({ type: 'error', message: 'Failed to save provider preference' })
    }
  }

  // Don't render until we know the saved provider — avoids flicker
  if (provider === null) {
    return (
      <Section
        icon={Key}
        title="AI Provider"
        description="Choose your AI provider and configure keys. CLI auth means no key needed."
      >
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={14} className="animate-spin" /> Loading settings…
        </div>
      </Section>
    )
  }

  return (
    <Section
      icon={Key}
      title="AI Provider"
      description="Choose your AI provider and configure keys. CLI auth means no key needed."
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
                hint="Used for AI categorization, search, and image analysis."
                docHref="https://console.anthropic.com"
                onToast={onToast}
                testProvider="anthropic"
              />
              <ModelSelector
                models={ANTHROPIC_MODELS}
                settingKey="anthropicModel"
                defaultValue="claude-haiku-4-5-20251001"
                onToast={onToast}
              />
              <p className="text-xs text-zinc-500 mt-1.5">Applies to all AI operations — API key <strong className="text-zinc-400 font-medium">and Claude CLI</strong></p>
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
                hint="Used for AI categorization, search, and image analysis."
                docHref="https://platform.openai.com/api-keys"
                onToast={onToast}
                testProvider="openai"
              />
              <ModelSelector
                models={OPENAI_MODELS}
                settingKey="openaiModel"
                defaultValue="gpt-4.1-mini"
                onToast={onToast}
              />
              <p className="text-xs text-zinc-500 mt-1.5">Applies to all AI operations — API key <strong className="text-zinc-400 font-medium">and Codex CLI</strong></p>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-5">
            <div>
              <ApiKeyField
                label="xAI"
                placeholder="xai-..."
                fieldKey="xAIApiKey"
                hint="Used for AI categorization, search, and image analysis."
                docHref="https://console.x.ai"
                onToast={onToast}
                testProvider="xai"
              />
              <ModelSelector
                models={xAI_MODELS}
                settingKey="xAIModel"
                defaultValue="grok-4-fast-reasoning"
                onToast={onToast}
              />
              <p className="text-xs text-zinc-500 mt-1.5">Applies to all AI operations — API key only</p>
            </div>
          </div>
        </>
      )}
      <p className="text-xs text-zinc-600 mt-4">Keys are stored in plaintext in your local SQLite database (<code className="font-mono">prisma/dev.db</code>). Do not expose the database file.</p>
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

function DataSection() {
  return (
    <Section
      icon={Database}
      title="Data Management"
      description="Export all your bookmarks and category data for backup or migration."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ExportButton
          label="Export as CSV"
          href="/api/export?type=csv"
          description="Spreadsheet-compatible format"
        />
        <ExportButton
          label="Export as JSON"
          href="/api/export?type=json"
          description="Full data with all fields"
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
        throw new Error(data.error ?? 'Failed to clear')
      }
      onToast({ type: 'success', message: 'All bookmarks deleted successfully' })
      setConfirming(false)
      setCleared(true)
      setTimeout(() => setCleared(false), 3000)
      window.dispatchEvent(new CustomEvent('siftly:cleared'))
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to clear bookmarks' })
    } finally {
      setClearing(false)
    }
  }

  return (
    <Section
      icon={Shield}
      title="Danger Zone"
      description="Irreversible actions that affect all your data."
      variant="danger"
    >
      <div className="flex items-center justify-between p-4 rounded-xl bg-red-900/20 border border-red-800/40">
        <div>
          <p className="text-sm font-medium text-zinc-300">Clear all bookmarks</p>
          <p className="text-xs text-zinc-500 mt-0.5">Permanently delete all imported bookmarks</p>
        </div>
        {cleared ? (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
            <Check size={14} />
            Cleared
          </div>
        ) : !confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-red-400 bg-red-800/30 hover:bg-red-700/40 border border-red-700/50 hover:border-red-600/60 transition-all"
          >
            <Trash2 size={14} />
            Clear all
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 mr-1">Are you sure?</span>
            <button
              onClick={() => setConfirming(false)}
              disabled={clearing}
              className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleClearAll()}
              disabled={clearing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 size={12} />
              {clearing ? 'Deleting…' : 'Yes, delete all'}
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
  { label: 'Anthropic / OpenAI', color: 'bg-blue-500/10 text-blue-300 border-blue-500/20' },
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
    <Section icon={Info} title="About Siftly" description="Self-hosted Twitter bookmark manager">
      <p className="text-sm text-zinc-400 leading-relaxed mb-5">
        <strong className="text-zinc-100 font-semibold">Siftly</strong> is a self-hosted app for
        organizing your Twitter/X bookmarks. Use the built-in bookmarklet or console script to import,
        then run the 4-stage AI pipeline to analyze images, extract entities, generate semantic tags, and
        auto-categorize — then explore connections through the interactive mindmap.
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
            <p className="text-[11px] text-zinc-600">Built &amp; open-sourced by</p>
          </div>
          <ExternalLink size={12} className="text-zinc-600 group-hover:text-zinc-400 transition-colors ml-auto shrink-0" />
        </a>

        {/* Donate */}
        <div className="flex-1 px-4 py-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Coffee size={13} className="text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-amber-300">Support development</span>
          </div>
          <p className="text-[11px] text-zinc-500 mb-2.5 leading-relaxed">
            If Siftly saves you time, consider leaving a tip
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
            <p className="text-[10px] text-emerald-400 mt-1.5 text-center">Address copied!</p>
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
      onToast({ type: 'error', message: 'Client ID is required' })
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
        throw new Error(data.error ?? 'Failed to save')
      }
      setSavedId(clientId.trim().slice(0, 6) + '••••' + clientId.trim().slice(-4))
      if (clientSecret.trim()) setSavedSecret(clientSecret.trim().slice(0, 4) + '••••')
      setClientId('')
      setClientSecret('')
      onToast({ type: 'success', message: 'X OAuth credentials saved' })
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' })
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
      onToast({ type: 'success', message: 'X OAuth credentials removed' })
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to remove' })
    }
  }

  const callbackUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/import/x-oauth/callback`
    : '/api/import/x-oauth/callback'

  return (
    <Section
      icon={Shield}
      title="X (Twitter) OAuth 2.0"
      description="Connect your X account to import bookmarks using the official API."
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
                title="Remove X OAuth credentials"
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
                placeholder="Client Secret (optional for public clients)"
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
              {saving ? 'Saving...' : 'Save X OAuth Credentials'}
            </button>
          </div>
        )}

        <div className="text-xs text-zinc-600 space-y-1">
          <p>
            Get credentials from the{' '}
            <a href="https://developer.x.com/en/portal/dashboard" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
              X Developer Portal
            </a>
          </p>
          <p>
            Callback URL: <code className="bg-zinc-800 px-1.5 py-0.5 rounded font-mono text-zinc-400">{callbackUrl}</code>
          </p>
        </div>
      </div>
    </Section>
  )
}

export default function SettingsPage() {
  const [toast, setToast] = useState<Toast | null>(null)

  function showToast(t: Toast) {
    setToast(t)
    setTimeout(() => setToast(null), 4000)
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">

      {/* Page Header */}
      <div className="mb-8">
        <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium mb-1">Configuration</p>
        <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
        <p className="text-zinc-400 mt-1 text-sm">Configure your Siftly instance</p>
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
        <DangerZoneSection onToast={showToast} />
        <AboutSection />
      </div>
    </div>
  )
}
