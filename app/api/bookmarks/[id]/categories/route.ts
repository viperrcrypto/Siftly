import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

const MANUAL_CONFIDENCE = 0.8

// PUT: Replace all categories for a bookmark and record only manual differences.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const isPlainObject = typeof body === 'object' && body !== null && !Array.isArray(body)
    && (Object.getPrototypeOf(body) === Object.prototype || Object.getPrototypeOf(body) === null)
  if (!isPlainObject || !Object.prototype.hasOwnProperty.call(body, 'categoryIds')) {
    return NextResponse.json({ error: 'categoryIds must be provided as an array of category IDs' }, { status: 400 })
  }
  const categoryIds = (body as { categoryIds: unknown }).categoryIds
  if (!Array.isArray(categoryIds) || categoryIds.some((categoryId) => typeof categoryId !== 'string' || !categoryId.trim())) {
    return NextResponse.json({ error: 'categoryIds must be an array of category IDs' }, { status: 400 })
  }
  const uniqueCategoryIds = [...new Set(categoryIds)]

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [bookmark, categories, existingLinks, feedback] = await Promise.all([
        tx.bookmark.findUnique({ where: { id }, select: { id: true, deletedAt: true } }),
        tx.category.findMany({ where: { id: { in: uniqueCategoryIds } }, select: { id: true } }),
        tx.bookmarkCategory.findMany({ where: { bookmarkId: id }, select: { categoryId: true } }),
        tx.categoryFeedback.findMany({ where: { bookmarkId: id }, select: { categoryId: true, action: true } }),
      ])
      if (!bookmark || bookmark.deletedAt) return { error: 'Bookmark not found', status: 404 }
      if (categories.length !== uniqueCategoryIds.length) return { error: 'One or more categories were not found', status: 400 }

      const currentIds = new Set(existingLinks.map((link) => link.categoryId))
      const targetIds = new Set(uniqueCategoryIds)
      const addedIds = uniqueCategoryIds.filter((categoryId) => !currentIds.has(categoryId))
      const removedIds = [...currentIds].filter((categoryId) => !targetIds.has(categoryId))

      await Promise.all([
        ...addedIds.map((categoryId) => tx.categoryFeedback.upsert({
          where: { bookmarkId_categoryId: { bookmarkId: id, categoryId } },
          update: { action: 'include' },
          create: { bookmarkId: id, categoryId, action: 'include' },
        })),
        ...removedIds.map((categoryId) => tx.categoryFeedback.upsert({
          where: { bookmarkId_categoryId: { bookmarkId: id, categoryId } },
          update: { action: 'exclude' },
          create: { bookmarkId: id, categoryId, action: 'exclude' },
        })),
        ...addedIds.map((categoryId) => tx.bookmarkCategory.create({
          data: { bookmarkId: id, categoryId, confidence: MANUAL_CONFIDENCE },
        })),
        ...removedIds.map((categoryId) => tx.bookmarkCategory.delete({
          where: { bookmarkId_categoryId: { bookmarkId: id, categoryId } },
        })),
      ])

      const actions = new Map(feedback.map((item) => [item.categoryId, item.action]))
      addedIds.forEach((categoryId) => actions.set(categoryId, 'include'))
      removedIds.forEach((categoryId) => actions.set(categoryId, 'exclude'))
      const manualCategoryIds = [...actions].filter(([, action]) => action === 'include').map(([categoryId]) => categoryId)
      return { manualCategoryIds, hasCategoryFeedback: actions.size > 0 }
    })
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update categories' },
      { status: 500 }
    )
  }
}

// DELETE: Remove this bookmark's manual corrections and any category links created by includes.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bookmark = await tx.bookmark.findUnique({ where: { id }, select: { id: true, deletedAt: true } })
      if (!bookmark || bookmark.deletedAt) return { error: 'Bookmark not found', status: 404 }

      const feedback = await tx.categoryFeedback.findMany({
        where: { bookmarkId: id },
        select: { categoryId: true, action: true },
      })
      const removedCategoryIds = feedback.filter((item) => item.action === 'include').map((item) => item.categoryId)
      if (removedCategoryIds.length > 0) {
        await tx.bookmarkCategory.deleteMany({
          where: { bookmarkId: id, categoryId: { in: removedCategoryIds } },
        })
      }
      await tx.categoryFeedback.deleteMany({ where: { bookmarkId: id } })
      return { removedCategoryIds }
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to reset category feedback' },
      { status: 500 }
    )
  }
}
