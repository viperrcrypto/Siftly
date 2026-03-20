import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'
const CALLBACK_URL = `${APP_URL}/api/import/x-oauth/callback`
const IMPORT_URL = `${APP_URL}/import`

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(`${IMPORT_URL}?x_error=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${IMPORT_URL}?x_error=missing_params`)
  }

  try {
    // Retrieve and clean up PKCE verifier
    const verifierKey = `x_oauth_pkce_${state}`
    const verifierSetting = await prisma.setting.findUnique({ where: { key: verifierKey } })
    if (!verifierSetting?.value) {
      return NextResponse.redirect(`${IMPORT_URL}?x_error=invalid_state`)
    }
    const codeVerifier = verifierSetting.value
    await prisma.setting.delete({ where: { key: verifierKey } }).catch(() => {})

    const [clientIdSetting, clientSecretSetting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_secret' } }),
    ])
    if (!clientIdSetting?.value) {
      return NextResponse.redirect(`${IMPORT_URL}?x_error=client_id_missing`)
    }

    // Exchange auth code for tokens
    const tokenBody = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: clientIdSetting.value,
      redirect_uri: CALLBACK_URL,
      code_verifier: codeVerifier,
    })

    // Confidential clients send Basic auth; public clients omit it
    const authHeader = clientSecretSetting?.value
      ? 'Basic ' + Buffer.from(`${clientIdSetting.value}:${clientSecretSetting.value}`).toString('base64')
      : undefined

    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: tokenBody,
    })

    const tokenData = await tokenRes.json()
    if (!tokenRes.ok || !tokenData.access_token) {
      const msg = tokenData.error_description ?? tokenData.error ?? 'token_exchange_failed'
      return NextResponse.redirect(`${IMPORT_URL}?x_error=${encodeURIComponent(msg)}`)
    }

    // Fetch authenticated user
    const userRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const userData = await userRes.json()
    const user = userData?.data

    const expiresAt = tokenData.expires_in
      ? String(Date.now() + tokenData.expires_in * 1000)
      : String(Date.now() + 7200 * 1000)

    await Promise.all([
      prisma.setting.upsert({ where: { key: 'x_oauth_access_token' }, update: { value: tokenData.access_token }, create: { key: 'x_oauth_access_token', value: tokenData.access_token } }),
      prisma.setting.upsert({ where: { key: 'x_oauth_token_expires_at' }, update: { value: expiresAt }, create: { key: 'x_oauth_token_expires_at', value: expiresAt } }),
      tokenData.refresh_token && prisma.setting.upsert({ where: { key: 'x_oauth_refresh_token' }, update: { value: tokenData.refresh_token }, create: { key: 'x_oauth_refresh_token', value: tokenData.refresh_token } }),
      user?.id && prisma.setting.upsert({ where: { key: 'x_oauth_user_id' }, update: { value: user.id }, create: { key: 'x_oauth_user_id', value: user.id } }),
      user?.username && prisma.setting.upsert({ where: { key: 'x_oauth_username' }, update: { value: user.username }, create: { key: 'x_oauth_username', value: user.username } }),
    ].filter(Boolean))

    return NextResponse.redirect(`${IMPORT_URL}?x_connected=true`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'callback_error'
    return NextResponse.redirect(`${IMPORT_URL}?x_error=${encodeURIComponent(msg)}`)
  }
}
