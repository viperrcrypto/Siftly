import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/app/generated/prisma/client'
import prisma from '@/lib/db'

// PATCH: Update mutable fields on a bookmark (triageState)
const TRIAGE_STATES = ['inbox', 'kept', 'deleted'] as const

// DELETE: Permanently remove a bookmark (media items + category links cascade)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  try {
    await prisma.bookmark.delete({ where: { id } })
    return NextResponse.json({ id, deleted: true })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Bookmark not found' }, { status: 404 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete bookmark' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  let body: { triageState?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const data: { triageState?: string } = {}

  if (body.triageState !== undefined) {
    if (typeof body.triageState !== 'string' || !TRIAGE_STATES.includes(body.triageState as typeof TRIAGE_STATES[number])) {
      return NextResponse.json(
        { error: `Field "triageState" must be one of: ${TRIAGE_STATES.join(', ')}` },
        { status: 400 }
      )
    }
    data.triageState = body.triageState
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  try {
    await prisma.bookmark.update({
      where: { id },
      data,
    })
    return NextResponse.json({ id, ...data })
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
