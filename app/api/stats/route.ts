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
      inboxCount,
      trashCount,
      recentBookmarks,
      topCategoriesRaw,
    ] = await Promise.all([
      prisma.bookmark.count({ where: { hidden: false } }),
      prisma.bookmark.count({ where: { source: 'bookmark', hidden: false } }),
      prisma.bookmark.count({ where: { source: 'like', hidden: false } }),
      prisma.category.count(),
      prisma.mediaItem.count(),
      prisma.bookmark.count({ where: { enrichedAt: null, hidden: false } }),
      prisma.bookmark.count({ where: { triageState: 'inbox' } }),
      prisma.bookmark.count({ where: { triageState: 'deleted' } }),
      prisma.bookmark.findMany({
        take: 5,
        where: { hidden: false },
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
          _count: { select: { bookmarks: true } },
        },
        orderBy: {
          bookmarks: { _count: 'desc' },
        },
        take: 5,
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

    const topCategories = topCategoriesRaw.map((cat) => ({
      name: cat.name,
      slug: cat.slug,
      color: cat.color,
      count: cat._count.bookmarks,
    }))

    return NextResponse.json({
      totalBookmarks,
      bookmarkCount,
      likeCount,
      totalCategories,
      totalMedia,
      uncategorizedCount,
      inboxCount,
      trashCount,
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
