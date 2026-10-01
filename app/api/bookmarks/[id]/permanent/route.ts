import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const id = (await params).id.trim()
  if (!id) return NextResponse.json({ error: 'Bookmark ID is required' }, { status: 400 })

  try {
    // Keep the trash predicate on the destructive statement so a concurrent
    // restore cannot turn this into an active-bookmark deletion.
    const result = await prisma.bookmark.deleteMany({ where: { id, deletedAt: { not: null } } })
    if (result.count === 0) return NextResponse.json({ error: 'Trashed bookmark not found' }, { status: 404 })
    return NextResponse.json({ deleted: true, id })
  } catch {
    return NextResponse.json({ error: 'Failed to permanently delete bookmark' }, { status: 500 })
  }
}
