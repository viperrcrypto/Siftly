import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getCliAuthStatus, getCliAvailability } from '@/lib/claude-cli-auth'
import { getCodexCliAuthStatus } from '@/lib/openai-auth'
import { getOpencodeAuthStatus } from '@/lib/opencode-auth'

export async function GET(): Promise<NextResponse> {
  const oauthStatus = getCliAuthStatus()
  const codexStatus = getCodexCliAuthStatus()
  const opencodeStatus = getOpencodeAuthStatus()

  // Read provider directly from DB (not cached) — this endpoint is called
  // right after the user toggles the provider, so it must be fresh.
  const providerSetting = await prisma.setting.findUnique({ where: { key: 'aiProvider' } })
  const provider = providerSetting?.value ?? 'anthropic'

  // Only check CLI subprocess availability if OAuth credentials exist
  const cliDirectAvailable = oauthStatus.available && !oauthStatus.expired
    ? await getCliAvailability()
    : false

  return NextResponse.json({
    ...oauthStatus,
    cliDirectAvailable,
    mode: cliDirectAvailable ? 'cli' : oauthStatus.available ? 'oauth' : 'api-key',
    codex: codexStatus,
    opencode: opencodeStatus,
    provider,
  })
}
