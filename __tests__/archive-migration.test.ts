import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const migrationPath = path.join(process.cwd(), 'prisma/migrations/20260814000000_add_archive_records/migration.sql')

describe('archive migration', () => {
  it('同一bookmark/urlのkeeperへmetadataを保持してからunique制約を作る', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        CREATE TABLE Bookmark (id TEXT PRIMARY KEY, tweetId TEXT NOT NULL UNIQUE, authorHandle TEXT NOT NULL);
        CREATE TABLE MediaItem (
          id TEXT PRIMARY KEY, bookmarkId TEXT NOT NULL, type TEXT NOT NULL, url TEXT NOT NULL,
          thumbnailUrl TEXT, localPath TEXT, imageTags TEXT
        );
      `)
      const bookmark = db.prepare('INSERT INTO Bookmark (id, tweetId, authorHandle) VALUES (?, ?, ?)')
      bookmark.run('bookmark-a', '123', 'alice')
      bookmark.run('bookmark-b', '456', 'bob')
      const media = db.prepare('INSERT INTO MediaItem (id, bookmarkId, type, url, thumbnailUrl, localPath, imageTags) VALUES (?, ?, ?, ?, ?, ?, ?)')
      media.run('a', 'bookmark-a', 'photo', 'https://cdn.example/a', null, null, null)
      media.run('b', 'bookmark-a', 'photo', 'https://cdn.example/a', 'https://cdn.example/thumb', '/vault/a.jpg', '["tag"]')
      media.run('c', 'bookmark-b', 'photo', 'https://cdn.example/a', null, null, null)

      db.exec(fs.readFileSync(migrationPath, 'utf8'))

      expect(db.prepare('SELECT id, thumbnailUrl, localPath, imageTags, sourceTweetId, sourceTweetUrl, sourceMediaIndex, sourceAuthorHandle FROM MediaItem WHERE bookmarkId = ?').all('bookmark-a')).toEqual([{
        id: 'a', thumbnailUrl: 'https://cdn.example/thumb', localPath: '/vault/a.jpg', imageTags: '["tag"]',
        sourceTweetId: '123', sourceTweetUrl: 'https://x.com/alice/status/123', sourceMediaIndex: 0, sourceAuthorHandle: 'alice',
      }])
      expect(db.prepare('SELECT id FROM MediaItem WHERE bookmarkId = ?').all('bookmark-b')).toEqual([{ id: 'c' }])
      expect(() => db.prepare('INSERT INTO MediaItem (id, bookmarkId, type, url) VALUES (?, ?, ?, ?)').run('d', 'bookmark-a', 'photo', 'https://cdn.example/a')).toThrow(/UNIQUE/)
      expect(() => db.prepare('INSERT INTO MediaItem (id, bookmarkId, type, url, sourceTweetId, sourceMediaIndex) VALUES (?, ?, ?, ?, ?, ?)').run('e', 'bookmark-a', 'photo', 'https://cdn.example/new', '123', 0)).toThrow(/UNIQUE/)
    } finally {
      db.close()
    }
  })
})
