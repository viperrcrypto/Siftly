import { NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import prisma from '@/lib/db'

export async function GET() {
  try {
    // Resolve client ID from DB or env
    const dbClientId = await prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } })
    const clientId = dbClientId?.value || process.env.X_OAUTH_CLIENT_ID || ''

    if (!clientId) {
      return NextResponse.json({ error: 'X OAuth Client ID not configured' }, { status: 400 })
    }

    // Generate PKCE code verifier + challenge
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    // Generate state for CSRF protection
    const state = randomBytes(16).toString('hex')

    // Store verifier + state in DB so callback can use them
    await Promise.all([
      prisma.setting.upsert({
        where: { key: 'x_oauth_code_verifier' },
        update: { value: codeVerifier },
        create: { key: 'x_oauth_code_verifier', value: codeVerifier },
      }),
      prisma.setting.upsert({
        where: { key: 'x_oauth_state' },
        update: { value: state },
        create: { key: 'x_oauth_state', value: state },
      }),
    ])

    const redirectUri = `${process.env.X_OAUTH_REDIRECT_BASE || 'http://127.0.0.1:3000'}/api/import/x-oauth/callback`
    const scopes = 'bookmark.read tweet.read users.read offline.access'

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    const authUrl = `https://x.com/i/oauth2/authorize?${params.toString()}`

    return NextResponse.json({ authUrl })
  } catch (err) {
    console.error('X OAuth authorize error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start OAuth' },
      { status: 500 },
    )
  }
}
