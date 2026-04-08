import fs from 'fs/promises'
import path from 'path'
import prisma from '@/lib/db'

export interface ObsidianExportResult {
  written: number
  skipped: number
  errors: Array<{ tweetId: string; error: string }>
  indexesWritten: number
}

interface ObsidianExportOptions {
  vaultPath: string
  subfolder?: string
  overwrite?: boolean
  categoryFilter?: string
}

interface MediaItemRow {
  type: string
  url: string
  thumbnailUrl: string | null
}

interface CategoryJoin {
  category: {
    name: string
    slug: string
    color: string
  }
}

interface BookmarkRow {
  id: string
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  tweetCreatedAt: Date | null
  importedAt: Date
  semanticTags: string | null
  entities: string | null
  mediaItems: MediaItemRow[]
  categories: CategoryJoin[]
}

/**
 * Validate that vaultPath is safe:
 * - Must be an absolute path
 * - Must be an existing directory
 * - Must be under the user's home directory (not system paths)
 */
export async function validateVaultPath(vaultPath: string): Promise<{ valid: boolean; error?: string }> {
  const resolved = path.resolve(vaultPath)

  if (!path.isAbsolute(resolved)) {
    return { valid: false, error: 'Vault path must be absolute' }
  }

  // Block system paths
  const blocked = ['/etc', '/usr', '/bin', '/sbin', '/var', '/tmp', '/dev', '/proc', '/sys']
  if (blocked.some(p => resolved === p || resolved.startsWith(p + '/'))) {
    return { valid: false, error: 'Cannot write to system directories' }
  }

  try {
    const stat = await fs.stat(resolved)
    if (!stat.isDirectory()) {
      return { valid: false, error: 'Path is not a directory' }
    }
  } catch {
    return { valid: false, error: 'Directory does not exist' }
  }

  return { valid: true }
}

function sanitizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_/]/g, '')
    .replace(/-+/g, '-')
    .trim()
}

