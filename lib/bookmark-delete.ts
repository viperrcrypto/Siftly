import prisma from '@/lib/db'

interface BookmarkDeleteLookup {
  findUnique(args: {
    where: { id: string }
    select: { id: true; deletedAt: true }
  }): Promise<{ id: string; deletedAt: Date | null } | null>
}

interface BookmarkDeleteMutation {
  update(args: {
    where: { id: string }
    data: { deletedAt: Date }
  }): Promise<unknown>
}

interface BookmarkCategoryDeleteMany {
  deleteMany(args: {
    where: { bookmarkId: string }
  }): Promise<{ count: number }>
}

interface BookmarkDeleteTransaction {
  bookmark: BookmarkDeleteMutation
  bookmarkCategory: BookmarkCategoryDeleteMany
}

export interface BookmarkDeleteClient {
  bookmark: BookmarkDeleteLookup
  $transaction<T>(fn: (tx: BookmarkDeleteTransaction) => Promise<T>): Promise<T>
}

export type SoftDeleteBookmarkStatus = 'deleted' | 'already_deleted' | 'not_found'

export interface SoftDeleteBookmarkResult {
  id: string
  status: SoftDeleteBookmarkStatus
  removedCategoryLinks: number
}

export async function softDeleteBookmarkById(
  id: string,
  db: BookmarkDeleteClient = prisma
): Promise<SoftDeleteBookmarkResult> {
  const bookmark = await db.bookmark.findUnique({
    where: { id },
    select: {
      id: true,
      deletedAt: true,
    },
  })

  if (!bookmark) {
    return {
      id,
      status: 'not_found',
      removedCategoryLinks: 0,
    }
  }

  return db.$transaction(async (tx) => {
    if (!bookmark.deletedAt) {
      await tx.bookmark.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
    }

    const { count } = await tx.bookmarkCategory.deleteMany({
      where: { bookmarkId: id },
    })

    return {
      id,
      status: bookmark.deletedAt ? 'already_deleted' : 'deleted',
      removedCategoryLinks: count,
    }
  })
}
