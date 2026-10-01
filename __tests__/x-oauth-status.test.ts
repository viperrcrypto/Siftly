import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }))

vi.mock('@/lib/db', () => ({ default: { setting: { findUnique: mocks.findUnique } } }))

import { GET } from '@/app/api/import/x-oauth/status/route'

describe('X OAuth status', () => {
  beforeEach(() => {
    mocks.findUnique.mockReset()
  })

  it('アクセストークン期限切れでも修復操作を表示できる接続状態を返す', async () => {
    const values = new Map([
      ['x_oauth_client_id', { value: 'client-id' }],
      ['x_oauth_access_token', { value: 'expired-token' }],
      ['x_oauth_token_expiry', { value: String(Date.now() - 1_000) }],
      ['x_oauth_user_name', { value: 'ユーザー' }],
      ['x_oauth_user_username', { value: 'user' }],
      ['x_oauth_user_id', { value: '123' }],
    ])
    mocks.findUnique.mockImplementation(({ where }: { where: { key: string } }) => Promise.resolve(values.get(where.key) ?? null))

    const response = await GET()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      connected: true,
      tokenExpired: true,
      user: { username: 'user' },
    })
  })

  it('アクセストークンがない場合は未接続のままにする', async () => {
    mocks.findUnique.mockResolvedValue(null)

    const response = await GET()
    await expect(response.json()).resolves.toMatchObject({
      configured: false,
      connected: false,
      tokenExpired: false,
      user: null,
    })
  })
})