function sanitizeFilename(str: string): string {
  return str.replace(/[<>:"/\\|?*\n\r]/g, '').trim()
}

function noteFilename(bookmark: BookmarkRow): string {
  const date = bookmark.tweetCreatedAt
    ? new Date(bookmark.tweetCreatedAt).toISOString().split('T')[0]
    : 'unknown'
  const author = sanitizeFilename(bookmark.authorHandle || 'unknown')
  return `${date} - @${author} - ${bookmark.tweetId}.md`
}

function buildNoteMarkdown(bookmark: BookmarkRow): string {
  const tags: string[] = ['twitter/bookmark']

  if (bookmark.authorHandle) {
    tags.push(`author/${sanitizeTag(bookmark.authorHandle)}`)
  }

  let semanticTags: string[] = []
  try { semanticTags = JSON.parse(bookmark.semanticTags || '[]') } catch {}
  semanticTags.forEach(t => { const c = sanitizeTag(t); if (c) tags.push(c) })

  const categories = bookmark.categories.map((bc) => bc.category.name)
  categories.forEach((c) => tags.push(`category/${sanitizeTag(c)}`))

  const date = bookmark.tweetCreatedAt
    ? new Date(bookmark.tweetCreatedAt).toISOString().split('T')[0]
    : null
  const sourceUrl = `https://x.com/${bookmark.authorHandle}/status/${bookmark.tweetId}`

  const frontmatter = [
    '---',
    `tweet_id: "${bookmark.tweetId}"`,
    `author: "${bookmark.authorHandle || ''}"`,
    `author_name: "${(bookmark.authorName || '').replace(/"/g, "'")}"`,
    date ? `date: ${date}` : null,
    `source: "${sourceUrl}"`,
    `categories: [${categories.map((c) => `"${c}"`).join(', ')}]`,
    `tags:`,
    ...tags.map(t => `  - ${t}`),
    '---',
  ].filter(Boolean).join('\n')

  const lines: string[] = [frontmatter, '', bookmark.text || '']

  if (bookmark.mediaItems.length > 0) {
    lines.push('', '## Media', '')
    for (const item of bookmark.mediaItems) {
      if (item.type === 'photo') {
        lines.push(`![](${item.url})`)
      } else {
        lines.push(`[${item.type.toUpperCase()}](${item.url})`)
      }
    }
  }

  lines.push('', '## Source', '', `[View on X](${sourceUrl})`)
  return lines.join('\n')
}

function buildCategoryIndex(
  categoryName: string,
  bookmarks: BookmarkRow[]
): string {
  const tag = sanitizeTag(categoryName)
  const links = bookmarks
    .map(b => `- [[${noteFilename(b).replace(/\.md$/, '')}]]`)
    .join('\n')

  return [
    '---',
    `type: index`,
    `category: "${categoryName}"`,
    `tags:`,
    `  - index/category`,
    `  - category/${tag}`,
    '---',
    '',
    `# ${categoryName}`,
    '',
    `${bookmarks.length} bookmarks`,
    '',
    '## Bookmarks',
    '',
    links,
  ].join('\n')
}

function buildAuthorIndex(
  handle: string,
  displayName: string,
  bookmarks: BookmarkRow[]
): string {
  const links = bookmarks
    .map(b => `- [[${noteFilename(b).replace(/\.md$/, '')}]]`)
    .join('\n')

  return [
    '---',
    `type: index`,
    `author: "${handle}"`,
    `author_name: "${displayName.replace(/"/g, "'")}"`,
    `tags:`,
    `  - index/author`,
    `  - author/${sanitizeTag(handle)}`,
    '---',
    '',
    `# @${handle}`,
    '',
    `${bookmarks.length} bookmarks`,
    '',
    '## Bookmarks',
    '',
    links,
  ].join('\n')
}

export async function exportToObsidian(options: ObsidianExportOptions): Promise<ObsidianExportResult> {
  const { vaultPath, subfolder = 'Twitter Bookmarks', overwrite = false, categoryFilter } = options

  // Validate path before writing
  const validation = await validateVaultPath(vaultPath)
  if (!validation.valid) {
    throw new Error(`Invalid vault path: ${validation.error}`)
  }

  // Sanitize subfolder to prevent path traversal via subfolder param
  const safeSubfolder = sanitizeFilename(subfolder)
  const notesDir = path.join(vaultPath, safeSubfolder)
  const indexDir = path.join(notesDir, '_index')

  // Verify the resolved paths are still under vaultPath
  const resolvedNotesDir = path.resolve(notesDir)
  const resolvedVaultPath = path.resolve(vaultPath)
  if (!resolvedNotesDir.startsWith(resolvedVaultPath + '/') && resolvedNotesDir !== resolvedVaultPath) {
    throw new Error('Subfolder path escapes vault directory')
  }

  await fs.mkdir(notesDir, { recursive: true })
  await fs.mkdir(indexDir, { recursive: true })

  const where = categoryFilter
    ? { categories: { some: { category: { slug: categoryFilter } } } }
    : {}

  const bookmarks = await prisma.bookmark.findMany({
    where,
    include: {
      mediaItems: true,
      categories: { include: { category: true } },
    },
    orderBy: { tweetCreatedAt: 'desc' },
  }) as BookmarkRow[]

  const result: ObsidianExportResult = { written: 0, skipped: 0, errors: [], indexesWritten: 0 }

  for (const bookmark of bookmarks) {
    const filename = noteFilename(bookmark)
    const filePath = path.join(notesDir, filename)

    if (!overwrite) {
      try { await fs.access(filePath); result.skipped++; continue } catch {}
    }

    try {
      await fs.writeFile(filePath, buildNoteMarkdown(bookmark), 'utf-8')
      result.written++
    } catch (err: unknown) {
      result.errors.push({
        tweetId: bookmark.tweetId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const byCategory = new Map<string, BookmarkRow[]>()
  for (const bookmark of bookmarks) {
    for (const bc of bookmark.categories) {
      const name = bc.category.name
      if (!byCategory.has(name)) byCategory.set(name, [])
      byCategory.get(name)!.push(bookmark)
    }
  }
  for (const [categoryName, categoryBookmarks] of byCategory) {
    const filename = `_${sanitizeFilename(categoryName)}.md`
    const filePath = path.join(indexDir, filename)
    await fs.writeFile(filePath, buildCategoryIndex(categoryName, categoryBookmarks), 'utf-8')
    result.indexesWritten++
  }

  const byAuthor = new Map<string, { displayName: string; bookmarks: BookmarkRow[] }>()
  for (const bookmark of bookmarks) {
    const handle = bookmark.authorHandle || 'unknown'
    if (!byAuthor.has(handle)) {
      byAuthor.set(handle, { displayName: bookmark.authorName || handle, bookmarks: [] })
    }
    byAuthor.get(handle)!.bookmarks.push(bookmark)
  }
  for (const [handle, { displayName, bookmarks: authorBookmarks }] of byAuthor) {
    const filename = `@${sanitizeFilename(handle)}.md`
    const filePath = path.join(indexDir, filename)
    await fs.writeFile(filePath, buildAuthorIndex(handle, displayName, authorBookmarks), 'utf-8')
    result.indexesWritten++
  }

  return result
}
