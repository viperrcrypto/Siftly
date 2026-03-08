import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { startCleanup, stopCleanup, getCleanupStatus, isCleanupRunning } from '@/lib/x-cleanup'
import type { CleanupSource } from '@/lib/types'

const VALID_SOURCES: CleanupSource[] = ['bookmark', 'like', 'all']

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getCleanupStatus())
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isCleanupRunning()) {
    return NextResponse.json({ error: 'Cleanup already in progress' }, { status: 409 })
  }

  try {
    const body = await request.json()
    const source: CleanupSource = VALID_SOURCES.includes(body.source) ? body.source : 'all'

    const [authSetting, ct0Setting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'x_auth_token' } }),
      prisma.setting.findUnique({ where: { key: 'x_ct0' } }),
    ])

    if (!authSetting?.value || !ct0Setting?.value) {
      return NextResponse.json(
        { error: 'X credentials not configured. Save them in Import > Live Import first.' },
        { status: 400 },
      )
    }

    // Safety check: ensure items are actually imported in Siftly before allowing removal from X
    const sourceFilter = source !== 'all' ? { source } : {}
    const totalImported = await prisma.bookmark.count({ where: sourceFilter })

    if (totalImported === 0) {
      return NextResponse.json(
        { error: 'No imported items found in Siftly. Import your bookmarks or likes first before cleaning up from X.' },
        { status: 400 },
      )
    }

    const where: Record<string, unknown> = { cleanedFromX: null, ...sourceFilter }
    const total = await prisma.bookmark.count({ where })

    if (total === 0) {
      return NextResponse.json({ error: 'All items have already been cleaned from X' }, { status: 400 })
    }

    // Require explicit confirmation
    if (!body.confirmed) {
      return NextResponse.json({
        requiresConfirmation: true,
        total,
        message: `This will permanently remove ${total} ${source === 'all' ? 'bookmarks and likes' : source + 's'} from your X account. This cannot be undone.`,
      })
    }

    // Fire-and-forget
    void startCleanup(authSetting.value, ct0Setting.value, source).catch((err) => {
      console.error('[cleanup] Unhandled error:', err)
    })

    return NextResponse.json({ started: true, total })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

export async function DELETE(): Promise<NextResponse> {
  stopCleanup()
  return NextResponse.json({ stopped: true })
}
