const URL_REGEX = /https?:\/\/[^\s<>"'）】」]+/g
const TRAILING_PUNCTUATION = /[.,!?;:)}\]、。！？]+$/

function isXInternalUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^www\./, '')
    return host === 'x.com' || host === 'twitter.com'
  } catch {
    return true
  }
}

/** X本文からプレビュー対象URLを抽出する。t.coを優先し、最大3件に抑える。 */
export function extractLinkPreviewUrls(text: string): string[] {
  const urls = [...new Set((text.match(URL_REGEX) ?? []).map((url) => url.replace(TRAILING_PUNCTUATION, '')))]
  const shortUrls = urls.filter((url) => { try { return new URL(url).hostname === 't.co' } catch { return false } })
  return (shortUrls.length ? shortUrls : urls.filter((url) => !isXInternalUrl(url))).slice(0, 3)
}
