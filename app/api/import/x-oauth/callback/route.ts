import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const redirectBase = '/import'

  if (error) {
    return NextResponse.redirect(new URL(`${redirectBase}?x_error=${encodeURIComponent(error)}`, request.url))
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL(`${redirectBase}?x_error=missing_params`, request.url))
  }

  try {
    // Verify state
    const savedState = await prisma.setting.findUnique({ where: { key: 'x_oauth_state' } })
    if (!savedState?.value || savedState.value !== state) {
      return NextResponse.redirect(new URL(`${redirectBase}?x_error=invalid_state`, request.url))
    }

    // Get stored code verifier
    const verifierSetting = await prisma.setting.findUnique({ where: { key: 'x_oauth_code_verifier' } })
    if (!verifierSetting?.value) {
      return NextResponse.redirect(new URL(`${redirectBase}?x_error=missing_verifier`, request.url))
    }

    // Resolve client credentials
    const [dbClientId, dbClientSecret] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_secret' } }),
    ])
    const clientId = dbClientId?.value || process.env.X_OAUTH_CLIENT_ID || ''
    const clientSecret = dbClientSecret?.value || process.env.X_OAUTH_CLIENT_SECRET || ''

    const redirectUri = `${process.env.X_OAUTH_REDIRECT_BASE || 'http://127.0.0.1:3000'}/api/import/x-oauth/callback`

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifierSetting.value,
      client_id: clientId,
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    // Use Basic auth if client secret is available (confidential client)
    if (clientSecret) {
      headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    }

    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers,
      body: tokenBody.toString(),
    })

    const tokenData = await tokenRes.json()

    if (!tokenRes.ok) {
      console.error('X token exchange error:', tokenData)
      return NextResponse.redirect(
        new URL(`${redirectBase}?x_error=${encodeURIComponent(tokenData.error_description || tokenData.error || 'token_exchange_failed')}`, request.url),
      )
    }

    // Fetch user info
    let user: { id?: string; name?: string; username?: string } | null = null
    try {
      const userRes = await fetch('https://api.x.com/2/users/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      if (userRes.ok) {
        const userData = await userRes.json()
        user = userData.data ?? null
      }
    } catch {
      // Non-fatal — we can still store the tokens
    }

    // Store tokens in DB
    const toStore = [
      { key: 'x_oauth_access_token', value: tokenData.access_token },
      { key: 'x_oauth_token_type', value: tokenData.token_type ?? 'bearer' },
      ...(tokenData.refresh_token ? [{ key: 'x_oauth_refresh_token', value: tokenData.refresh_token }] : []),
      ...(tokenData.expires_in ? [{ key: 'x_oauth_expires_at', value: String(Date.now() + tokenData.expires_in * 1000) }] : []),
      ...(user ? [{ key: 'x_oauth_user', value: JSON.stringify(user) }] : []),
    ]

    await Promise.all(
      toStore.map(({ key, value }) =>
        prisma.setting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        }),
      ),
    )

    // Clean up verifier + state
    await Promise.all([
      prisma.setting.deleteMany({ where: { key: 'x_oauth_code_verifier' } }),
      prisma.setting.deleteMany({ where: { key: 'x_oauth_state' } }),
    ])

    return NextResponse.redirect(new URL(`${redirectBase}?x_connected=true`, request.url))
  } catch (err) {
    console.error('X OAuth callback error:', err)
    return NextResponse.redirect(
      new URL(`${redirectBase}?x_error=${encodeURIComponent(err instanceof Error ? err.message : 'callback_failed')}`, request.url),
    )
  }
}
