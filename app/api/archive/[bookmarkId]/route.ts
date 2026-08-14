import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { enqueueArchive, ensureArchiveRecord, runArchive } from '@/lib/archive/pipeline'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ bookmarkId: string }> }) {
  const { bookmarkId } = await params
  const archive = await prisma.archiveRecord.findUnique({ where: { bookmarkId } })
  if (!archive) return NextResponse.json({ error: 'Archive not found' }, { status: 404 })
  return NextResponse.json({ ...archive, result: (() => { try { return JSON.parse(archive.resultJson) } catch { return {} } })() })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ bookmarkId: string }> }) {
  const { bookmarkId } = await params
  const bookmark = await prisma.bookmark.findUnique({ where: { id: bookmarkId }, select: { id: true } })
  if (!bookmark) return NextResponse.json({ error: 'Bookmark not found' }, { status: 404 })
  const body = await request.json().catch(() => ({})) as { background?: boolean }
  if (body.background) {
    await ensureArchiveRecord(bookmarkId)
    if (!enqueueArchive(bookmarkId)) return NextResponse.json({ queued: false, error: 'Archive queue is full' }, { status: 503 })
    return NextResponse.json({ queued: true }, { status: 202 })
  }
  try { return NextResponse.json(await runArchive(bookmarkId)) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }) }
}
