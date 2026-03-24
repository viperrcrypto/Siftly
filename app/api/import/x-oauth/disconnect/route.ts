import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function POST() {
  try {
    // Optionally revoke the token with X
    const accessToken = await prisma.setting.findUnique({ where: { key: 'x_oauth_access_token' } })
    if (accessToken?.value) {
      const dbClientId = await prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } })
      const clientId = dbClientId?.value || process.env.X_OAUTH_CLIENT_ID || ''

      if (clientId) {
        try {
          await fetch('https://api.x.com/2/oauth2/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: accessToken.value, client_id: clientId }),
          })
        } catch {
          // Non-fatal — still clear local tokens
        }
      }
    }

    // Clear all OAuth tokens from DB
    await prisma.setting.deleteMany({
      where: {
        key: {
          in: [
            'x_oauth_access_token',
            'x_oauth_refresh_token',
            'x_oauth_token_type',
            'x_oauth_expires_at',
            'x_oauth_user',
          ],
        },
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('X OAuth disconnect error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to disconnect' },
      { status: 500 },
    )
  }
}
