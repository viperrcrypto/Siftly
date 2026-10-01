const MAX_THREAD_CONTEXT = 2_000

type ThreadTweet = { id?: unknown; text?: unknown }

/** Stored OAuth/gallery thread text used as bounded context for AI processing. */
export function threadContextFromArchive(resultJson: string | null | undefined, rootText: string): string {
  const parts = [rootText.trim()]
  if (resultJson) {
    try {
      const result = JSON.parse(resultJson) as { thread?: { tweets?: unknown } }
      const tweets = Array.isArray(result.thread?.tweets) ? result.thread.tweets as ThreadTweet[] : []
      for (const tweet of tweets) {
        const text = typeof tweet.text === 'string' ? tweet.text.trim() : ''
        if (text && text !== rootText.trim()) parts.push(text)
      }
    } catch { /* malformed historical archive data is ignored */ }
  }
  return parts.join('\n').slice(0, MAX_THREAD_CONTEXT)
}
