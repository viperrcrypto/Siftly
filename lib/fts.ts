/**
 * SQLite FTS5 virtual table for fast full-text search across bookmarks.
 * FTS5 uses Porter stemming and tokenization — much faster than LIKE '%keyword%' table scans.
 *
 * The table is rebuilt after enrichment runs. At search time it provides ranked ID lists
 * that replace the LIKE-based keyword conditions in the search route.
 */

import prisma from '@/lib/db'

const FTS_TABLE = 'bookmark_fts'

export async function ensureFtsTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
      bookmark_id UNINDEXED,
      text,
      semantic_tags,
      entities,
      image_tags,
      tokenize='porter unicode61'
    )
  `)
}

/**
 * Rebuild the FTS5 table from all bookmarks. Fast (local SQLite) and idempotent.
 * Call after import or enrichment runs.
 */
export async function rebuildFts(): Promise<void> {
  await ensureFtsTable()
  await prisma.$executeRawUnsafe(`DELETE FROM ${FTS_TABLE}`)

  const bookmarks = await prisma.bookmark.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      text: true,
      semanticTags: true,
      entities: true,
      mediaItems: { select: { imageTags: true } },
    },
  })

  if (bookmarks.length === 0) return

  // Insert in batches of 200 to stay within SQLite variable limits
  const BATCH = 200
  for (let i = 0; i < bookmarks.length; i += BATCH) {
    const batch = bookmarks.slice(i, i + BATCH)
    await prisma.$transaction(
      batch.map((b) => {
        const imageTagsText = b.mediaItems
          .map((m) => m.imageTags ?? '')
          .filter(Boolean)
          .join(' ')
        return prisma.$executeRaw`
          INSERT INTO bookmark_fts(bookmark_id, text, semantic_tags, entities, image_tags)
          VALUES (${b.id}, ${b.text}, ${b.semanticTags ?? ''}, ${b.entities ?? ''}, ${imageTagsText})
        `
      }),
    )
  }
}

/**
 * Search FTS5 table for bookmarks matching the given keywords.
 * Returns bookmark IDs ordered by relevance rank.
 * Returns [] on error (caller should fall back to LIKE queries).
 */
export async function ftsSearch(keywords: string[]): Promise<string[]> {
  if (keywords.length === 0) return []

  try {
    await ensureFtsTable()

    // Sanitize each keyword: remove FTS5 special chars, wrap in quotes for phrase safety
    const terms = keywords
      .map((kw) => kw.replace(/["*()]/g, ' ').trim())
      .filter((kw) => kw.length >= 2)

    if (terms.length === 0) return []

    // Build FTS5 MATCH query with OR between terms
    const matchQuery = terms.join(' OR ')

    const results = await prisma.$queryRaw<{ bookmark_id: string }[]>`
      SELECT bookmark_id FROM bookmark_fts
      WHERE bookmark_fts MATCH ${matchQuery}
      ORDER BY rank
      LIMIT 150
    `
    return results.map((r) => r.bookmark_id)
  } catch {
    // FTS table may not be populated yet or query has syntax error — fall back gracefully
    return []
  }
}
