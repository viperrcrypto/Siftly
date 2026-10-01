import crypto from 'node:crypto'
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'
import { safeFetch } from '@/lib/archive/safe-fetch'

export interface ClipperTemplate {
  schemaVersion?: string
  name?: string
  triggers?: string[]
  noteNameFormat?: string
  path?: string
  noteContentFormat?: string
  properties?: Array<{ name?: string; value?: string; type?: string }>
}

export interface ClipPage {
  url: string; canonicalUrl: string; title: string; description: string; author: string
  published: string; content: string; html: string; image: string; schema: Record<string, unknown>
}

export async function fetchArticle(url: string): Promise<ClipPage> {
  const result = await safeFetch(url, { maxBytes: 5_000_000, accept: 'text/html,application/xhtml+xml' })
  if (result.status < 200 || result.status >= 300) throw new Error(`Article request failed: HTTP ${result.status}`)
  const contentType = String(result.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') throw new Error('Article is not HTML')
  const html = result.body.toString('utf8')
  const { document } = parseHTML(html)
  const article = new Readability(document as unknown as Document).parse()
  const meta = (name: string) => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content') ?? ''
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')
  const schemaNode = document.querySelector('script[type="application/ld+json"]')?.textContent
  let schema: Record<string, unknown> = {}
  try { schema = JSON.parse(schemaNode ?? '{}') as Record<string, unknown> } catch { /* optional metadata */ }
  return {
    url: result.url,
    canonicalUrl: canonical ? new URL(canonical, result.url).toString() : result.url,
    title: article?.title || meta('og:title') || document.title || result.url,
    description: article?.excerpt || meta('description') || meta('og:description'),
    author: meta('author') || meta('article:author'),
    published: meta('article:published_time') || meta('date'),
    content: article?.content || document.body?.innerHTML || '', html,
    image: meta('og:image'), schema,
  }
}

export async function loadTemplates(dir: string): Promise<{ templates: Array<ClipperTemplate & { file: string }>; errors: string[] }> {
  const templates: Array<ClipperTemplate & { file: string }> = []
  const errors: string[] = []
  let root: string
  try { root = await fs.realpath(dir) } catch (error) {
    return { templates, errors: [`${dir}: ${error instanceof Error ? error.message : 'テンプレートディレクトリを読めません'}`] }
  }
  const report = (file: string, error: unknown) => errors.push(`${path.relative(root, file) || '.'}: ${error instanceof Error ? error.message : '読み込みエラー'}`)
  async function visit(current: string) {
    let entries: Dirent[]
    try { entries = await fs.readdir(current, { withFileTypes: true }) } catch (error) { report(current, error); return }
    for (const entry of entries) {
      const file = path.join(current, entry.name)
      try {
        const stat = await fs.lstat(file)
        if (stat.isSymbolicLink()) { errors.push(`${path.relative(root, file)}: symlinkは利用できません`); continue }
        if (stat.isDirectory()) { await visit(file); continue }
        if (!stat.isFile() || !entry.name.endsWith('.json')) continue
        const data = JSON.parse(await fs.readFile(file, 'utf8')) as ClipperTemplate
        if (!data.noteNameFormat) throw new Error('必須フィールド不足')
        templates.push({ ...data, file })
      } catch (error) { report(file, error) }
    }
  }
  await visit(root)
  return { templates, errors }
}

function matches(trigger: string, page: ClipPage): number {
  if (trigger.startsWith('schema:')) return page.html.includes(trigger.slice(7)) ? trigger.length : -1
  if (trigger.startsWith('/')) {
    const match = trigger.match(/^\/(.*)\/([a-z]*)$/)
    try { return match && new RegExp(match[1], match[2]).test(page.url) ? trigger.length : -1 } catch { return -1 }
  }
  const literal = trigger.replace(/\*/g, '')
  return page.url.startsWith(literal) ? literal.length : -1
}

export function selectTemplate(templates: Array<ClipperTemplate & { file: string }>, page: ClipPage): (ClipperTemplate & { file: string }) | undefined {
  const candidates = templates.flatMap((template) => (template.triggers ?? []).map((trigger) => ({ template, score: matches(trigger, page) }))).filter((x) => x.score >= 0)
  if (candidates.length) return candidates.sort((a, b) => b.score - a.score || a.template.file.split(path.sep).length - b.template.file.split(path.sep).length || (a.template.schemaVersion ?? '').localeCompare(b.template.schemaVersion ?? ''))[0].template
  return templates.find((template) => path.basename(template.file) === '一般用-clipper.json') ?? templates.find((template) => /default|general/i.test(template.name ?? ''))
}

function yaml(value: string): string { return JSON.stringify(value) }
function yamlProperty(value: string, type: string | undefined, reasons: string[]): string {
  const normalized = type?.toLowerCase()
  if (!normalized || ['text', 'number', 'checkbox', 'date', 'datetime'].includes(normalized)) return yaml(value)
  if (['multitext', 'tags', 'aliases'].includes(normalized)) return `[${value.split(/\s*(?:\r?\n|,)\s*/).filter(Boolean).map(yaml).join(', ')}]`
  reasons.push(`未対応property type: ${type}`)
  return yaml(value)
}
export function safeName(value: string): string { return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\.+$/g, '').trim().slice(0, 120) || 'untitled' }

