import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params

  try {
    const bookmark = await prisma.bookmark.findUnique({
      where: { id },
      select: {
        id: true,
        deletedAt: true,
      },
    })

    if (!bookmark) {
      return NextResponse.json({ error: `Bookmark not found: ${id}` }, { status: 404 })
    }

    if (bookmark.deletedAt) {
      return NextResponse.json({ deleted: true, id: bookmark.id })
    }

    await prisma.bookmark.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ deleted: true, id })
  } catch (err) {
    console.error(`Bookmark [${id}] delete error:`, err)
    return NextResponse.json(
      { error: `Failed to delete bookmark: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
