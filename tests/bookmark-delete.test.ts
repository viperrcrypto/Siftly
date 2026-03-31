import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDeleteBookmarkResponse } from '@/app/api/bookmarks/[id]/route'
import { softDeleteBookmarkById } from '@/lib/bookmark-delete'

function createDeleteClient(initialDeletedAt: Date | null, categoryLinkCount: number) {
  let bookmark = initialDeletedAt === undefined ? null : { id: 'bookmark-1', deletedAt: initialDeletedAt }
  let links = categoryLinkCount
  let updateCalls = 0
  let deletedBookmarkId: string | null = null

  return {
    client: {
      bookmark: {
        async findUnique() {
          return bookmark
        },
      },
      async $transaction<T>(fn: (tx: {
        bookmark: {
          update(args: { where: { id: string }; data: { deletedAt: Date } }): Promise<unknown>
        }
        bookmarkCategory: {
          deleteMany(args: { where: { bookmarkId: string } }): Promise<{ count: number }>
        }
      }) => Promise<T>) {
        return fn({
          bookmark: {
            async update({ where, data }) {
              updateCalls += 1
              bookmark = { id: where.id, deletedAt: data.deletedAt }
              return bookmark
            },
          },
          bookmarkCategory: {
            async deleteMany({ where }) {
              deletedBookmarkId = where.bookmarkId
              const count = links
              links = 0
              return { count }
            },
          },
        })
      },
    },
    getState() {
      return {
        bookmark,
        links,
        updateCalls,
        deletedBookmarkId,
      }
    },
  }
}

test('softDeleteBookmarkById marks active bookmarks deleted and removes category links', async () => {
  const mock = createDeleteClient(null, 3)

  const result = await softDeleteBookmarkById('bookmark-1', mock.client)

  assert.equal(result.status, 'deleted')
  assert.equal(result.removedCategoryLinks, 3)
  assert.equal(mock.getState().updateCalls, 1)
  assert.equal(mock.getState().deletedBookmarkId, 'bookmark-1')
  assert.equal(mock.getState().links, 0)
  assert.ok(mock.getState().bookmark?.deletedAt instanceof Date)
})

test('softDeleteBookmarkById still cleans up category links for already deleted bookmarks', async () => {
  const mock = createDeleteClient(new Date('2026-03-30T00:00:00.000Z'), 2)

  const result = await softDeleteBookmarkById('bookmark-1', mock.client)

  assert.equal(result.status, 'already_deleted')
  assert.equal(result.removedCategoryLinks, 2)
  assert.equal(mock.getState().updateCalls, 0)
  assert.equal(mock.getState().deletedBookmarkId, 'bookmark-1')
  assert.equal(mock.getState().links, 0)
})

test('softDeleteBookmarkById returns not_found when the bookmark does not exist', async () => {
  const client = {
    bookmark: {
      async findUnique() {
        return null
      },
    },
    async $transaction<T>(_fn: unknown): Promise<T> {
      throw new Error('transaction should not run')
    },
  }

  const result = await softDeleteBookmarkById('missing', client)

  assert.deepEqual(result, {
    id: 'missing',
    status: 'not_found',
    removedCategoryLinks: 0,
  })
})

test('buildDeleteBookmarkResponse returns 404 for missing bookmarks', async () => {
  const response = await buildDeleteBookmarkResponse('missing', async (id) => ({
    id,
    status: 'not_found',
    removedCategoryLinks: 0,
  }))

  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error: 'Bookmark not found: missing',
  })
})

test('buildDeleteBookmarkResponse includes cleanup details for successful deletes', async () => {
  const response = await buildDeleteBookmarkResponse('bookmark-1', async (id) => ({
    id,
    status: 'already_deleted',
    removedCategoryLinks: 4,
  }))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    deleted: true,
    id: 'bookmark-1',
    alreadyDeleted: true,
    removedCategoryLinks: 4,
  })
})