export function safeRelativePath(value: string): string {
  if (!value || path.isAbsolute(value)) throw new Error('Unsafe archive path')
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'))
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.split('/').some((part) => !part || part === '.')) throw new Error('Unsafe archive path')
  return normalized
}

export function addFrontmatterProperties(markdown: string, properties: Record<string, string>): string {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---\n/)
  const existing = new Set((frontmatter?.[1].match(/^([^:\n]+):/gm) ?? []).map((line) => safeName(line.slice(0, -1))))
  const lines = Object.entries(properties)
    .filter(([key]) => !existing.has(safeName(key)))
    .map(([key, value]) => `${safeName(key)}: ${JSON.stringify(value)}`)
  if (!lines.length) return markdown
  return markdown.startsWith('---\n') ? markdown.replace('---\n', `---\n${lines.join('\n')}\n`) : `---\n${lines.join('\n')}\n---\n\n${markdown}`
}

async function safeDirectory(vaultPath: string, relative: string): Promise<{ vault: string; dir: string }> {
  const vault = await fs.realpath(vaultPath)
  const safe = safeRelativePath(relative)
  let current = vault
  for (const segment of safe.split('/')) {
    current = path.join(current, segment)
    try {
      await fs.lstat(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try { await fs.mkdir(current) } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError
      }
    }
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Archive path contains a symlink or non-directory')
    const realCurrent = await fs.realpath(current)
    if (realCurrent !== vault && !realCurrent.startsWith(vault + path.sep)) throw new Error('Archive path escapes vault')
    current = realCurrent
  }
  const realDir = await fs.realpath(current)
  if (!realDir.startsWith(vault + path.sep)) throw new Error('Archive path escapes vault')
  return { vault, dir: realDir }
}

