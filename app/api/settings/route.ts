import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { invalidateSettingsCache } from '@/lib/settings'
import { validateVaultPath } from '@/lib/obsidian-exporter'

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

const ALLOWED_MINIMAX_MODELS = [
  'MiniMax-M2.7',
  'MiniMax-M2.5',
  'MiniMax-M2.5-highspeed',
] as const

const ALLOWED_PROVIDERS = ['anthropic', 'openai', 'minimax', 'openai_compatible'] as const

export async function GET(): Promise<NextResponse> {
  try {
    const [
      anthropic, anthropicModel, provider, openai, openaiModel,
      minimax, minimaxModel,
      openaiCompatibleApiKey, openaiCompatibleBaseUrl, openaiCompatibleModel,
      xClientId, xClientSecret, obsidianVault,
    ] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'anthropicApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'anthropicModel' } }),
      prisma.setting.findUnique({ where: { key: 'aiProvider' } }),
      prisma.setting.findUnique({ where: { key: 'openaiApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'openaiModel' } }),
      prisma.setting.findUnique({ where: { key: 'minimaxApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'minimaxModel' } }),
      prisma.setting.findUnique({ where: { key: 'openaiCompatibleApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'openaiCompatibleBaseUrl' } }),
      prisma.setting.findUnique({ where: { key: 'openaiCompatibleModel' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_secret' } }),
      prisma.setting.findUnique({ where: { key: 'obsidianVaultPath' } }),
    ])

    return NextResponse.json({
      provider: provider?.value ?? 'anthropic',
      anthropicApiKey: maskKey(anthropic?.value ?? null),
      hasAnthropicKey: anthropic !== null,
      anthropicModel: anthropicModel?.value ?? 'claude-haiku-4-5-20251001',
      openaiApiKey: maskKey(openai?.value ?? null),
      hasOpenaiKey: openai !== null,
      openaiModel: openaiModel?.value ?? 'gpt-4.1-mini',
      minimaxApiKey: maskKey(minimax?.value ?? null),
      hasMinimaxKey: minimax !== null,
      minimaxModel: minimaxModel?.value ?? 'MiniMax-M2.7',
      // OpenAI-compatible provider settings
      openaiCompatibleApiKey: maskKey(openaiCompatibleApiKey?.value ?? null),
      hasOpenaiCompatibleKey: !!openaiCompatibleApiKey?.value,
      openaiCompatibleBaseUrl: openaiCompatibleBaseUrl?.value ?? '',
      openaiCompatibleModel: openaiCompatibleModel?.value ?? '',
      // X OAuth
      xOAuthClientId: maskKey(xClientId?.value ?? null),
      xOAuthClientSecret: maskKey(xClientSecret?.value ?? null),
      hasXOAuth: !!xClientId?.value,
      obsidianVaultPath: obsidianVault?.value ?? null,
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
    minimaxApiKey?: string
    minimaxModel?: string
    openaiCompatibleApiKey?: string
    openaiCompatibleBaseUrl?: string
    openaiCompatibleModel?: string
    xOAuthClientId?: string
    xOAuthClientSecret?: string
    obsidianVaultPath?: string
  } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    anthropicApiKey, anthropicModel, provider, openaiApiKey, openaiModel,
    minimaxApiKey, minimaxModel,
    openaiCompatibleApiKey, openaiCompatibleBaseUrl, openaiCompatibleModel,
  } = body

  // Save provider if provided
  if (provider !== undefined) {
    if (!(ALLOWED_PROVIDERS as readonly string[]).includes(provider)) {
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

  // Save MiniMax model if provided
  if (minimaxModel !== undefined) {
    if (!(ALLOWED_MINIMAX_MODELS as readonly string[]).includes(minimaxModel)) {
      return NextResponse.json({ error: 'Invalid MiniMax model' }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'minimaxModel' },
      update: { value: minimaxModel },
      create: { key: 'minimaxModel', value: minimaxModel },
    })
    invalidateSettingsCache()
    return NextResponse.json({ saved: true })
  }

  // Save OpenAI-compatible model (free-form string, no allowlist)
  if (openaiCompatibleModel !== undefined) {
    const trimmed = openaiCompatibleModel.trim()
    if (!trimmed) {
      return NextResponse.json({ error: 'Model name cannot be empty' }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'openaiCompatibleModel' },
      update: { value: trimmed },
      create: { key: 'openaiCompatibleModel', value: trimmed },
    })
    invalidateSettingsCache()
    return NextResponse.json({ saved: true })
  }

  // Save OpenAI-compatible base URL
  if (openaiCompatibleBaseUrl !== undefined) {
    const trimmed = openaiCompatibleBaseUrl.trim()
    if (!trimmed) {
      return NextResponse.json({ error: 'Base URL cannot be empty' }, { status: 400 })
    }
    // Basic URL validation
    try {
      new URL(trimmed)
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'openaiCompatibleBaseUrl' },
      update: { value: trimmed },
      create: { key: 'openaiCompatibleBaseUrl', value: trimmed },
    })
    invalidateSettingsCache()
    return NextResponse.json({ saved: true })
  }

  // Save OpenAI-compatible API key
  if (openaiCompatibleApiKey !== undefined) {
    const trimmed = openaiCompatibleApiKey.trim()
    // Allow empty string to clear key (some local servers don't need one)
    if (trimmed === '') {
      await prisma.setting.deleteMany({ where: { key: 'openaiCompatibleApiKey' } })
      invalidateSettingsCache()
      return NextResponse.json({ saved: true })
    }
    try {
      await prisma.setting.upsert({
        where: { key: 'openaiCompatibleApiKey' },
        update: { value: trimmed },
        create: { key: 'openaiCompatibleApiKey', value: trimmed },
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

  // Save MiniMax key if provided
  if (minimaxApiKey !== undefined) {
    if (typeof minimaxApiKey !== 'string' || minimaxApiKey.trim() === '') {
      return NextResponse.json({ error: 'Invalid minimaxApiKey value' }, { status: 400 })
    }
    const trimmed = minimaxApiKey.trim()
    try {
      await prisma.setting.upsert({
        where: { key: 'minimaxApiKey' },
        update: { value: trimmed },
        create: { key: 'minimaxApiKey', value: trimmed },
      })
      invalidateSettingsCache()
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('Settings POST (minimax) error:', err)
      return NextResponse.json(
        { error: `Failed to save: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      )
    }
  }

  // Save Obsidian vault path if provided
  if (body.obsidianVaultPath !== undefined) {
    const trimmed = body.obsidianVaultPath.trim()
    if (!trimmed) {
      // Allow clearing the path
      await prisma.setting.deleteMany({ where: { key: 'obsidianVaultPath' } })
      return NextResponse.json({ saved: true })
    }
    const validation = await validateVaultPath(trimmed)
    if (!validation.valid) {
      return NextResponse.json({ error: `Invalid vault path: ${validation.error}` }, { status: 400 })
    }
    await prisma.setting.upsert({
      where: { key: 'obsidianVaultPath' },
      update: { value: trimmed },
      create: { key: 'obsidianVaultPath', value: trimmed },
    })
    return NextResponse.json({ saved: true })
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

  const allowed = [
    'anthropicApiKey', 'openaiApiKey', 'minimaxApiKey',
    'openaiCompatibleApiKey', 'openaiCompatibleBaseUrl', 'openaiCompatibleModel',
    'x_oauth_client_id', 'x_oauth_client_secret',
  ]
  if (!body.key || !allowed.includes(body.key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }

  await prisma.setting.deleteMany({ where: { key: body.key } })
  invalidateSettingsCache()
  return NextResponse.json({ deleted: true })
}
