import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const id = (await params).id.trim()
  if (!id) return NextResponse.json({ error: 'Bookmark ID is required' }, { status: 400 })

  try {
    await prisma.bookmark.update({ where: { id }, data: { deletedAt: new Date() } })
    return NextResponse.json({ trashed: true, id })
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025') {
      return NextResponse.json({ error: 'Bookmark not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to move bookmark to trash' }, { status: 500 })
  }
}
