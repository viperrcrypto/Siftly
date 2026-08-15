import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { parseHTML } from 'linkedom'

const execFileAsync = promisify(execFile)
const pending = new Map<string, Promise<Buffer>>()
let screenshotQueue: Promise<void> = Promise.resolve()
const CHROME_PATHS = [
  process.env.SIFTLY_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((value): value is string => !!value)

export interface LinkPreviewScreenshotInput {
  url: string
  html: string
  title: string
  description: string
  siteName: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function pageText(html: string): string {
  const { document } = parseHTML(html)
  document.querySelectorAll('script, style, noscript, template, svg').forEach((node) => node.remove())
  const blocks = Array.from(document.querySelectorAll('h1, h2, h3, p, li'))
    .map((node) => node.textContent.trim())
    .filter(Boolean)
  return (blocks.join(' ') || document.body?.textContent || document.documentElement?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1_400)
}

export function renderLinkPreviewScreenshotHtml(input: LinkPreviewScreenshotInput): string {
  const domain = new URL(input.url).hostname.replace(/^www\./, '')
  const body = pageText(input.html) || input.description || input.url
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;width:1200px;height:675px;overflow:hidden;background:#18181b;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:64px}
    .site{color:#a1a1aa;font-size:24px;margin-bottom:32px}.title{font-size:48px;line-height:1.25;font-weight:750;letter-spacing:-.02em;max-height:180px;overflow:hidden;margin-bottom:28px}.body{font-size:26px;line-height:1.65;color:#d4d4d8;max-height:260px;overflow:hidden}.url{position:absolute;left:64px;right:64px;bottom:42px;color:#71717a;font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  </style></head><body><div class="site">${escapeHtml(input.siteName || domain)}</div><div class="title">${escapeHtml(input.title || domain)}</div><div class="body">${escapeHtml(body)}</div><div class="url">${escapeHtml(input.url)}</div></body></html>`
}

async function findChrome(): Promise<string> {
  for (const candidate of CHROME_PATHS) {
    try {
      await fs.access(candidate)
      return candidate
    } catch { /* 次の候補を確認 */ }
  }
  throw new Error('Google ChromeまたはChromiumが見つかりません')
}

async function generate(input: LinkPreviewScreenshotInput, cachePath: string): Promise<Buffer> {
  const cached = await fs.readFile(cachePath).catch(() => null)
  if (cached) return cached

  const chrome = await findChrome()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'siftly-link-preview-'))
  const htmlPath = path.join(tempDir, 'preview.html')
  const pngPath = path.join(tempDir, 'preview.png')
  try {
    await fs.writeFile(htmlPath, renderLinkPreviewScreenshotHtml(input), 'utf8')
    await execFileAsync(chrome, [
      '--headless=new',
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-javascript',
      '--disable-sync',
      '--hide-scrollbars',
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--no-first-run',
      '--window-size=1200,675',
      `--screenshot=${pngPath}`,
      pathToFileURL(htmlPath).toString(),
    ], { timeout: 20_000, maxBuffer: 1_000_000 })
    const png = await fs.readFile(pngPath)
    await fs.mkdir(path.dirname(cachePath), { recursive: true })
    await fs.writeFile(cachePath, png)
    return png
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

export async function createLinkPreviewScreenshot(input: LinkPreviewScreenshotInput): Promise<Buffer> {
  const key = createHash('sha256').update(`v2:${input.url}`).digest('hex')
  const cachePath = path.join(os.homedir(), '.cache', 'siftly', 'link-previews', `${key}.png`)
  const active = pending.get(key)
  if (active) return active

  // ponytail: URL単位のキャッシュは無期限。容量が実測で問題になった時だけ失効処理を追加する。
  // ponytail: Chromeは直列実行。表示待ちが問題になった時だけ小さな並列数へ増やす。
  const task = screenshotQueue.then(() => generate(input, cachePath)).finally(() => pending.delete(key))
  screenshotQueue = task.then(() => undefined, () => undefined)
  pending.set(key, task)
  return task
}
