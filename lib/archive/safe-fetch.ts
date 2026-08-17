import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

const MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT = 12_000

function blockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase()
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || a === 240 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0)
  }
  if (net.isIP(ip) === 6) return blockedIpv6(ip)
  return true
}

function ipv6Groups(value: string): number[] | null {
  const dotted = value.lastIndexOf(':')
  let normalized = value
  if (dotted >= 0 && value.slice(dotted + 1).includes('.')) {
    const octets = value.slice(dotted + 1).split('.').map(Number)
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    normalized = `${value.slice(0, dotted)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const [left, right] = normalized.split('::')
  if (normalized.split('::').length > 2) return null
  const head = left ? left.split(':').filter(Boolean).map((part) => Number.parseInt(part, 16)) : []
  const tail = right ? right.split(':').filter(Boolean).map((part) => Number.parseInt(part, 16)) : []
  if ([...head, ...tail].some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return null
  if (normalized.includes('::')) {
    const zeros = 8 - head.length - tail.length
    return zeros < 1 ? null : [...head, ...Array(zeros).fill(0), ...tail]
  }
  return head.length === 8 ? head : null
}

function blockedIpv6(value: string): boolean {
  const groups = ipv6Groups(value)
  if (!groups) return true
  // IPv4-mapped addresses must pass the exact same policy as an IPv4 literal.
  if (groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff) {
    return blockedAddress(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`)
  }
  const first = groups[0]
  if (groups.every((part) => part === 0) || (groups.slice(0, 7).every((part) => part === 0) && groups[7] === 1)) return true
  // IPv4-compatible, ULA, link-local, multicast and every non-2000::/3 range are non-global.
  if (groups.slice(0, 6).every((part) => part === 0) || (first & 0xfe00) === 0xfc00 || (first >= 0xfe80 && first <= 0xfebf) || (first & 0xff00) === 0xff00) return true
  if ((first & 0xe000) !== 0x2000) return true
  // Documentation, Teredo, ORCHID and 6to4 are not acceptable server-side targets.
  if ((first === 0x2001 && (groups[1] === 0 || (groups[1] >= 0x10 && groups[1] <= 0x1f) || groups[1] === 0x0db8)) || first === 0x2002) return true
  return false
}

export function isSafeHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username && !url.password &&
      (!url.port || url.port === '80' || url.port === '443') &&
      (net.isIP(host) === 0 || !blockedAddress(host))
  } catch { return false }
}

async function resolvedAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  if (net.isIP(hostname)) {
    if (blockedAddress(hostname)) throw new Error('Blocked network address')
    return { address: hostname, family: net.isIP(hostname) as 4 | 6 }
  }
  const answers = await dns.lookup(hostname, { all: true, verbatim: true })
  if (!answers.length || answers.some((answer) => blockedAddress(answer.address))) {
    throw new Error('Blocked network address')
  }
  return answers[0] as { address: string; family: 4 | 6 }
}

export interface SafeFetchResult {
  url: string
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
  truncated: boolean
}

