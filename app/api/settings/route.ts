import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { invalidateSettingsCache } from '@/lib/settings'
import { AIProvider } from '@/lib/ai-provider'

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

export async function GET(): Promise<NextResponse> {
  try {
    const [anthropic, anthropicModel, provider, openai, openaiModel, openaiCompat, openaiCompatModel, openaiCompatBaseUrl, xClientId, xClientSecret] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'anthropicApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'anthropicModel' } }),
      prisma.setting.findUnique({ where: { key: 'aiProvider' } }),
      prisma.setting.findUnique({ where: { key: 'openaiApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'openaiModel' } }),
      prisma.setting.findUnique({ where: { key: 'openaiCompatApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'openaiCompatModel' } }),
      prisma.setting.findUnique({ where: { key: 'openaiCompatBaseUrl' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_secret' } }),
    ])

    return NextResponse.json({
      provider: provider?.value === 'openai' || provider?.value === 'openai-compatible' ? provider.value : 'anthropic',
      anthropicApiKey: maskKey(anthropic?.value ?? null),
      hasAnthropicKey: anthropic !== null,
      anthropicModel: anthropicModel?.value ?? 'claude-haiku-4-5-20251001',
      openaiApiKey: maskKey(openai?.value ?? null),
      hasOpenaiKey: openai !== null,
      openaiModel: openaiModel?.value ?? 'gpt-4.1-mini',
      openaiCompatApiKey: maskKey(openaiCompat?.value ?? null),
      hasOpenaiCompatKey: openaiCompat !== null,
      openaiCompatModel: openaiCompatModel?.value ?? process.env.OPENAI_COMPAT_MODEL?.trim() ?? 'openai/gpt-4.1-mini',
      openaiCompatBaseUrl: openaiCompatBaseUrl?.value ?? process.env.OPENAI_COMPAT_BASE_URL?.trim() ?? '',
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
    provider?: AIProvider
    openaiApiKey?: string
    openaiModel?: string
    openaiCompatApiKey?: string
    openaiCompatModel?: string
    openaiCompatBaseUrl?: string
    xOAuthClientId?: string
    xOAuthClientSecret?: string
  } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { anthropicApiKey, anthropicModel, provider, openaiApiKey, openaiModel, openaiCompatApiKey, openaiCompatModel, openaiCompatBaseUrl } = body

  // Save provider if provided
  if (provider !== undefined) {
    if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'openai-compatible') {
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

  if (openaiCompatModel !== undefined) {
    if (typeof openaiCompatModel !== 'string' || openaiCompatModel.trim() === '') {
      return NextResponse.json({ error: 'Invalid openaiCompatModel value' }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'openaiCompatModel' },
      update: { value: openaiCompatModel.trim() },
      create: { key: 'openaiCompatModel', value: openaiCompatModel.trim() },
    })
    invalidateSettingsCache()
    return NextResponse.json({ saved: true })
  }

  if (openaiCompatBaseUrl !== undefined) {
    if (typeof openaiCompatBaseUrl !== 'string' || openaiCompatBaseUrl.trim() === '') {
      return NextResponse.json({ error: 'Invalid openaiCompatBaseUrl value' }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'openaiCompatBaseUrl' },
      update: { value: openaiCompatBaseUrl.trim() },
      create: { key: 'openaiCompatBaseUrl', value: openaiCompatBaseUrl.trim() },
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

  if (openaiCompatApiKey !== undefined) {
    if (typeof openaiCompatApiKey !== 'string' || openaiCompatApiKey.trim() === '') {
      return NextResponse.json({ error: 'Invalid openaiCompatApiKey value' }, { status: 400 })
    }
    const trimmed = openaiCompatApiKey.trim()
    try {
      await prisma.setting.upsert({
        where: { key: 'openaiCompatApiKey' },
        update: { value: trimmed },
        create: { key: 'openaiCompatApiKey', value: trimmed },
      })
      invalidateSettingsCache()
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('Settings POST (openai-compatible) error:', err)
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

  const allowed = ['anthropicApiKey', 'openaiApiKey', 'openaiCompatApiKey', 'x_oauth_client_id', 'x_oauth_client_secret']
  if (!body.key || !allowed.includes(body.key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }

  await prisma.setting.deleteMany({ where: { key: body.key } })
  invalidateSettingsCache()
  return NextResponse.json({ deleted: true })
}
