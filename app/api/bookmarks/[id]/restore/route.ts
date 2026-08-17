import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const id = (await params).id.trim()
  if (!id) return NextResponse.json({ error: 'Bookmark ID is required' }, { status: 400 })

  try {
    const result = await prisma.bookmark.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null },
    })
    if (result.count === 0) return NextResponse.json({ error: 'Trashed bookmark not found' }, { status: 404 })
    return NextResponse.json({ restored: true, id })
  } catch {
    return NextResponse.json({ error: 'Failed to restore bookmark' }, { status: 500 })
  }
}
