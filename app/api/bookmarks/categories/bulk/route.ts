import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

const MANUAL_CONFIDENCE = 0.8

function ids(value: unknown, name: string, maximum: number): { value?: string[]; error?: string } {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== 'string' || !id.trim())) {
    return { error: `${name} must be a non-empty array of IDs` }
  }
  const unique = [...new Set(value.map((id) => id.trim()))]
  return unique.length > maximum ? { error: `${name} must contain at most ${maximum} IDs` } : { value: unique }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const { bookmarkIds, categoryIds } = body as { bookmarkIds?: unknown; categoryIds?: unknown }
  const bookmarks = ids(bookmarkIds, 'bookmarkIds', 500)
  const categories = ids(categoryIds, 'categoryIds', 20)
  if (bookmarks.error || categories.error) return NextResponse.json({ error: bookmarks.error ?? categories.error }, { status: 400 })
  const selectedBookmarks = bookmarks.value!
  const selectedCategories = categories.value!
  if (selectedBookmarks.length * selectedCategories.length > 5000) {
    return NextResponse.json({ error: 'bookmark/category combinations must not exceed 5000' }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [foundBookmarks, foundCategories] = await Promise.all([
        tx.bookmark.findMany({ where: { id: { in: selectedBookmarks }, deletedAt: null }, select: { id: true } }),
        tx.category.findMany({ where: { id: { in: selectedCategories } }, select: { id: true } }),
      ])
      if (foundBookmarks.length !== selectedBookmarks.length) return { error: 'One or more bookmarks were not found', status: 404 }
      if (foundCategories.length !== selectedCategories.length) return { error: 'One or more categories were not found', status: 404 }

      const existing = await tx.bookmarkCategory.findMany({
        where: { bookmarkId: { in: selectedBookmarks }, categoryId: { in: selectedCategories } },
        select: { bookmarkId: true, categoryId: true },
      })
      const existingPairs = new Set(existing.map((link) => `${link.bookmarkId}\u0000${link.categoryId}`))
      const missing = selectedBookmarks.flatMap((bookmarkId) => selectedCategories
        .filter((categoryId) => !existingPairs.has(`${bookmarkId}\u0000${categoryId}`))
        .map((categoryId) => ({ bookmarkId, categoryId })))

      await Promise.all(missing.flatMap(({ bookmarkId, categoryId }) => [
        tx.bookmarkCategory.create({ data: { bookmarkId, categoryId, confidence: MANUAL_CONFIDENCE } }),
        tx.categoryFeedback.upsert({
          where: { bookmarkId_categoryId: { bookmarkId, categoryId } },
          update: { action: 'include' },
          create: { bookmarkId, categoryId, action: 'include' },
        }),
      ]))
      return { bookmarkCount: selectedBookmarks.length, categoryCount: selectedCategories.length, addedPairs: missing.length }
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to add categories' }, { status: 500 })
  }
}
