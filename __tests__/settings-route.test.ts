import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(), deleteMany: vi.fn(), transaction: vi.fn(), invalidate: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ default: {
  $transaction: mocks.transaction,
  setting: { upsert: mocks.upsert, deleteMany: mocks.deleteMany },
} }))
vi.mock('@/lib/settings', () => ({ invalidateSettingsCache: mocks.invalidate }))
vi.mock('@/lib/obsidian-exporter', () => ({ validateVaultPath: vi.fn() }))
vi.mock('@/lib/archive/gallery-dl', () => ({ validateGallerySettings: vi.fn() }))

import { POST } from '@/app/api/settings/route'

describe('Settings POST', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.upsert.mockReset()
    mocks.deleteMany.mockReset()
    mocks.transaction.mockReset().mockImplementation((fn: (tx: { setting: { upsert: typeof mocks.upsert; deleteMany: typeof mocks.deleteMany } }) => unknown) => fn({ setting: { upsert: mocks.upsert, deleteMany: mocks.deleteMany } }))
  })

  it('後半項目が不正なら、先行した設定を保存しない', async () => {
    const response = await POST(new Request('http://localhost/api/settings', {
      method: 'POST', body: JSON.stringify({ provider: 'openai', openaiModel: 'not-allowed' }),
    }) as never)

    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid OpenAI model' })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('有効な複数項目を同一transactionで保存する', async () => {
    const response = await POST(new Request('http://localhost/api/settings', {
      method: 'POST', body: JSON.stringify({ provider: 'openai', openaiModel: 'gpt-4.1-mini' }),
    }) as never)

    await expect(response.json()).resolves.toEqual({ saved: true })
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.upsert).toHaveBeenCalledTimes(2)
  })

  it('認証方式とCLIモデルをAPIモデルから分離して保存する', async () => {
    const response = await POST(new Request('http://localhost/api/settings', {
      method: 'POST',
      body: JSON.stringify({ openaiAuthMode: 'cli', codexCliModel: '' }),
    }) as never)

    await expect(response.json()).resolves.toEqual({ saved: true })
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { key: 'openaiAuthMode' },
      update: { value: 'cli' },
      create: { key: 'openaiAuthMode', value: 'cli' },
    })
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { key: 'codexCliModel' },
      update: { value: '' },
      create: { key: 'codexCliModel', value: '' },
    })
  })

  it('未知の認証方式を拒否する', async () => {
    const response = await POST(new Request('http://localhost/api/settings', {
      method: 'POST',
      body: JSON.stringify({ openaiAuthMode: 'auto' }),
    }) as never)

    await expect(response.json()).resolves.toEqual({ error: 'Invalid openaiAuthMode' })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
