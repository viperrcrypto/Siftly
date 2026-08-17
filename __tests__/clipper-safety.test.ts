import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn() }))
vi.mock('@/lib/archive/safe-fetch', () => ({ safeFetch: mocks.safeFetch }))

import { fetchArticle, loadTemplates, renderTemplate, writeArchiveNote } from '@/lib/archive/clipper'

describe('clipperの安全境界', () => {
  let vault = ''

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), 'siftly-clipper-'))
    mocks.safeFetch.mockReset()
  })

  afterEach(async () => { await fs.rm(vault, { recursive: true, force: true }) })

  it('同一ディレクトリへの並行保存を安全に成功させる', async () => {
    await expect(Promise.all([
      writeArchiveNote(vault, 'Clippings', 'one', 'one'),
      writeArchiveNote(vault, 'Clippings', 'two', 'two'),
    ])).resolves.toHaveLength(2)
  })

  it('テンプレート設定ディレクトリの読込失敗を結果へ隔離する', async () => {
    await expect(loadTemplates(path.join(vault, 'missing'))).resolves.toMatchObject({ templates: [], errors: [expect.any(String)] })
  })

  it('非2xx記事と非HTMLを拒否し、charset付きHTMLを受け入れる', async () => {
    mocks.safeFetch.mockResolvedValueOnce({ status: 404, headers: {}, body: Buffer.alloc(0), url: 'https://example.com/' })
    await expect(fetchArticle('https://example.com/')).rejects.toThrow('HTTP 404')
    mocks.safeFetch.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{}'), url: 'https://example.com/' })
    await expect(fetchArticle('https://example.com/')).rejects.toThrow('Article is not HTML')
    mocks.safeFetch.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from('<title>記事</title><body>本文</body>'), url: 'https://example.com/' })
    await expect(fetchArticle('https://example.com/')).resolves.toMatchObject({ html: '<title>記事</title><body>本文</body>' })
  })

  it('template path内のdomainを展開する', () => {
    const page = { url: 'https://example.com/a', canonicalUrl: 'https://example.com/a', title: '記事', description: '', author: '', published: '', content: '', html: '', image: '', schema: {} }
    expect(renderTemplate({ path: 'fullsource/webpages/{{domain}}', noteNameFormat: '{{title}}', noteContentFormat: '{{content}}' }, page).relativePath).toBe('fullsource/webpages/example.com')
  })

  it('実Web Clipper相当の空欄とmultitext/source propertyを安全に扱う', async () => {
    await fs.writeFile(path.join(vault, '一般用-clipper.json'), JSON.stringify({ name: '一般用', noteNameFormat: '{{title}}', path: '', noteContentFormat: '', properties: [
      { name: 'source', value: '手入力URL' }, { name: 'source', value: '重複しない' }, { name: 'author', type: 'multitext', value: 'Ada\nBob' },
    ] }))
    await expect(loadTemplates(vault)).resolves.toMatchObject({ errors: [], templates: [expect.objectContaining({ name: '一般用' })] })
    const page = { url: 'https://example.com/a', canonicalUrl: 'https://example.com/a', title: '記事', description: '', author: '', published: '', content: '<p>本文</p>', html: '', image: '', schema: {} }
    const rendered = renderTemplate({ noteNameFormat: '{{title}}', path: '', noteContentFormat: '', properties: [
      { name: 'source', value: '手入力URL' }, { name: 'source', value: '重複しない' }, { name: 'author', type: 'multitext', value: 'Ada\nBob' },
    ] }, page)
    expect(rendered.relativePath).toBe('Clippings')
    expect(rendered.markdown.match(/^source:/gm)).toHaveLength(1)
    expect(rendered.markdown).toContain('source: "手入力URL"')
    expect(rendered.markdown).toContain('author: ["Ada", "Bob"]')
    expect(rendered.reasons).toEqual([])
  })

  it('実テンプレート相当のescape/comma multitextとLLM warningを扱う', () => {
    const page = { url: 'https://example.com/a', canonicalUrl: 'https://example.com/a', title: 'A & B', description: '', author: 'Ada, Bob', published: '', content: '<p>本文</p>', html: '', image: '', schema: {} }
    const rendered = renderTemplate({ noteNameFormat: '{{title|escape}}', path: 'Thread', noteContentFormat: '{{content}}', properties: [
      { name: 'authors', type: 'multitext', value: '{{author}}' }, { name: 'ai', value: '{{"summarize"}}' },
    ] }, page)
    expect(rendered.markdown).toContain('authors: ["Ada", "Bob"]')
    expect(rendered.markdown).not.toContain('ai:')
    expect(rendered.noteName).toBe('A &amp; B')
    expect(rendered).toMatchObject({ reasons: [], warnings: ['LLM式は実行しません'] })
  })
})
