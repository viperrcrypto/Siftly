import prisma from '@/lib/db'

interface BookmarkCategoryCountClient {
  bookmarkCategory: {
    groupBy(args: {
      by: ['categoryId']
      where: {
        bookmark: {
          deletedAt: null
        }
      }
      _count: {
        categoryId: true
      }
    }): Promise<Array<{ categoryId: string; _count: { categoryId: number } }>>
  }
}

export async function getActiveBookmarkCountMap(
  db: BookmarkCategoryCountClient = prisma
): Promise<Map<string, number>> {
  const rows = await db.bookmarkCategory.groupBy({
    by: ['categoryId'],
    where: {
      bookmark: {
        deletedAt: null,
      },
    },
    _count: {
      categoryId: true,
    },
  })

  return new Map(rows.map((row) => [row.categoryId, row._count.categoryId]))
}
