import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLinkPreviewScreenshot, renderLinkPreviewScreenshotHtml } from '@/lib/link-preview-screenshot'

const cleanup: string[] = []

afterEach(async () => {
  delete process.env.SIFTLY_CHROME_PATH
  await Promise.all(cleanup.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })))
})

describe('リンクプレビュー画像用HTML', () => {
  it('外部ページのスクリプトやHTMLを実行可能な形で持ち込まない', () => {
    const html = renderLinkPreviewScreenshotHtml({
      url: 'https://example.com/article',
      html: '<body><script>alert(1)</script><p>安全な本文</p><img src="file:///etc/passwd"></body>',
      title: '<img src=x onerror=alert(1)>',
      description: '',
      siteName: 'Example',
    })

    expect(html).toContain('安全な本文')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('file:///etc/passwd')
    expect(html).not.toContain('alert(1)</script>')
  })

  it('同じURLの生成画像をローカルキャッシュから再利用する', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'siftly-link-preview-test-'))
    cleanup.push(root)
    const chrome = path.join(root, 'fake-chrome')
    const oldHome = process.env.HOME
    process.env.HOME = root
    process.env.SIFTLY_CHROME_PATH = chrome
    await fs.writeFile(chrome, '#!/bin/sh\nfor arg in "$@"; do case "$arg" in --screenshot=*) out="${arg#*=}";; esac; done\nprintf fake-png > "$out"\n')
    await fs.chmod(chrome, 0o755)
    const input = { url: 'https://cache.example/article', html: '<p>本文</p>', title: '記事', description: '', siteName: 'Example' }

    try {
      await expect(createLinkPreviewScreenshot(input)).resolves.toEqual(Buffer.from('fake-png'))
      await fs.rm(chrome)
      await expect(createLinkPreviewScreenshot(input)).resolves.toEqual(Buffer.from('fake-png'))
    } finally {
      process.env.HOME = oldHome
    }
  })
})
