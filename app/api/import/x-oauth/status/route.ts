import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET() {
  const clientId = await prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } })
  const accessToken = await prisma.setting.findUnique({ where: { key: 'x_oauth_access_token' } })
  const tokenExpiry = await prisma.setting.findUnique({ where: { key: 'x_oauth_token_expiry' } })
  const userName = await prisma.setting.findUnique({ where: { key: 'x_oauth_user_name' } })
  const userUsername = await prisma.setting.findUnique({ where: { key: 'x_oauth_user_username' } })
  const userId = await prisma.setting.findUnique({ where: { key: 'x_oauth_user_id' } })

  const configured = !!clientId?.value
  const connected = !!accessToken?.value
  const tokenExpired = tokenExpiry?.value
    ? Date.now() > Number(tokenExpiry.value)
    : false

  return NextResponse.json({
    configured,
    connected: connected && !tokenExpired,
    tokenExpired: connected && tokenExpired,
    user: connected
      ? { id: userId?.value, name: userName?.value, username: userUsername?.value }
      : null,
  })
}
