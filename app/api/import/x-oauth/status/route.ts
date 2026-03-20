import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET() {
  try {
    const [clientId, accessToken, userId, username, expiresAt] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_access_token' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_user_id' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_username' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_token_expires_at' } }),
    ])

    const configured = !!clientId?.value
    const connected = !!(accessToken?.value && userId?.value)
    const tokenExpired = expiresAt?.value ? Date.now() > parseInt(expiresAt.value) : false

    return NextResponse.json({
      configured,
      connected,
      tokenExpired: connected ? tokenExpired : undefined,
      user: connected ? { id: userId?.value, username: username?.value } : null,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    )
  }
}
