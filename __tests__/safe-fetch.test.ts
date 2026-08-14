import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({ default: { lookup: mocks.lookup } }))
vi.mock('node:http', () => ({ default: { request: mocks.request } }))

import { isSafeHttpUrl, safeFetch } from '@/lib/archive/safe-fetch'

type FakeResponse = EventEmitter & {
  statusCode?: number
  headers: Record<string, string>
  resume: () => void
  destroy: () => void
}

function response(statusCode = 200, headers: Record<string, string> = {}): FakeResponse {
  return Object.assign(new EventEmitter(), { statusCode, headers, resume: vi.fn(), destroy: vi.fn() })
}

function request(onEnd: () => void) {
  return Object.assign(new EventEmitter(), { end: onEnd, destroy: vi.fn() })
}

describe('safeFetch deadline boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('DNS前に不正URLを拒否しHTTPを開始しない', async () => {
    await expect(safeFetch('http://127.0.0.1/', { timeoutMs: 1 })).rejects.toThrow('Invalid URL')
  })
  it('呼び出し元AbortSignalを総deadlineへ伝播する', async () => {
    const controller = new AbortController()
    controller.abort(new Error('deadline'))
    await expect(safeFetch('https://example.com/', { signal: controller.signal })).rejects.toThrow('deadline')
  })
  it('公開URLはDNS検査へ進める', () => expect(isSafeHttpUrl('https://example.com/')).toBe(true))

  it('DNS待機中でも総deadlineで失敗しHTTPを開始しない', async () => {
    mocks.lookup.mockImplementation(() => new Promise(() => undefined))

    const pending = safeFetch('http://example.com/', { timeoutMs: 100 })
    const expected = expect(pending).rejects.toThrow('Request deadline exceeded')
    await vi.advanceTimersByTimeAsync(100)

    await expected
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('低速に到着し続ける応答も総deadlineで破棄する', async () => {
    const fakeRequest = request(() => {
      const fakeResponse = response()
      mocks.request.mock.calls[0]?.[2](fakeResponse)
      for (const delay of [10, 20, 30, 40]) {
        setTimeout(() => fakeResponse.emit('data', Buffer.from('a')), delay)
      }
    })
    mocks.request.mockReturnValue(fakeRequest)

    const pending = safeFetch('http://example.com/', { timeoutMs: 50 })
    const expected = expect(pending).rejects.toThrow('Request deadline exceeded')
    await vi.advanceTimersByTimeAsync(50)

    await expected
    expect(fakeRequest.destroy).toHaveBeenCalledTimes(1)
  })

  it('HTTP接続中の外部Abortはrequestを一度だけ破棄し、次hopを開始しない', async () => {
    const controller = new AbortController()
    const fakeRequest = request(() => {
      mocks.request.mock.calls[0]?.[2](response())
    })
    mocks.request.mockReturnValue(fakeRequest)

    const pending = safeFetch('http://example.com/', { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new Error('caller cancelled'))

    await expect(pending).rejects.toThrow('caller cancelled')
    expect(fakeRequest.destroy).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('deadline時刻後のresponse endは成功として解決しない', async () => {
    const fakeRequest = request(() => {
      const fakeResponse = response()
      mocks.request.mock.calls[0]?.[2](fakeResponse)
      setTimeout(() => fakeResponse.emit('end'), 50)
    })
    mocks.request.mockReturnValue(fakeRequest)

    const pending = safeFetch('http://example.com/', { timeoutMs: 50 })
    const expected = expect(pending).rejects.toThrow('Request deadline exceeded')
    await vi.advanceTimersByTimeAsync(50)

    await expected
    expect(fakeRequest.destroy).toHaveBeenCalledTimes(1)
  })

  it('deadline前に完了した応答を返し、後続のtimerで破棄しない', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const fakeRequest = request(() => {
      const fakeResponse = response()
      mocks.request.mock.calls[0]?.[2](fakeResponse)
      setTimeout(() => fakeResponse.emit('data', Buffer.from('ok')), 10)
      setTimeout(() => fakeResponse.emit('end'), 20)
    })
    mocks.request.mockReturnValue(fakeRequest)

    try {
      const pending = safeFetch('http://example.com/', { timeoutMs: 50 })
      await vi.advanceTimersByTimeAsync(20)

      await expect(pending).resolves.toMatchObject({ body: Buffer.from('ok') })
      await vi.advanceTimersByTimeAsync(100)
      await Promise.resolve()
      expect(fakeRequest.destroy).not.toHaveBeenCalled()
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.removeListener('unhandledRejection', unhandled)
    }
  })

  it('既定のstrictモードでは上限超過を失敗にする', async () => {
    const fakeRequest = request(() => {
      const fakeResponse = response()
      mocks.request.mock.calls[0]?.[2](fakeResponse)
      fakeResponse.emit('data', Buffer.from('toolarge'))
    })
    mocks.request.mockReturnValue(fakeRequest)

    await expect(safeFetch('http://example.com/', { maxBytes: 3 })).rejects.toThrow('Response too large')
    expect(fakeRequest.destroy).toHaveBeenCalledTimes(1)
  })

  it('truncateモードでは上限まで返し接続を停止する', async () => {
    const fakeRequest = request(() => {
      const fakeResponse = response()
      mocks.request.mock.calls[0]?.[2](fakeResponse)
      fakeResponse.emit('data', Buffer.from('toolarge'))
    })
    mocks.request.mockReturnValue(fakeRequest)

    await expect(safeFetch('http://example.com/', { maxBytes: 3, truncate: true })).resolves.toMatchObject({ body: Buffer.from('too'), truncated: true })
    expect(fakeRequest.destroy).toHaveBeenCalledTimes(1)
  })

  it('redirect後のDNSが残り予算を使い切っても次のHTTPを開始しない', async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockImplementationOnce(() => new Promise(() => undefined))
    const fakeRequest = request(() => {
      const fakeResponse = response(302, { location: 'http://redirect.example/' })
      mocks.request.mock.calls[0]?.[2](fakeResponse)
      setTimeout(() => fakeResponse.emit('end'), 40)
    })
    mocks.request.mockReturnValue(fakeRequest)

    const pending = safeFetch('http://example.com/', { timeoutMs: 50 })
    const expected = expect(pending).rejects.toThrow('Request deadline exceeded')
    await vi.advanceTimersByTimeAsync(50)

    await expected
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
})
