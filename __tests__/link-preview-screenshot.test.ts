import { describe, expect, it } from 'vitest'
import { renderLinkPreviewScreenshotHtml } from '@/lib/link-preview-screenshot'

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
})
