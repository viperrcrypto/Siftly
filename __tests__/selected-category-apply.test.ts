import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  db: {
    bookmark: { findMany: vi.fn(), count: vi.fn() },
    category: { findMany: vi.fn() },
    setting: { findUnique: vi.fn(), upsert: vi.fn() },
  },
  categorizeBatch: vi.fn(),
  writeCategoryResults: vi.fn(),
  seedDefaultCategories: vi.fn(),
  backfillEntities: vi.fn(),
  rebuildFts: vi.fn(),
  analyzeItem: vi.fn(),
  enrichBatchSemanticTags: vi.fn(),
  resolveAIClient: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ default: mocks.db }))
vi.mock('@/lib/categorizer', () => ({
  BOOKMARK_SELECT: { id: true },
  categorizeBatch: mocks.categorizeBatch,
  writeCategoryResults: mocks.writeCategoryResults,
  seedDefaultCategories: mocks.seedDefaultCategories,
  mapBookmarkForCategorization: (bookmark: { tweetId: string }) => ({ tweetId: bookmark.tweetId }),
}))
vi.mock('@/lib/settings', () => ({ getProvider: vi.fn().mockResolvedValue('openai'), getActiveModel: vi.fn() }))
vi.mock('@/lib/ai-client', () => ({ resolveAIClient: mocks.resolveAIClient }))
vi.mock('@/lib/vision-analyzer', () => ({
  analyzeItem: mocks.analyzeItem,
  runWithConcurrency: vi.fn(async (tasks: (() => Promise<unknown>)[]) => Promise.all(tasks.map((task) => task()))),
  enrichBatchSemanticTags: mocks.enrichBatchSemanticTags,
}))
vi.mock('@/lib/rawjson-extractor', () => ({ backfillEntities: mocks.backfillEntities }))
vi.mock('@/lib/fts', () => ({ rebuildFts: mocks.rebuildFts }))

