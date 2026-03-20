import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import crypto from 'crypto'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'
const CALLBACK_URL = `${APP_URL}/api/import/x-oauth/callback`
const SCOPES = 'bookmark.read tweet.read users.read offline.access'

export async function GET() {
  try {
    const clientId = await prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } })
    if (!clientId?.value) {
      return NextResponse.json({ error: 'X OAuth Client ID not configured in Settings' }, { status: 400 })
    }

    const codeVerifier = base64url(crypto.randomBytes(32))
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest())
    const state = base64url(crypto.randomBytes(16))

    // Store PKCE verifier keyed by state (cleaned up after callback)
    await prisma.setting.upsert({
      where: { key: `x_oauth_pkce_${state}` },
      update: { value: codeVerifier },
      create: { key: `x_oauth_pkce_${state}`, value: codeVerifier },
    })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId.value,
      redirect_uri: CALLBACK_URL,
      scope: SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    return NextResponse.json({ authUrl: `https://twitter.com/i/oauth2/authorize?${params}` })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to build auth URL' },
      { status: 500 },
    )
  }
}
