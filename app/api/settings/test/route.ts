import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { resolveAnthropicClient, getCliAuthStatus } from '@/lib/claude-cli-auth'
import { resolveOpenAIClient } from '@/lib/openai-auth'
import { complete, getModel, type Model } from '@mariozechner/pi-ai'

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    provider?: string
    message?: string
    piAiApiKey?: string
    piAiProvider?: string
    piAiModel?: string
    piAiBaseUrl?: string
    piAiHeaders?: string
    piAiCompat?: string
  } = {}
  try {
    const text = await request.text()
    if (text.trim()) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const provider = body.provider ?? 'anthropic'
  const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : 'hi'

  if (provider === 'pi-ai') {
    const [piAiKey, piAiProvider, piAiModel, piAiBaseUrl, piAiHeaders, piAiCompat] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'piAiApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'piAiProvider' } }),
      prisma.setting.findUnique({ where: { key: 'piAiModel' } }),
      prisma.setting.findUnique({ where: { key: 'piAiBaseUrl' } }),
      prisma.setting.findUnique({ where: { key: 'piAiHeaders' } }),
      prisma.setting.findUnique({ where: { key: 'piAiCompat' } }),
    ])

    const providerId = (
      (typeof body.piAiProvider === 'string' && body.piAiProvider.trim() ? body.piAiProvider : piAiProvider?.value ?? 'openai')
    ).trim()
    const modelId = (
      (typeof body.piAiModel === 'string' && body.piAiModel.trim() ? body.piAiModel : piAiModel?.value ?? 'gpt-4o-mini')
    ).trim()
    const baseUrlRaw =
      typeof body.piAiBaseUrl === 'string' && body.piAiBaseUrl.trim()
        ? body.piAiBaseUrl
        : (piAiBaseUrl?.value ?? '')
    const baseUrl = baseUrlRaw.trim() || null

    const safeJsonParseObject = (raw: string | null | undefined): Record<string, unknown> | null => {
      if (!raw?.trim()) return null
      try {
        const parsed = JSON.parse(raw) as unknown
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
        return null
      } catch {
        return null
      }
    }

    const headers = safeJsonParseObject(
      typeof body.piAiHeaders === 'string' ? body.piAiHeaders : piAiHeaders?.value ?? null,
    ) as Record<string, string> | null
    const compat = safeJsonParseObject(
      typeof body.piAiCompat === 'string' ? body.piAiCompat : piAiCompat?.value ?? null,
    )

    let model: Model<any>
    if (!baseUrl && !headers && !compat) {
      model = getModel(providerId as any, modelId as any) as any
    } else {
      model = {
        id: modelId,
        name: modelId,
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: baseUrl || undefined,
        reasoning: false,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
        ...(headers ? { headers } : {}),
        ...(compat ? { compat: compat as any } : {}),
      } as any
    }

    const apiKeyRaw =
      typeof body.piAiApiKey === 'string' && body.piAiApiKey.trim()
        ? body.piAiApiKey
        : (piAiKey?.value ?? '')
    const apiKey = apiKeyRaw.trim() || null
    if (!apiKey && !baseUrl) {
      return NextResponse.json(
        { working: false, error: 'No pi-ai API key found and no Base URL configured.' },
        { status: 400 },
      )
    }

    const effectiveApiKey = apiKey || (baseUrl ? 'local' : null)

    try {
      const response = await complete(
        model,
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: message }] }],
        } as any,
        {
          apiKey: effectiveApiKey || undefined,
          maxTokens: 5,
        } as any,
      )

      const hasAnyText = Array.isArray((response as any).content)
        ? (response as any).content.some((b: any) => b?.type === 'text' && typeof b.text === 'string')
        : false

      if (!hasAnyText) {
        return NextResponse.json({ working: false, error: 'No text content returned from model.' })
      }

      return NextResponse.json({ working: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const friendly = msg.includes('401') || msg.includes('invalid_api_key')
        ? 'Invalid API key'
        : msg.includes('403')
        ? 'Key does not have permission'
        : msg.slice(0, 120)
      return NextResponse.json({ working: false, error: friendly })
    }
  }

  if (provider === 'anthropic') {
    const setting = await prisma.setting.findUnique({ where: { key: 'anthropicApiKey' } })
    const dbKey = setting?.value?.trim()

    let client
    try {
      client = resolveAnthropicClient({ dbKey })
    } catch {
      const cliStatus = getCliAuthStatus()
      if (cliStatus.available && cliStatus.expired) {
        return NextResponse.json({ working: false, error: 'Claude CLI session expired — run `claude` to refresh' })
      }
      return NextResponse.json({ working: false, error: 'No API key found. Add one in Settings or log in with Claude CLI.' })
    }

    try {
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      })
      return NextResponse.json({ working: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const friendly = msg.includes('401') || msg.includes('invalid_api_key')
        ? 'Invalid API key'
        : msg.includes('403')
        ? 'Key does not have permission'
        : msg.slice(0, 120)
      return NextResponse.json({ working: false, error: friendly })
    }
  }

  if (provider === 'openai') {
    const setting = await prisma.setting.findUnique({ where: { key: 'openaiApiKey' } })
    const dbKey = setting?.value?.trim()

    let client
    try {
      client = resolveOpenAIClient({ dbKey })
    } catch {
      return NextResponse.json({ working: false, error: 'No OpenAI API key found. Add one in Settings or set up Codex CLI.' })
    }

    try {
      await client.chat.completions.create({
        model: 'gpt-4.1-mini',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      })
      return NextResponse.json({ working: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const friendly = msg.includes('401') || msg.includes('invalid_api_key')
        ? 'Invalid API key'
        : msg.includes('403')
        ? 'Key does not have permission'
        : msg.slice(0, 120)
      return NextResponse.json({ working: false, error: friendly })
    }
  }

  return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
}
