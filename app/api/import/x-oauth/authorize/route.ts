import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const clientId = await prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } })
  if (!clientId?.value) {
    return NextResponse.json({ error: 'X OAuth Client ID not configured' }, { status: 400 })
  }

  // Generate PKCE code verifier & challenge
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  const state = crypto.randomBytes(16).toString('hex')

  // Store verifier + state for the callback
  await prisma.setting.upsert({ where: { key: 'x_oauth_code_verifier' }, create: { key: 'x_oauth_code_verifier', value: codeVerifier }, update: { value: codeVerifier } })
  await prisma.setting.upsert({ where: { key: 'x_oauth_state' }, create: { key: 'x_oauth_state', value: state }, update: { value: state } })

  // Store the origin so the callback can use it too
  const origin = `${req.nextUrl.protocol}//${req.nextUrl.host}`
  await prisma.setting.upsert({ where: { key: 'x_oauth_redirect_origin' }, create: { key: 'x_oauth_redirect_origin', value: origin }, update: { value: origin } })
  const redirectUri = `${origin}/api/import/x-oauth/callback`

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId.value,
    redirect_uri: redirectUri,
    scope: 'bookmark.read tweet.read users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  return NextResponse.json({ authUrl: `https://x.com/i/oauth2/authorize?${params}` })
}