describe('選択範囲のカテゴリ再分類', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.db.bookmark.findMany.mockResolvedValue([{ id: 'bookmark-1', tweetId: 'tweet-1' }])
    mocks.db.bookmark.count.mockResolvedValue(0)
    mocks.db.category.findMany.mockResolvedValue([{ slug: 'dev-tools', name: 'Dev tools', description: null }])
    mocks.db.setting.findUnique.mockResolvedValue(null)
    mocks.resolveAIClient.mockResolvedValue(null)
    mocks.categorizeBatch.mockResolvedValue([{ tweetId: 'tweet-1', assignments: [{ category: 'dev-tools', confidence: 0.9 }] }])
    mocks.writeCategoryResults.mockResolvedValue(['bookmark-1'])
    mocks.backfillEntities.mockResolvedValue(0)
    mocks.rebuildFts.mockResolvedValue(undefined)
  })

  async function route() { return import('@/app/api/categorize/route') }
  async function post(body: unknown) {
    const { POST } = await route()
    return POST(new Request('http://localhost/api/categorize', { method: 'POST', body: JSON.stringify(body) }) as never)
  }
  async function waitForIdle() {
    const { GET } = await route()
    await vi.waitFor(async () => expect((await GET()).status).toBe(200))
    await vi.waitFor(async () => expect((await (await GET()).json()).status).toBe('idle'))
    return (await (await GET()).json()) as {
      status: string
      error: string | null
      runId: string | null
      done: number
      total: number
      stageCounts: { categorized: number }
    }
  }

  it.each([null, [], 'body', { categoryOnly: 'true', bookmarkIds: ['bookmark-1'] }, { force: 'true' }, { apiKey: 1 }])('不正JSON本体・strict型を400で拒否する: %j', async (body) => {
    const response = await post(body)
    expect(response.status).toBe(400)
    expect(mocks.db.bookmark.findMany).not.toHaveBeenCalled()
  })

  it.each([{ force: true }, { apiKey: 'key' }])('categoryOnlyとのforce/apiKey併用を拒否する: %j', async (extra) => {
    const response = await post({ categoryOnly: true, bookmarkIds: ['bookmark-1'], ...extra })
    expect(response.status).toBe(400)
  })

  it('選択対象が不足すると書込みを始めない', async () => {
    mocks.db.bookmark.findMany.mockResolvedValue([])
    const response = await post({ categoryOnly: true, bookmarkIds: ['bookmark-1'] })
    expect(response.status).toBe(404)
    expect(mocks.categorizeBatch).not.toHaveBeenCalled()
  })

  it('選択tweetId→bookmarkId mapだけをwriterへ渡し、補助pipelineを実行しない', async () => {
    const response = await post({ categoryOnly: true, bookmarkIds: ['bookmark-1'] })
    expect(response.status).toBe(200)
    await waitForIdle()
    expect(mocks.writeCategoryResults).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      bookmarkByTweetId: expect.any(Map), replaceAiCategories: true, updateEnrichedAt: false,
    }))
    const options = mocks.writeCategoryResults.mock.calls[0][1] as { bookmarkByTweetId: Map<string, string> }
    expect([...options.bookmarkByTweetId]).toEqual([['tweet-1', 'bookmark-1']])
    expect(mocks.seedDefaultCategories).not.toHaveBeenCalled()
    expect(mocks.backfillEntities).not.toHaveBeenCalled()
    expect(mocks.rebuildFts).not.toHaveBeenCalled()
    expect(mocks.analyzeItem).not.toHaveBeenCalled()
    expect(mocks.enrichBatchSemanticTags).not.toHaveBeenCalled()
  })

  it.each([
    { results: [] },
    { results: [{ tweetId: 'tweet-1', assignments: [] }] },
    { results: [{ tweetId: 'tweet-1', assignments: [{ category: 'dev-tools', confidence: 0.9 }] }, { tweetId: 'tweet-1', assignments: [{ category: 'dev-tools', confidence: 0.9 }] }] },
    { results: [{ tweetId: 'outside', assignments: [{ category: 'dev-tools', confidence: 0.9 }] }] },
  ])('missing・empty・duplicate・範囲外AI結果はwriterを呼ばずerrorを可視化する', async ({ results }) => {
    mocks.categorizeBatch.mockResolvedValue(results)
    const response = await post({ categoryOnly: true, bookmarkIds: ['bookmark-1'] })
    expect(response.status).toBe(200)
    const started = await response.json() as { runId: string }
    const state = await waitForIdle()
    expect(mocks.writeCategoryResults).not.toHaveBeenCalled()
    expect(state.error).toContain('AI response did not contain')
    expect(state.runId).toBe(started.runId)
  })

  it('成功時のdone・total・categorizedを実際の保存数で返す', async () => {
    await post({ categoryOnly: true, bookmarkIds: ['bookmark-1'] })
    const state = await waitForIdle()

    expect(state).toMatchObject({ status: 'idle', done: 1, total: 1, stageCounts: { categorized: 1 }, error: null })
  })

  it('分類結果が一部だけ保存された場合もdoneとcategorizedを分けて返す', async () => {
    mocks.db.bookmark.findMany.mockResolvedValue([
      { id: 'bookmark-1', tweetId: 'tweet-1' },
      { id: 'bookmark-2', tweetId: 'tweet-2' },
    ])
    mocks.categorizeBatch.mockResolvedValue([
      { tweetId: 'tweet-1', assignments: [{ category: 'dev-tools', confidence: 0.9 }] },
    ])
    mocks.writeCategoryResults.mockResolvedValue(['bookmark-1'])

    await post({ categoryOnly: true, bookmarkIds: ['bookmark-1', 'bookmark-2'] })
    const state = await waitForIdle()

    expect(state).toMatchObject({
      status: 'idle', done: 2, total: 2, stageCounts: { categorized: 1 },
    })
    expect(state.error).toContain('1 selected bookmarks remain unclassified')
  })

  it('処理開始前の失敗でdoneをtotalまで水増ししない', async () => {
    mocks.db.setting.findUnique.mockRejectedValueOnce(new Error('settings unavailable'))

    await post({ categoryOnly: true, bookmarkIds: ['bookmark-1'] })
    const state = await waitForIdle()

    expect(state).toMatchObject({ done: 0, total: 1, stageCounts: { categorized: 0 } })
    expect(state.error).toContain('settings unavailable')
  })

  it('停止中も進行中batchの有効結果を保存してから正しい件数で停止する', async () => {
    let resolveBatch!: (results: { tweetId: string; assignments: { category: string; confidence: number }[] }[]) => void
    mocks.categorizeBatch.mockReturnValueOnce(new Promise((resolve) => { resolveBatch = resolve }))

    const response = await post({ categoryOnly: true, bookmarkIds: ['bookmark-1'] })
    const started = await response.json() as { runId: string }
    await vi.waitFor(() => expect(mocks.categorizeBatch).toHaveBeenCalled())
    const { DELETE } = await route()
    await DELETE()
    resolveBatch([{ tweetId: 'tweet-1', assignments: [{ category: 'dev-tools', confidence: 0.9 }] }])

    const state = await waitForIdle()
    expect(state).toMatchObject({
      status: 'idle', runId: started.runId, done: 1, total: 1, stageCounts: { categorized: 1 }, error: 'Stopped by user',
    })
    expect(mocks.writeCategoryResults).toHaveBeenCalledTimes(1)
  })

  it('未分類bookmarkが0件なら0/0・idleで正常終了する', async () => {
    mocks.db.bookmark.findMany.mockResolvedValue([])
    mocks.backfillEntities.mockResolvedValue(0)

    const response = await post({ force: false })
    await response.json()
    const state = await waitForIdle()

    expect(state).toMatchObject({
      status: 'idle', done: 0, total: 0, stageCounts: { categorized: 0 }, error: null,
    })
  })

  it('通常分類が処理前に失敗したらdoneを実件数に合わせる', async () => {
    mocks.db.bookmark.count.mockResolvedValue(1)
    mocks.seedDefaultCategories.mockRejectedValueOnce(new Error('category setup failed'))

    await post({ force: false })
    const state = await waitForIdle()

    expect(state).toMatchObject({ done: 0, total: 1, stageCounts: { categorized: 0 } })
    expect(state.error).toContain('category setup failed')
  })
})
