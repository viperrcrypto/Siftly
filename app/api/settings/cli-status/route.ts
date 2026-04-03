import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getCliAuthStatus, getCliAvailability } from '@/lib/claude-cli-auth'
import { getCopilotCliAuthStatus, getCopilotCliAvailability } from '@/lib/copilot-cli'
import { getCodexCliAvailability } from '@/lib/codex-cli'
import { getCodexCliAuthStatus } from '@/lib/openai-auth'
import { getOpenAICliPreference, getOpenAIModel } from '@/lib/settings'

export async function GET(): Promise<NextResponse> {
  const oauthStatus = getCliAuthStatus()
  const codexStatus = getCodexCliAuthStatus()
  const copilotStatus = getCopilotCliAuthStatus()

  // Read provider directly from DB (not cached) — this endpoint is called
  // right after the user toggles the provider, so it must be fresh.
  const [providerSetting, cliDirectAvailable, codexInstalled, copilotInstalled, openaiCliPreference, openaiModel] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'aiProvider' } }),
    oauthStatus.available && !oauthStatus.expired ? getCliAvailability() : Promise.resolve(false),
    getCodexCliAvailability(),
    getCopilotCliAvailability(),
    getOpenAICliPreference(),
    getOpenAIModel(),
  ])
  const provider = providerSetting?.value === 'openai' ? 'openai' : 'anthropic'

  return NextResponse.json({
    ...oauthStatus,
    cliDirectAvailable,
    mode: cliDirectAvailable ? 'cli' : oauthStatus.available ? 'oauth' : 'api-key',
    codex: { ...codexStatus, installed: codexInstalled, configuredModel: openaiModel },
    copilot: { ...copilotStatus, installed: copilotInstalled },
    openaiCliPreference,
    provider,
  })
}