export async function safeFetch(raw: string, options: {
  maxBytes?: number
  timeoutMs?: number
  accept?: string
  redirects?: number
  signal?: AbortSignal
  /** Return the first maxBytes rather than failing when a response is larger. */
  truncate?: boolean
} = {}): Promise<SafeFetchResult> {
  if (!isSafeHttpUrl(raw)) throw new Error('Invalid URL')
  const maxBytes = options.maxBytes ?? 2_000_000
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const deadlineAt = Date.now() + timeoutMs
  const controller = new AbortController()
  const deadlineError = () => new Error('Request deadline exceeded')
  const abortForDeadline = () => {
    if (!controller.signal.aborted) controller.abort(deadlineError())
  }
  const deadlineTimer = setTimeout(abortForDeadline, Math.max(0, deadlineAt - Date.now()))
  const abort = () => controller.abort(options.signal?.reason ?? new Error('Request aborted'))
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  const deadline = () => {
    if (Date.now() >= deadlineAt) abortForDeadline()
    if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : deadlineError()
  }
  let current = new URL(raw)
  const redirects = options.redirects ?? MAX_REDIRECTS

  try { for (let hop = 0; hop <= redirects; hop++) {
    deadline()
    let onDnsAbort: () => void = () => undefined
    const dnsAbort = new Promise<never>((_resolve, reject) => {
      const listener = () => reject(controller.signal.reason ?? deadlineError())
      onDnsAbort = listener
      controller.signal.addEventListener('abort', listener, { once: true })
    })
    let target: { address: string; family: 4 | 6 }
    try {
      target = await Promise.race([resolvedAddress(current.hostname), dnsAbort])
    } finally {
      controller.signal.removeEventListener('abort', onDnsAbort)
    }
    deadline()
    const transport = current.protocol === 'https:' ? https : http
    const result = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }>((resolve, reject) => {
      let settled = false
      let response: http.IncomingMessage | undefined
      const settleResolve = (value: { status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }
      const settleReject = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const onRequestError = (error: Error) => settleReject(error)
      const onResponseError = (error: Error) => settleReject(error)
      const onAbort = () => {
        request.destroy()
        settleReject(controller.signal.reason instanceof Error ? controller.signal.reason : deadlineError())
      }
      const onData = (chunk: Buffer) => {
        if (Date.now() >= deadlineAt) {
          abortForDeadline()
          return
        }
        if (controller.signal.aborted) return
        size += chunk.length
        if (size > maxBytes) {
          if (options.truncate) {
            const overflow = size - maxBytes
            const kept = chunk.subarray(0, chunk.length - overflow)
            if (kept.length) chunks.push(kept)
            response?.destroy()
            request.destroy()
            settleResolve({ status: response?.statusCode ?? 0, headers: response?.headers ?? {}, body: Buffer.concat(chunks), truncated: true })
            return
          }
          request.destroy()
          settleReject(new Error('Response too large'))
          return
        }
        chunks.push(chunk)
      }
      const onEnd = () => {
        if (Date.now() >= deadlineAt) {
          abortForDeadline()
          return
        }
        if (controller.signal.aborted) return
        settleResolve({ status: response?.statusCode ?? 0, headers: response?.headers ?? {}, body: Buffer.concat(chunks), truncated: false })
      }
      const cleanup = () => {
        controller.signal.removeEventListener('abort', onAbort)
        request.removeListener('error', onRequestError)
        response?.removeListener('data', onData)
        response?.removeListener('end', onEnd)
        response?.removeListener('error', onResponseError)
      }
      const chunks: Buffer[] = []
      let size = 0
      const request = transport.request(current, {
        method: 'GET',
        headers: { 'User-Agent': 'Siftly Archive/1.0', Accept: options.accept ?? '*/*' },
        lookup: (_host, options, callback) => {
          if (options.all) {
            callback(null, [target])
            return
          }
          callback(null, target.address, target.family)
        },
      }, (incoming) => {
        if (settled) {
          incoming.resume()
          return
        }
        response = incoming
        incoming.on('data', onData)
        incoming.once('end', onEnd)
        incoming.once('error', onResponseError)
      })
      controller.signal.addEventListener('abort', onAbort, { once: true })
      request.once('error', onRequestError)
      request.end()
    })
    if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
      if (hop === redirects) throw new Error('Too many redirects')
      current = new URL(result.headers.location, current)
      if (!isSafeHttpUrl(current.toString())) throw new Error('Unsafe redirect')
      deadline()
      continue
    }
    return { ...result, url: current.toString() }
  } throw new Error('Too many redirects') } finally {
    clearTimeout(deadlineTimer)
    options.signal?.removeEventListener('abort', abort)
  }
}

export function allowedXMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && ['pbs.twimg.com', 'video.twimg.com', 'ton.twimg.com'].includes(url.hostname)
  } catch { return false }
}
