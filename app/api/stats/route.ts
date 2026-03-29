import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getActiveBookmarkCountMap } from '@/lib/category-counts'

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
      countMap,
    ] = await Promise.all([
      prisma.bookmark.count({ where: { deletedAt: null } }),
      prisma.bookmark.count({ where: { deletedAt: null, source: 'bookmark' } }),
      prisma.bookmark.count({ where: { deletedAt: null, source: 'like' } }),
      prisma.category.count(),
      prisma.mediaItem.count({ where: { bookmark: { deletedAt: null } } }),
      prisma.bookmark.count({ where: { deletedAt: null, enrichedAt: null } }),
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
      prisma.category.findMany({ orderBy: { name: 'asc' } }),
      getActiveBookmarkCountMap(),
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
      .map((cat) => ({
        name: cat.name,
        slug: cat.slug,
        color: cat.color,
        count: countMap.get(cat.id) ?? 0,
      }))
      .filter((cat) => cat.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
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
