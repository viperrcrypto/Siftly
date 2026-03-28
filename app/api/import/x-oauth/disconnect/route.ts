import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function POST() {
  await prisma.setting.deleteMany({
    where: {
      key: {
        in: [
          'x_oauth_access_token',
          'x_oauth_refresh_token',
          'x_oauth_token_expiry',
          'x_oauth_user_id',
          'x_oauth_user_name',
          'x_oauth_user_username',
        ],
      },
    },
  })

  return NextResponse.json({ ok: true })
}
