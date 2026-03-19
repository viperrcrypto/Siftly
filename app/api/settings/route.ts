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

export async function GET(): Promise<NextResponse> {
  try {
    const [anthropic, anthropicModel, provider, openai, openaiModel, piAiKey, piAiProvider, piAiModel, piAiBaseUrl, piAiHeaders, piAiCompat, xClientId, xClientSecret] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'anthropicApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'anthropicModel' } }),
      prisma.setting.findUnique({ where: { key: 'aiProvider' } }),
      prisma.setting.findUnique({ where: { key: 'openaiApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'openaiModel' } }),
      prisma.setting.findUnique({ where: { key: 'piAiApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'piAiProvider' } }),
      prisma.setting.findUnique({ where: { key: 'piAiModel' } }),
      prisma.setting.findUnique({ where: { key: 'piAiBaseUrl' } }),
      prisma.setting.findUnique({ where: { key: 'piAiHeaders' } }),
      prisma.setting.findUnique({ where: { key: 'piAiCompat' } }),
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
      piAiApiKey: maskKey(piAiKey?.value ?? null),
      hasPiAiKey: piAiKey !== null,
      piAiProvider: piAiProvider?.value ?? 'openai',
      piAiModel: piAiModel?.value ?? 'gpt-4o-mini',
      piAiBaseUrl: piAiBaseUrl?.value ?? null,
      piAiHeaders: piAiHeaders?.value ?? null,
      piAiCompat: piAiCompat?.value ?? null,
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
    piAiApiKey?: string
    piAiProvider?: string
    piAiModel?: string
    piAiBaseUrl?: string
    piAiHeaders?: string
    piAiCompat?: string
    xOAuthClientId?: string
    xOAuthClientSecret?: string
  } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { anthropicApiKey, anthropicModel, provider, openaiApiKey, openaiModel } = body

  // Save provider if provided
  if (provider !== undefined) {
    if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'pi-ai') {
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

  // Save pi-ai fields if provided
  const { piAiApiKey, piAiProvider, piAiModel, piAiBaseUrl, piAiHeaders, piAiCompat } = body

  const hasAnyPiAiField =
    piAiApiKey !== undefined ||
    piAiProvider !== undefined ||
    piAiModel !== undefined ||
    piAiBaseUrl !== undefined ||
    piAiHeaders !== undefined ||
    piAiCompat !== undefined

  if (hasAnyPiAiField) {
    if (piAiApiKey !== undefined) {
      if (typeof piAiApiKey !== 'string' || piAiApiKey.trim() === '') {
        return NextResponse.json({ error: 'Invalid piAiApiKey value' }, { status: 400 })
      }
    }
    if (piAiProvider !== undefined) {
      if (typeof piAiProvider !== 'string' || piAiProvider.trim() === '') {
        return NextResponse.json({ error: 'Invalid piAiProvider value' }, { status: 400 })
      }
    }
    if (piAiModel !== undefined) {
      if (typeof piAiModel !== 'string' || piAiModel.trim() === '') {
        return NextResponse.json({ error: 'Invalid piAiModel value' }, { status: 400 })
      }
    }
    if (piAiBaseUrl !== undefined) {
      if (typeof piAiBaseUrl !== 'string') {
        return NextResponse.json({ error: 'Invalid piAiBaseUrl value' }, { status: 400 })
      }
    }
    if (piAiHeaders !== undefined) {
      if (typeof piAiHeaders !== 'string') {
        return NextResponse.json({ error: 'Invalid piAiHeaders value' }, { status: 400 })
      }
      const trimmed = piAiHeaders.trim()
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed) as unknown
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return NextResponse.json({ error: 'piAiHeaders must be a JSON object' }, { status: 400 })
          }
        } catch {
          return NextResponse.json({ error: 'piAiHeaders must be valid JSON' }, { status: 400 })
        }
      }
    }
    if (piAiCompat !== undefined) {
      if (typeof piAiCompat !== 'string') {
        return NextResponse.json({ error: 'Invalid piAiCompat value' }, { status: 400 })
      }
      const trimmed = piAiCompat.trim()
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed) as unknown
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return NextResponse.json({ error: 'piAiCompat must be a JSON object' }, { status: 400 })
          }
        } catch {
          return NextResponse.json({ error: 'piAiCompat must be valid JSON' }, { status: 400 })
        }
      }
    }

    const toUpsert: { key: string; value: string }[] = []
    if (piAiApiKey !== undefined) toUpsert.push({ key: 'piAiApiKey', value: piAiApiKey.trim() })
    if (piAiProvider !== undefined) toUpsert.push({ key: 'piAiProvider', value: piAiProvider.trim() })
    if (piAiModel !== undefined) toUpsert.push({ key: 'piAiModel', value: piAiModel.trim() })
    if (piAiBaseUrl !== undefined) toUpsert.push({ key: 'piAiBaseUrl', value: piAiBaseUrl.trim() })
    if (piAiHeaders !== undefined) toUpsert.push({ key: 'piAiHeaders', value: piAiHeaders.trim() })
    if (piAiCompat !== undefined) toUpsert.push({ key: 'piAiCompat', value: piAiCompat.trim() })

    for (const { key, value } of toUpsert) {
      await prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    }

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

  const allowed = ['anthropicApiKey', 'openaiApiKey', 'piAiApiKey', 'piAiProvider', 'piAiModel', 'piAiBaseUrl', 'piAiHeaders', 'piAiCompat', 'x_oauth_client_id', 'x_oauth_client_secret']
  if (!body.key || !allowed.includes(body.key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }

  await prisma.setting.deleteMany({ where: { key: body.key } })
  invalidateSettingsCache()
  return NextResponse.json({ deleted: true })
}
