import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

function parseIntParam(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue
  const parsed = parseInt(value, 10)
  return isNaN(parsed) || parsed < 1 ? defaultValue : parsed
}

interface RouteContext {
  params: Promise<{ slug: string }>
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { slug } = await context.params
  const { searchParams } = new URL(request.url)

  const page = parseIntParam(searchParams.get('page'), DEFAULT_PAGE)
  const limit = Math.min(parseIntParam(searchParams.get('limit'), DEFAULT_LIMIT), MAX_LIMIT)
  const skip = (page - 1) * limit

  try {
    const category = await prisma.category.findUnique({
      where: { slug },
    })

    if (!category) {
      return NextResponse.json({ error: `Category not found: ${slug}` }, { status: 404 })
    }

    const [bookmarks, total] = await Promise.all([
      prisma.bookmark.findMany({
        where: {
          deletedAt: null,
          categories: {
            some: { category: { slug } },
          },
        },
        skip,
        take: limit,
        orderBy: { importedAt: 'desc' },
        include: {
          mediaItems: true,
          categories: {
            include: {
              category: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  color: true,
                },
              },
            },
          },
        },
      }),
      prisma.bookmark.count({
        where: {
          deletedAt: null,
          categories: {
            some: { category: { slug } },
          },
        },
      }),
    ])

    const formatted = bookmarks.map((bookmark) => ({
      id: bookmark.id,
      tweetId: bookmark.tweetId,
      text: bookmark.text,
      authorHandle: bookmark.authorHandle,
      authorName: bookmark.authorName,
      tweetCreatedAt: bookmark.tweetCreatedAt?.toISOString() ?? null,
      importedAt: bookmark.importedAt.toISOString(),
      mediaItems: bookmark.mediaItems.map((m) => ({
        id: m.id,
        type: m.type,
        url: m.url,
        thumbnailUrl: m.thumbnailUrl,
      })),
      categories: bookmark.categories.map((bc) => ({
        id: bc.category.id,
        name: bc.category.name,
        slug: bc.category.slug,
        color: bc.category.color,
        confidence: bc.confidence,
      })),
    }))

    return NextResponse.json({
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
        color: category.color,
        description: category.description,
        isAiGenerated: category.isAiGenerated,
        createdAt: category.createdAt.toISOString(),
      },
      bookmarks: formatted,
      total,
      page,
      limit,
    })
  } catch (err) {
    console.error(`Category [${slug}] fetch error:`, err)
    return NextResponse.json(
      { error: `Failed to fetch category: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { slug } = await context.params

  try {
    const category = await prisma.category.findUnique({
      where: { slug },
      select: { id: true, name: true },
    })

    if (!category) {
      return NextResponse.json({ error: `Category not found: ${slug}` }, { status: 404 })
    }

    // Delete the category (BookmarkCategory records cascade via schema)
    await prisma.category.delete({
      where: { slug },
    })

    return NextResponse.json({
      deleted: true,
      slug,
      name: category.name,
    })
  } catch (err) {
    console.error(`Category [${slug}] delete error:`, err)
    return NextResponse.json(
      { error: `Failed to delete category: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
