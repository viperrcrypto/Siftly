import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import prisma from '@/lib/db'
import { createCliAnthropicClient, createEnvCliAnthropicClient, getCliAuthStatus } from '@/lib/claude-cli-auth'

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { provider?: string } = {}
  try {
    const text = await request.text()
    if (text.trim()) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const provider = body.provider ?? 'anthropic'

  if (provider === 'anthropic') {
    const setting = await prisma.setting.findUnique({ where: { key: 'anthropicApiKey' } })
    const apiKey = setting?.value?.trim() || process.env.ANTHROPIC_API_KEY || ''
    const baseURL = process.env.ANTHROPIC_BASE_URL

    let client: Anthropic
    if (apiKey) {
      client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })
    } else {
      const cliClient = createCliAnthropicClient(baseURL)
      const envCliClient = createEnvCliAnthropicClient(baseURL)
      if (cliClient) {
        client = cliClient
      } else if (envCliClient) {
        client = envCliClient
      } else {
        const cliStatus = getCliAuthStatus()
        if (cliStatus.available && cliStatus.expired) {
          return NextResponse.json({ working: false, error: 'Claude CLI session expired — run `claude` to refresh' })
        }
        return NextResponse.json({ working: false, error: 'No API key found. Add one in Settings or log in with Claude CLI.' })
      }
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

  return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
}
