import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getCliAuthStatus, getCliAvailability } from '@/lib/claude-cli-auth'
import { getCodexCliAuthStatus } from '@/lib/openai-auth'
import { getCodexCliAvailability } from '@/lib/codex-cli'

export async function GET(): Promise<NextResponse> {
  const oauthStatus = getCliAuthStatus()
  const codexStatus = getCodexCliAuthStatus()

  // Read provider directly from DB (not cached) — this endpoint is called
  // right after the user toggles the provider, so it must be fresh.
  const providerSetting = await prisma.setting.findUnique({ where: { key: 'aiProvider' } })
  const provider = providerSetting?.value === 'openai'
    ? 'openai'
    : providerSetting?.value === 'minimax'
    ? 'minimax'
    : 'anthropic'

  // Only check CLI subprocess availability if OAuth credentials exist
  const cliDirectAvailable = oauthStatus.available && !oauthStatus.expired
    ? await getCliAvailability()
    : false

  // Verify codex binary is actually installed, not just credential files
  const codexBinaryAvailable = codexStatus.available && !codexStatus.expired
    ? await getCodexCliAvailability()
    : false

  return NextResponse.json({
    ...oauthStatus,
    cliDirectAvailable,
    mode: cliDirectAvailable ? 'cli' : oauthStatus.available ? 'oauth' : 'api-key',
    codex: {
      ...codexStatus,
      available: codexBinaryAvailable,
      hasCredentials: codexStatus.available,
    },
    provider,
  })
}
