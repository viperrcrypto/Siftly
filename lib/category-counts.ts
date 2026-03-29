import prisma from '@/lib/db'

export async function getActiveBookmarkCountMap(): Promise<Map<string, number>> {
  const rows = await prisma.bookmarkCategory.groupBy({
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
