import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { invalidateSettingsCache } from '@/lib/settings'

function maskKey(raw: string | null): string | null {
  if (!raw) return null
  if (raw.length <= 8) return '********'
  return `${raw.slice(0, 6)}${'*'.repeat(raw.length - 10)}${raw.slice(-4)}`
}

const ALLOWED_ANTHROPIC_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
] as const

const ALLOWED_OPENAI_MODELS = [
  'gpt-4.1-mini',
  'gpt-4.1',
  'gpt-4.1-nano',
  'o4-mini',
  'o3',
] as const

const ALLOWED_OPENCODE_MODELS = [
  'gpt-4.1-mini',
  'gpt-4.1',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
] as const

export async function GET(): Promise<NextResponse> {
  try {
    const [anthropic, anthropicModel, provider, openai, openaiModel, opencode, opencodeModel, xClientId, xClientSecret] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'anthropicApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'anthropicModel' } }),
      prisma.setting.findUnique({ where: { key: 'aiProvider' } }),
      prisma.setting.findUnique({ where: { key: 'openaiApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'openaiModel' } }),
      prisma.setting.findUnique({ where: { key: 'opencodeApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'opencodeModel' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_secret' } }),
    ])

    return NextResponse.json({
      provider: provider?.value ?? 'anthropic',
      anthropicApiKey: maskKey(anthropic?.value ?? null),
      hasAnthropicKey: anthropic !== null,
      anthropicModel: anthropicModel?.value ?? 'claude-haiku-4-5-20251001',
      openaiApiKey: maskKey(openai?.value ?? null),
      hasOpenaiKey: openai !== null,
      openaiModel: openaiModel?.value ?? 'gpt-4.1-mini',
      opencodeApiKey: maskKey(opencode?.value ?? null),
      hasOpencodeKey: opencode !== null,
      opencodeModel: opencodeModel?.value ?? 'gpt-4.1-mini',
      xOAuthClientId: maskKey(xClientId?.value ?? null),
      xOAuthClientSecret: maskKey(xClientSecret?.value ?? null),
      hasXOAuth: !!xClientId?.value,
    })
  } catch (err) {
    console.error('Settings GET error:', err)
    return NextResponse.json(
      { error: `Failed to fetch settings: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    anthropicApiKey?: string
    anthropicModel?: string
    provider?: string
    openaiApiKey?: string
    openaiModel?: string
    opencodeApiKey?: string
    opencodeModel?: string
    xOAuthClientId?: string
    xOAuthClientSecret?: string
  } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { anthropicApiKey, anthropicModel, provider, openaiApiKey, openaiModel, opencodeApiKey, opencodeModel } = body

  // Save provider if provided
  if (provider !== undefined) {
    if (!['anthropic', 'openai', 'opencode'].includes(provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'aiProvider' },
      update: { value: provider },
      create: { key: 'aiProvider', value: provider },
    })
    invalidateSettingsCache()
    return NextResponse.json({ saved: true })
  }

  // Save Anthropic model if provided
  if (anthropicModel !== undefined) {
    if (!(ALLOWED_ANTHROPIC_MODELS as readonly string[]).includes(anthropicModel)) {
      return NextResponse.json({ error: 'Invalid Anthropic model' }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'anthropicModel' },
      update: { value: anthropicModel },
      create: { key: 'anthropicModel', value: anthropicModel },
    })
    invalidateSettingsCache()
    return NextResponse.json({ saved: true })
  }

  // Save OpenAI model if provided
  if (openaiModel !== undefined) {
    if (!(ALLOWED_OPENAI_MODELS as readonly string[]).includes(openaiModel)) {
      return NextResponse.json({ error: 'Invalid OpenAI model' }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'openaiModel' },
      update: { value: openaiModel },
      create: { key: 'openaiModel', value: openaiModel },
    })
    invalidateSettingsCache()
    return NextResponse.json({ saved: true })
  }

  // Save OpenCode model if provided
  if (opencodeModel !== undefined) {
    if (!(ALLOWED_OPENCODE_MODELS as readonly string[]).includes(opencodeModel)) {
      return NextResponse.json({ error: 'Invalid OpenCode model' }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'opencodeModel' },
      update: { value: opencodeModel },
      create: { key: 'opencodeModel', value: opencodeModel },
    })
    invalidateSettingsCache()
    return NextResponse.json({ saved: true })
  }

  // Save Anthropic key if provided
  if (anthropicApiKey !== undefined) {
    if (typeof anthropicApiKey !== 'string' || anthropicApiKey.trim() === '') {
      return NextResponse.json({ error: 'Invalid anthropicApiKey value' }, { status: 400 })
    }
    const trimmed = anthropicApiKey.trim()
    try {
      await prisma.setting.upsert({
        where: { key: 'anthropicApiKey' },
        update: { value: trimmed },
        create: { key: 'anthropicApiKey', value: trimmed },
      })
      invalidateSettingsCache()
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('Settings POST (anthropic) error:', err)
      return NextResponse.json(
        { error: `Failed to save: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      )
    }
  }

  // Save OpenAI key if provided
  if (openaiApiKey !== undefined) {
    if (typeof openaiApiKey !== 'string' || openaiApiKey.trim() === '') {
      return NextResponse.json({ error: 'Invalid openaiApiKey value' }, { status: 400 })
    }
    const trimmed = openaiApiKey.trim()
    try {
      await prisma.setting.upsert({
        where: { key: 'openaiApiKey' },
        update: { value: trimmed },
        create: { key: 'openaiApiKey', value: trimmed },
      })
      invalidateSettingsCache()
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('Settings POST (openai) error:', err)
      return NextResponse.json(
        { error: `Failed to save: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      )
    }
  }

  // Save OpenCode key if provided
  if (opencodeApiKey !== undefined) {
    if (typeof opencodeApiKey !== 'string' || opencodeApiKey.trim() === '') {
      return NextResponse.json({ error: 'Invalid opencodeApiKey value' }, { status: 400 })
    }
    const trimmed = opencodeApiKey.trim()
    try {
      await prisma.setting.upsert({
        where: { key: 'opencodeApiKey' },
        update: { value: trimmed },
        create: { key: 'opencodeApiKey', value: trimmed },
      })
      invalidateSettingsCache()
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('Settings POST (opencode) error:', err)
      return NextResponse.json(
        { error: `Failed to save: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      )
    }
  }

  // Save X OAuth credentials if provided
  const { xOAuthClientId, xOAuthClientSecret } = body
  const xKeys: { key: string; value: string | undefined }[] = [
    { key: 'x_oauth_client_id', value: xOAuthClientId },
    { key: 'x_oauth_client_secret', value: xOAuthClientSecret },
  ]
  const xToSave = xKeys.filter((k) => k.value !== undefined && k.value.trim() !== '')
  if (xToSave.length > 0) {
    try {
      for (const { key, value } of xToSave) {
        await prisma.setting.upsert({
          where: { key },
          update: { value: value!.trim() },
          create: { key, value: value!.trim() },
        })
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('Settings POST (X OAuth) error:', err)
      return NextResponse.json(
        { error: `Failed to save: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ error: 'No setting provided' }, { status: 400 })
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  let body: { key?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const allowed = ['anthropicApiKey', 'openaiApiKey', 'opencodeApiKey', 'x_oauth_client_id', 'x_oauth_client_secret']
  if (!body.key || !allowed.includes(body.key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }

  await prisma.setting.deleteMany({ where: { key: body.key } })
  invalidateSettingsCache()
  return NextResponse.json({ deleted: true })
}
