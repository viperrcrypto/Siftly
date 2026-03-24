import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET() {
  try {
    const [clientId, accessToken, expiresAt, userSetting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_access_token' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_expires_at' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_user' } }),
    ])

    const resolvedClientId = clientId?.value || process.env.X_OAUTH_CLIENT_ID || ''
    const configured = resolvedClientId.length > 0
    const connected = !!accessToken?.value

    let tokenExpired = false
    if (expiresAt?.value) {
      tokenExpired = Date.now() > Number(expiresAt.value)
    }

    let user = null
    if (userSetting?.value) {
      try { user = JSON.parse(userSetting.value) } catch {}
    }

    return NextResponse.json({ configured, connected, tokenExpired, user })
  } catch (err) {
    console.error('X OAuth status error:', err)
    return NextResponse.json({ configured: false, connected: false }, { status: 500 })
  }
}