export function renderTemplate(template: ClipperTemplate, page: ClipPage): { noteName: string; relativePath: string; markdown: string; reasons: string[]; warnings: string[] } {
  const { document } = parseHTML(page.html)
  const reasons: string[] = []
  const warnings: string[] = []
  const turndown = new TurndownService()
  const variables: Record<string, string> = { title: page.title, url: page.canonicalUrl, domain: new URL(page.canonicalUrl).hostname, description: page.description, author: page.author, published: page.published, date: new Date().toISOString().slice(0, 10), time: new Date().toISOString(), content: turndown.turndown(page.content), image: page.image }
  const render = (source: string): string => source.replace(/{{\s*([^}]+)\s*}}/g, (_all, raw: string) => {
    if (/^["']/.test(raw.trim())) { warnings.push('LLM式は実行しません'); return '' }
    const [base, ...filters] = raw.trim().split('|').map((part) => part.trim())
    let value = variables[base] ?? ''
    if (base.startsWith('schema:')) {
      const key = base.slice(7).replace(/^@[^:]+:/, '')
      value = String(page.schema[key] ?? '')
    }
    else if (base.startsWith('meta:')) value = document.querySelector(`meta[property="${base.slice(5)}"],meta[name="${base.slice(5)}"]`)?.getAttribute('content') ?? ''
    else if (base.startsWith('selectorHtml:') || base.startsWith('selector:')) {
      const htmlMode = base.startsWith('selectorHtml:')
      const selector = base.slice(htmlMode ? 13 : 9).split('?')[0]
      try {
        const nodes = [...document.querySelectorAll(selector)]
        const attr = base.includes('?') ? base.split('?')[1] : ''
        value = nodes.map((node) => attr ? node.getAttribute(attr) ?? '' : htmlMode ? node.innerHTML : node.textContent ?? '').join('\n')
      } catch { reasons.push(`未対応selector: ${selector}`); value = '' }
    } else if (!(base in variables) && !base.startsWith('schema:') && !base.startsWith('meta:')) { reasons.push(`未対応変数: ${base}`); return '' }
    let values = [value]
    for (const filter of filters) {
      const name = filter.split(':')[0]
      if (name === 'trim') values = values.map((x) => x.trim())
      else if (name === 'first') values = [values[0] ?? '']
      else if (name === 'last') values = [values.at(-1) ?? '']
      else if (name === 'markdown') values = values.map((x) => turndown.turndown(x))
      else if (name === 'strip_tags' || name === 'remove_html') values = values.map((x) => x.replace(/<[^>]*>/g, ''))
      else if (name === 'safe_name') values = values.map(safeName)
      else if (name === 'wikilink') values = values.filter(Boolean).map((x) => `[[${x}]]`)
      else if (name === 'split') values = values.flatMap((x) => x.split(filter.slice(name.length + 1).replace(/^['"]|['"]$/g, '')))
      else if (name === 'slice') {
        const [from, to] = filter.slice(name.length + 1).split(',').map((x) => Number(x.trim()))
        values = values.slice(Number.isFinite(from) ? from : 0, Number.isFinite(to) ? to : undefined)
      } else if (name === 'replace') {
        const args = [...filter.slice(name.length + 1).matchAll(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g)].map((match) => (match[1] ?? match[2] ?? '').replace(/\\n/g, '\n'))
        if (args.length >= 2) values = values.map((x) => x.split(args[0]).join(args[1])); else { reasons.push('replaceの引数が不正'); values = [''] }
      } else if (name === 'join') values = [values.join(filter.slice(name.length + 1).replace(/^['"]|['"]$/g, '') || ', ')]
      else if (name === 'date') values = values.map((x) => { const d = new Date(x); const fmt = filter.split(':')[1] ?? 'YYYY-MM-DD'; return Number.isNaN(d.valueOf()) ? '' : fmt.replace('YYYY', String(d.getUTCFullYear())).replace('MM', String(d.getUTCMonth() + 1).padStart(2, '0')).replace('DD', String(d.getUTCDate()).padStart(2, '0')).replace('HH', String(d.getUTCHours()).padStart(2, '0')).replace('mm', String(d.getUTCMinutes()).padStart(2, '0')).replace('ss', String(d.getUTCSeconds()).padStart(2, '0')) })
      else if (name === 'image') values = [page.image]
      else if (name === 'escape') values = values.map((x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'))
      else { reasons.push(`未対応filter: ${name}`); values = [''] }
    }
    return values.join('\n')
  })
  const propertyKeys = new Set<string>()
  const properties = (template.properties ?? []).flatMap((p) => {
    if (!p.name) return []
    if (/\{\{\s*["']/.test(p.value ?? '')) { warnings.push('LLM式は実行しません'); return [] }
    const key = safeName(p.name)
    if (propertyKeys.has(key)) return []
    propertyKeys.add(key)
    return [`${key}: ${yamlProperty(render(p.value ?? ''), p.type, reasons)}`]
  })
  const source = propertyKeys.has('source') ? [] : [`source: ${yaml(page.canonicalUrl)}`]
  const body = render(template.noteContentFormat || '{{content|markdown}}')
  const requestedName = render(template.noteNameFormat ?? '{{title}}')
  const requestedPath = render(template.path || 'Clippings').trim()
  return { noteName: safeName(requestedName || page.title), relativePath: requestedPath || 'Clippings', markdown: `---\n${[...properties, ...source].join('\n')}\n---\n\n${body}\n`, reasons, warnings }
}

export async function writeArchiveNote(vaultPath: string, relativePath: string, noteName: string, markdown: string, identity = noteName): Promise<{ path: string; hash: string; skipped: boolean }> {
  const { dir } = await safeDirectory(vaultPath, relativePath)
  const hash = crypto.createHash('sha256').update(markdown).digest('hex')
  const base = safeName(noteName)
  let target = path.join(dir, `${base}.md`)
  try {
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe archive target')
    const old = await fs.readFile(target, 'utf8')
    const oldHash = crypto.createHash('sha256').update(old).digest('hex')
    if (oldHash === hash) return { path: target, hash, skipped: true }
    target = path.join(dir, `${base}-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 12)}.md`)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  try {
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe archive target')
    const oldHash = crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex')
    if (oldHash === hash) return { path: target, hash, skipped: true }
    throw new Error('Archive note identity collision')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temp = path.join(dir, `.${base}.${crypto.randomUUID()}.tmp`)
  await fs.writeFile(temp, markdown, { flag: 'wx' })
  try { await fs.link(temp, target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe archive target')
    if (crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex') === hash) return { path: target, hash, skipped: true }
    throw new Error('Archive note identity collision')
  } finally { await fs.unlink(temp).catch(() => {}) }
  return { path: target, hash, skipped: false }
}

export async function writeArchiveBinary(vaultPath: string, relativePath: string, filename: string, content: Buffer): Promise<{ path: string; hash: string; skipped: boolean }> {
  const { dir } = await safeDirectory(vaultPath, relativePath)
  const hash = crypto.createHash('sha256').update(content).digest('hex')
  const target = path.join(dir, safeName(filename))
  try {
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe archive target')
    if (crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex') === hash) return { path: target, hash, skipped: true }
    throw new Error('Archive binary identity collision')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temp = path.join(dir, `.${safeName(filename)}.${crypto.randomUUID()}.tmp`)
  await fs.writeFile(temp, content, { flag: 'wx' })
  try { await fs.link(temp, target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe archive target')
    if (crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex') === hash) return { path: target, hash, skipped: true }
    throw new Error('Archive binary identity collision')
  } finally { await fs.unlink(temp).catch(() => {}) }
  return { path: target, hash, skipped: false }
}

/** Replace only a Siftly-owned, hash-verified note; user edits are never overwritten. */
export async function replaceArchiveNote(vaultPath: string, existingPath: string, expectedHash: string, markdown: string): Promise<{ path: string; hash: string }> {
  const vault = await fs.realpath(vaultPath)
  const parent = await fs.realpath(path.dirname(existingPath))
  if (parent !== vault && !parent.startsWith(vault + path.sep)) throw new Error('Archive path escapes vault')
  const stat = await fs.lstat(existingPath)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe archive target')
  const currentHash = crypto.createHash('sha256').update(await fs.readFile(existingPath)).digest('hex')
  const hash = crypto.createHash('sha256').update(markdown).digest('hex')
  if (currentHash === hash) return { path: existingPath, hash }
  if (currentHash !== expectedHash) throw new Error('Archive note changed outside Siftly')
  const temp = path.join(parent, `.${path.basename(existingPath)}.${crypto.randomUUID()}.tmp`)
  await fs.writeFile(temp, markdown, { flag: 'wx' })
  try { await fs.rename(temp, existingPath) } finally { await fs.unlink(temp).catch(() => {}) }
  return { path: existingPath, hash }
}
