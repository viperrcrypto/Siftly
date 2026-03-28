import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const savedOrigin = await prisma.setting.findUnique({ where: { key: 'x_oauth_redirect_origin' } })
  const baseUrl = savedOrigin?.value ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`
  const importPage = `${baseUrl}/import`

  if (error) {
    return NextResponse.redirect(`${importPage}?x_error=${encodeURIComponent(error)}`)
  }
  if (!code || !state) {
    return NextResponse.redirect(`${importPage}?x_error=missing_params`)
  }

  // Verify state
  const savedState = await prisma.setting.findUnique({ where: { key: 'x_oauth_state' } })
  if (savedState?.value !== state) {
    return NextResponse.redirect(`${importPage}?x_error=state_mismatch`)
  }

  const codeVerifier = await prisma.setting.findUnique({ where: { key: 'x_oauth_code_verifier' } })
  const clientId = await prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } })
  const clientSecret = await prisma.setting.findUnique({ where: { key: 'x_oauth_client_secret' } })

  if (!codeVerifier?.value || !clientId?.value) {
    return NextResponse.redirect(`${importPage}?x_error=missing_config`)
  }

  const redirectUri = `${savedOrigin?.value ?? baseUrl}/api/import/x-oauth/callback`

  // Exchange code for tokens
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier.value,
    client_id: clientId.value,
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  // If client secret is set, use Basic auth (confidential client)
  if (clientSecret?.value) {
    headers['Authorization'] = `Basic ${Buffer.from(`${clientId.value}:${clientSecret.value}`).toString('base64')}`
  }

  const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: tokenBody,
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    console.error('X OAuth token exchange failed:', err)
    return NextResponse.redirect(`${importPage}?x_error=token_exchange_failed`)
  }

  const tokens = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
  }

  // Save tokens
  const expiry = String(Date.now() + tokens.expires_in * 1000)
  await prisma.setting.upsert({ where: { key: 'x_oauth_access_token' }, create: { key: 'x_oauth_access_token', value: tokens.access_token }, update: { value: tokens.access_token } })
  await prisma.setting.upsert({ where: { key: 'x_oauth_token_expiry' }, create: { key: 'x_oauth_token_expiry', value: expiry }, update: { value: expiry } })
  if (tokens.refresh_token) {
    await prisma.setting.upsert({ where: { key: 'x_oauth_refresh_token' }, create: { key: 'x_oauth_refresh_token', value: tokens.refresh_token }, update: { value: tokens.refresh_token } })
  }

  // Fetch user info
  try {
    const userRes = await fetch('https://api.x.com/2/users/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (userRes.ok) {
      const userData = await userRes.json() as { data: { id: string; name: string; username: string } }
      await prisma.setting.upsert({ where: { key: 'x_oauth_user_id' }, create: { key: 'x_oauth_user_id', value: userData.data.id }, update: { value: userData.data.id } })
      await prisma.setting.upsert({ where: { key: 'x_oauth_user_name' }, create: { key: 'x_oauth_user_name', value: userData.data.name }, update: { value: userData.data.name } })
      await prisma.setting.upsert({ where: { key: 'x_oauth_user_username' }, create: { key: 'x_oauth_user_username', value: userData.data.username }, update: { value: userData.data.username } })
    }
  } catch {
    // Non-critical — user info is just for display
  }

  // Clean up PKCE state
  await prisma.setting.deleteMany({ where: { key: { in: ['x_oauth_code_verifier', 'x_oauth_state'] } } })

  return NextResponse.redirect(importPage)
}
