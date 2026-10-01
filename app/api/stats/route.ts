import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET(): Promise<NextResponse> {
  try {
    const [
      totalBookmarks,
      bookmarkCount,
      likeCount,
      totalCategories,
      totalMedia,
      uncategorizedCount,
      recentBookmarks,
      topCategoriesRaw,
    ] = await Promise.all([
      prisma.bookmark.count({ where: { deletedAt: null } }),
      prisma.bookmark.count({ where: { source: 'bookmark', deletedAt: null } }),
      prisma.bookmark.count({ where: { source: 'like', deletedAt: null } }),
      prisma.category.count(),
      prisma.mediaItem.count({ where: { bookmark: { deletedAt: null } } }),
      prisma.bookmark.count({ where: { enrichedAt: null, deletedAt: null } }),
      prisma.bookmark.findMany({
        where: { deletedAt: null },
        take: 5,
        orderBy: { importedAt: 'desc' },
        include: {
          mediaItems: {
            select: { id: true, type: true, url: true, thumbnailUrl: true },
          },
          categories: {
            include: {
              category: {
                select: { id: true, name: true, slug: true, color: true },
              },
            },
          },
        },
      }),
      prisma.category.findMany({
        include: {
          _count: { select: { bookmarks: { where: { bookmark: { deletedAt: null } } } } },
        },
      }),
    ])

    const formattedRecent = recentBookmarks.map((b) => ({
      id: b.id,
      tweetId: b.tweetId,
      text: b.text,
      authorHandle: b.authorHandle,
      authorName: b.authorName,
      tweetCreatedAt: b.tweetCreatedAt?.toISOString() ?? null,
      importedAt: b.importedAt.toISOString(),
      mediaItems: b.mediaItems,
      categories: b.categories.map((bc) => ({
        id: bc.category.id,
        name: bc.category.name,
        slug: bc.category.slug,
        color: bc.category.color,
        confidence: bc.confidence,
      })),
    }))

    const topCategories = topCategoriesRaw
      .map((cat) => ({ name: cat.name, slug: cat.slug, color: cat.color, count: cat._count.bookmarks }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    return NextResponse.json({
      totalBookmarks,
      bookmarkCount,
      likeCount,
      totalCategories,
      totalMedia,
      uncategorizedCount,
      recentBookmarks: formattedRecent,
      topCategories,
    })
  } catch (err) {
    console.error('Stats fetch error:', err)
    return NextResponse.json(
      { error: `Failed to fetch stats: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
