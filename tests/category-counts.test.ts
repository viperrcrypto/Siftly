import assert from 'node:assert/strict'
import test from 'node:test'
import { getActiveBookmarkCountMap } from '@/lib/category-counts'

test('getActiveBookmarkCountMap groups only active bookmark links', async () => {
  let receivedArgs: unknown

  const counts = await getActiveBookmarkCountMap({
    bookmarkCategory: {
      async groupBy(args) {
        receivedArgs = args
        return [
          { categoryId: 'cat-a', _count: { categoryId: 2 } },
          { categoryId: 'cat-b', _count: { categoryId: 1 } },
        ]
      },
    },
  })

  assert.deepEqual(receivedArgs, {
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
  assert.deepEqual(Array.from(counts.entries()), [
    ['cat-a', 2],
    ['cat-b', 1],
  ])
})
