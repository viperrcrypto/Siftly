import { describe, expect, it } from 'vitest'
import { threadContextFromArchive } from '@/lib/thread-context'

describe('保存済みスレッドのAI文脈', () => {
  it('ルートと自己返信を上限付きで連結する', () => {
    const result = threadContextFromArchive(JSON.stringify({ thread: { tweets: [
      { id: '1', text: 'root' }, { id: '2', text: 'reply' }, { id: '3', text: 'quote' },
    ] } }), 'root')
    expect(result).toBe('root\nreply\nquote')
  })

  it('壊れた保存データではルートだけ返す', () => {
    expect(threadContextFromArchive('{', 'root')).toBe('root')
  })
})
