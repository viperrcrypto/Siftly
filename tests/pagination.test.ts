import assert from 'node:assert/strict'
import test from 'node:test'
import { getPageAfterDeletion } from '@/lib/pagination'

test('getPageAfterDeletion keeps the current page when it remains valid', () => {
  assert.equal(getPageAfterDeletion(1, 30, 24), 1)
  assert.equal(getPageAfterDeletion(2, 48, 24), 2)
})

test('getPageAfterDeletion moves back when deleting the only item on the last page', () => {
  assert.equal(getPageAfterDeletion(2, 25, 24), 1)
  assert.equal(getPageAfterDeletion(3, 49, 24), 2)
})

test('getPageAfterDeletion clamps invalid page and size inputs', () => {
  assert.equal(getPageAfterDeletion(0, 1, 24), 1)
  assert.equal(getPageAfterDeletion(5, 1, 0), 1)
})
