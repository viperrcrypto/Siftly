import { NextRequest, NextResponse } from 'next/server'
import { softDeleteBookmarkById, type SoftDeleteBookmarkResult } from '@/lib/bookmark-delete'

interface RouteContext {
  params: Promise<{ id: string }>
}

type BookmarkDeleter = (id: string) => Promise<SoftDeleteBookmarkResult>

export async function buildDeleteBookmarkResponse(
  id: string,
  deleter: BookmarkDeleter = softDeleteBookmarkById
): Promise<NextResponse> {
  try {
    const result = await deleter(id)

    if (result.status === 'not_found') {
      return NextResponse.json({ error: `Bookmark not found: ${id}` }, { status: 404 })
    }

    return NextResponse.json({
      deleted: true,
      id: result.id,
      alreadyDeleted: result.status === 'already_deleted',
      removedCategoryLinks: result.removedCategoryLinks,
    })
  } catch (err) {
    console.error(`Bookmark [${id}] delete error:`, err)
    return NextResponse.json(
      { error: `Failed to delete bookmark: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params
  return buildDeleteBookmarkResponse(id)
}
