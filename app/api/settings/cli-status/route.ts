import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getCliAuthStatus, getCliAvailability } from '@/lib/claude-cli-auth'
import { getCodexCliAuthStatus } from '@/lib/openai-auth'
import { getOllamaBaseUrl } from '@/lib/settings'

export async function GET(): Promise<NextResponse> {
  const oauthStatus = getCliAuthStatus()
  const codexStatus = getCodexCliAuthStatus()

  // Read provider directly from DB (not cached) — this endpoint is called
  // right after the user toggles the provider, so it must be fresh.
  const providerSetting = await prisma.setting.findUnique({ where: { key: 'aiProvider' } })
  const val = providerSetting?.value
  const provider = val === 'openai' ? 'openai' : val === 'ollama' ? 'ollama' : 'anthropic'

  // Only check CLI subprocess availability if OAuth credentials exist
  const cliDirectAvailable = oauthStatus.available && !oauthStatus.expired
    ? await getCliAvailability()
    : false

  // Check Ollama availability by hitting its API
  let ollamaStatus: { available: boolean; error?: string } = { available: false }
  if (provider === 'ollama') {
    try {
      const baseUrl = await getOllamaBaseUrl()
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const data = await res.json() as { models?: { name: string }[] }
        ollamaStatus = { available: true }
        if (data.models) {
          (ollamaStatus as { available: boolean; models?: string[] }).models = data.models.map(m => m.name)
        }
      } else {
        ollamaStatus = { available: false, error: `HTTP ${res.status}` }
      }
    } catch (err) {
      ollamaStatus = { available: false, error: err instanceof Error ? err.message : 'Connection failed' }
    }
  }

  return NextResponse.json({
    ...oauthStatus,
    cliDirectAvailable,
    mode: cliDirectAvailable ? 'cli' : oauthStatus.available ? 'oauth' : 'api-key',
    codex: codexStatus,
    ollama: ollamaStatus,
    provider,
  })
}
