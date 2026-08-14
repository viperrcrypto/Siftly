import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { invalidateSettingsCache } from '@/lib/settings'
import { validateVaultPath } from '@/lib/obsidian-exporter'
import { safeRelativePath } from '@/lib/archive/clipper'
import { validateGallerySettings } from '@/lib/archive/gallery-dl'

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

export async function GET(): Promise<NextResponse> {
  try {
    const [anthropic, anthropicModel, provider, openai, openaiModel, minimax, minimaxModel, xClientId, xClientSecret, obsidianVault, archiveEnabled, autoAfterImport, archiveTemplateDir, galleryDlPath, cookieBrowser, downloadXVideo, downloadPdf, sourceResolverEnabled, archiveRoot] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'anthropicApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'anthropicModel' } }),
      prisma.setting.findUnique({ where: { key: 'aiProvider' } }),
      prisma.setting.findUnique({ where: { key: 'openaiApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'openaiModel' } }),
      prisma.setting.findUnique({ where: { key: 'minimaxApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'minimaxModel' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_secret' } }),
      prisma.setting.findUnique({ where: { key: 'obsidianVaultPath' } }),
      prisma.setting.findUnique({ where: { key: 'archiveEnabled' } }),
      prisma.setting.findUnique({ where: { key: 'autoAfterImport' } }),
      prisma.setting.findUnique({ where: { key: 'archiveTemplateDir' } }),
      prisma.setting.findUnique({ where: { key: 'galleryDlPath' } }),
      prisma.setting.findUnique({ where: { key: 'cookieBrowser' } }),
      prisma.setting.findUnique({ where: { key: 'downloadXVideo' } }),
      prisma.setting.findUnique({ where: { key: 'downloadPdf' } }),
      prisma.setting.findUnique({ where: { key: 'sourceResolverEnabled' } }),
      prisma.setting.findUnique({ where: { key: 'archiveRoot' } }),
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
      xOAuthClientId: maskKey(xClientId?.value ?? null),
      xOAuthClientSecret: maskKey(xClientSecret?.value ?? null),
      hasXOAuth: !!xClientId?.value,
      obsidianVaultPath: obsidianVault?.value ?? null,
      archiveEnabled: archiveEnabled?.value === 'true', autoAfterImport: autoAfterImport?.value === 'true',
      archiveTemplateDir: archiveTemplateDir?.value ?? null, galleryDlPath: galleryDlPath?.value ?? null,
      cookieBrowser: cookieBrowser?.value ?? null, downloadXVideo: downloadXVideo?.value === 'true',
      downloadPdf: downloadPdf?.value === 'true', sourceResolverEnabled: sourceResolverEnabled?.value !== 'false', archiveRoot: archiveRoot?.value ?? 'Clippings/Siftly',
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
    xOAuthClientId?: string
    xOAuthClientSecret?: string
    obsidianVaultPath?: string
    archiveEnabled?: boolean
    autoAfterImport?: boolean
    archiveTemplateDir?: string
    galleryDlPath?: string
    cookieBrowser?: string
    downloadXVideo?: boolean
    downloadPdf?: boolean
    sourceResolverEnabled?: boolean
    archiveRoot?: string
  } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Array<{ key: string; value: string }> = []
  let clearVault = false
  const set = (key: string, value: string) => updates.push({ key, value })
  const keyValues = [
    ['anthropicApiKey', body.anthropicApiKey], ['openaiApiKey', body.openaiApiKey], ['minimaxApiKey', body.minimaxApiKey],
  ] as const
  for (const [key, value] of keyValues) {
    if (value === undefined) continue
    if (typeof value !== 'string' || !value.trim()) return NextResponse.json({ error: `Invalid ${key} value` }, { status: 400 })
    set(key, value.trim())
  }

  if (body.provider !== undefined) {
    if (body.provider !== 'anthropic' && body.provider !== 'openai' && body.provider !== 'minimax') return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
    set('aiProvider', body.provider)
  }
  const models = [
    ['anthropicModel', body.anthropicModel, ALLOWED_ANTHROPIC_MODELS, 'Invalid Anthropic model'],
    ['openaiModel', body.openaiModel, ALLOWED_OPENAI_MODELS, 'Invalid OpenAI model'],
    ['minimaxModel', body.minimaxModel, ALLOWED_MINIMAX_MODELS, 'Invalid MiniMax model'],
  ] as const
  for (const [key, value, allowed, error] of models) {
    if (value === undefined) continue
    if (!(allowed as readonly string[]).includes(value)) return NextResponse.json({ error }, { status: 400 })
    set(key, value)
  }

  for (const [key, value] of [['x_oauth_client_id', body.xOAuthClientId], ['x_oauth_client_secret', body.xOAuthClientSecret]] as const) {
    if (value === undefined) continue
    if (typeof value !== 'string') return NextResponse.json({ error: `Invalid ${key} value` }, { status: 400 })
    if (value.trim()) set(key, value.trim())
  }

  if (body.obsidianVaultPath !== undefined) {
    if (typeof body.obsidianVaultPath !== 'string') return NextResponse.json({ error: 'Invalid obsidianVaultPath value' }, { status: 400 })
    const vaultPath = body.obsidianVaultPath.trim()
    if (!vaultPath) clearVault = true
    else {
      const validation = await validateVaultPath(vaultPath)
      if (!validation.valid) return NextResponse.json({ error: `Invalid vault path: ${validation.error}` }, { status: 400 })
      set('obsidianVaultPath', vaultPath)
    }
  }

  const booleanArchiveKeys = ['archiveEnabled', 'autoAfterImport', 'downloadXVideo', 'downloadPdf', 'sourceResolverEnabled'] as const
  for (const key of booleanArchiveKeys) {
    const value = body[key]
    if (value === undefined) continue
    if (typeof value !== 'boolean') return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 })
    set(key, String(value))
  }
  for (const key of ['archiveTemplateDir', 'galleryDlPath', 'cookieBrowser', 'archiveRoot'] as const) {
    const value = body[key]
    if (value === undefined) continue
    if (typeof value !== 'string') return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 })
    const normalized = value.trim()
    try {
      if (key === 'archiveRoot') safeRelativePath(normalized)
      if (key === 'galleryDlPath') validateGallerySettings(normalized || undefined, undefined)
      if (key === 'cookieBrowser') validateGallerySettings(undefined, normalized || undefined)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : `Invalid ${key}` }, { status: 400 })
    }
    set(key, normalized)
  }

  if (!updates.length && !clearVault) return NextResponse.json({ error: 'No setting provided' }, { status: 400 })
  try {
    await prisma.$transaction(async (tx) => {
      if (clearVault) await tx.setting.deleteMany({ where: { key: 'obsidianVaultPath' } })
      for (const { key, value } of updates) await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
    })
    invalidateSettingsCache()
    return NextResponse.json({ saved: true })
  } catch (error) {
    console.error('Settings POST error:', error)
    return NextResponse.json({ error: `Failed to save: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  let body: { key?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const allowed = ['anthropicApiKey', 'openaiApiKey', 'minimaxApiKey', 'x_oauth_client_id', 'x_oauth_client_secret']
  if (!body.key || !allowed.includes(body.key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }

  await prisma.setting.deleteMany({ where: { key: body.key } })
  invalidateSettingsCache()
  return NextResponse.json({ deleted: true })
}
