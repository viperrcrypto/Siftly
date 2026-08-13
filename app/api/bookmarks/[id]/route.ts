import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/app/generated/prisma/client'
import prisma from '@/lib/db'

// PATCH: Update mutable fields on a bookmark (currently: hidden)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  let body: { hidden?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.hidden !== 'boolean') {
    return NextResponse.json({ error: 'Field "hidden" must be a boolean' }, { status: 400 })
  }

  try {
    await prisma.bookmark.update({
      where: { id },
      data: { hidden: body.hidden },
    })
    return NextResponse.json({ id, hidden: body.hidden })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Bookmark not found' }, { status: 404 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update bookmark' },
      { status: 500 }
    )
  }
}
