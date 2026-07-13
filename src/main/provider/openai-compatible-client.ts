import type { ProviderCapabilities } from '../../shared/provider-contract'
import { ProviderServiceError } from './provider-error'
import {
  assertSafeProviderResolution,
  type ProviderDnsLookup,
  type ProviderEndpoint
} from './provider-url-policy'
import { OpenAiSseParser, type ParsedSseData } from './sse-parser'

export const STAGE_2_STREAM_TEST_MARKER = 'PBI_ASSISTANT_STAGE2_STREAM_OK'
export const STAGE_2_JSON_TEST_MARKER = 'PBI_ASSISTANT_STAGE2_JSON_OK'

const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_OUTPUT_CHARS = 16 * 1024
const MAX_JSON_RESPONSE_BYTES = 256 * 1024
const MAX_RETRIES = 2
const MAX_RETRY_WAIT_MS = 10_000

export interface ProviderClientInput {
  readonly endpoint: ProviderEndpoint
  readonly model: string
  readonly apiKey: string
}

export interface ProviderClientResult {
  readonly output: string
  readonly capabilities: ProviderCapabilities
}

export interface ProviderClientEvents {
  readonly onChunk: (delta: string) => void
  readonly onRetry: (attempt: number, waitMs: number) => void
  readonly onCapability: (
    capability: 'streaming' | 'json_mode',
    supported: boolean
  ) => void
}

export interface OpenAiCompatibleClientOptions {
  readonly fetch?: typeof fetch
  readonly dnsLookup?: ProviderDnsLookup
  readonly timeoutMs?: number
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function fixedStreamBody(model: string): string {
  return JSON.stringify({
    model,
    messages: [
      {
        role: 'system',
        content: '这是 Power BI 智能助手的连接测试。不要解释，也不要添加其他内容。'
      },
      { role: 'user', content: `只回复固定文本：${STAGE_2_STREAM_TEST_MARKER}` }
    ],
    stream: true,
    temperature: 0
  })
}

function fixedJsonBody(model: string): string {
  return JSON.stringify({
    model,
    messages: [
      {
        role: 'system',
        content: '这是 Power BI 智能助手的 JSON 能力测试。只输出一个 JSON 对象。'
      },
      {
        role: 'user',
        content: `只返回 {"status":"${STAGE_2_JSON_TEST_MARKER}"}`
      }
    ],
    response_format: { type: 'json_object' },
    stream: false,
    temperature: 0
  })
}

function retryWaitMs(response: Response, retryIndex: number): number {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.round(seconds * 1000), MAX_RETRY_WAIT_MS)
    }
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) {
      return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_WAIT_MS)
    }
  }
  return Math.min(500 * 2 ** retryIndex, MAX_RETRY_WAIT_MS)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function abortableResolution(
  endpoint: ProviderEndpoint,
  lookup: ProviderDnsLookup | undefined,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    void assertSafeProviderResolution(endpoint, lookup).then(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

function extractMessageContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new ProviderServiceError('MALFORMED_RESPONSE', true)
  }
  const choices = (payload as Record<string, unknown>).choices
  const first = Array.isArray(choices) ? choices[0] : undefined
  const message =
    first && typeof first === 'object'
      ? (first as Record<string, unknown>).message
      : undefined
  const content =
    message && typeof message === 'object'
      ? (message as Record<string, unknown>).content
      : undefined
  if (typeof content !== 'string') {
    throw new ProviderServiceError('MALFORMED_RESPONSE', true)
  }
  return content
}

export class OpenAiCompatibleProviderClient {
  private readonly fetchImpl: typeof fetch
  private readonly dnsLookup?: ProviderDnsLookup
  private readonly timeoutMs: number
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>

  constructor(options: OpenAiCompatibleClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.dnsLookup = options.dnsLookup
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.sleep = options.sleep ?? abortableSleep
  }

  async testConnection(
    input: ProviderClientInput,
    externalSignal: AbortSignal,
    events: ProviderClientEvents
  ): Promise<ProviderClientResult> {
    const controller = new AbortController()
    let timedOut = false
    const forwardAbort = (): void => controller.abort(externalSignal.reason)
    externalSignal.addEventListener('abort', forwardAbort, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)

    try {
      const output = await this.testStreaming(input, controller.signal, events)
      events.onCapability('streaming', true)
      const supportsJsonMode = await this.testJsonMode(input, controller.signal, events)
      events.onCapability('json_mode', supportsJsonMode)
      return {
        output,
        capabilities: { supportsStreaming: true, supportsJsonMode }
      }
    } catch (error) {
      if (timedOut) throw new ProviderServiceError('TIMEOUT', true)
      if (externalSignal.aborted || isAbortError(error)) {
        throw new ProviderServiceError('CANCELLED', false)
      }
      if (error instanceof ProviderServiceError) throw error
      throw new ProviderServiceError('NETWORK_ERROR', true)
    } finally {
      clearTimeout(timeout)
      externalSignal.removeEventListener('abort', forwardAbort)
    }
  }

  private async testStreaming(
    input: ProviderClientInput,
    signal: AbortSignal,
    events: ProviderClientEvents
  ): Promise<string> {
    const response = await this.requestWithRetry(
      input,
      fixedStreamBody(input.model),
      signal,
      events
    )
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('text/event-stream') || !response.body) {
      throw new ProviderServiceError('MALFORMED_STREAM', true)
    }

    const parser = new OpenAiSseParser()
    const decoder = new TextDecoder()
    let output = ''
    let byteCount = 0
    let sawDone = false

    const consume = (items: readonly ParsedSseData[]): void => {
      for (const item of items) {
        if (item.done) {
          sawDone = true
          continue
        }
        if (!item.delta) continue
        output += item.delta
        if (output.length > MAX_OUTPUT_CHARS) {
          throw new ProviderServiceError('RESPONSE_TOO_LARGE', false)
        }
        events.onChunk(item.delta)
      }
    }

    for await (const chunk of response.body) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      byteCount += chunk.byteLength
      if (byteCount > MAX_RESPONSE_BYTES) {
        throw new ProviderServiceError('RESPONSE_TOO_LARGE', false)
      }
      consume(parser.push(decoder.decode(chunk, { stream: true })))
      if (sawDone) break
    }
    consume(parser.push(decoder.decode()))
    consume(parser.finish())
    if (!sawDone || output.trim() !== STAGE_2_STREAM_TEST_MARKER) {
      throw new ProviderServiceError('MALFORMED_STREAM', true)
    }
    return output
  }

  private async testJsonMode(
    input: ProviderClientInput,
    signal: AbortSignal,
    events: ProviderClientEvents
  ): Promise<boolean> {
    let response: Response
    try {
      response = await this.requestWithRetry(
        input,
        fixedJsonBody(input.model),
        signal,
        events,
        true
      )
    } catch (error) {
      if (
        error instanceof ProviderServiceError &&
        error.httpStatus !== undefined &&
        [400, 404, 415, 422].includes(error.httpStatus)
      ) {
        return false
      }
      throw error
    }

    const body = await this.readBoundedText(response, MAX_JSON_RESPONSE_BYTES)
    try {
      const content = extractMessageContent(JSON.parse(body))
      const json = JSON.parse(content) as Record<string, unknown>
      return json.status === STAGE_2_JSON_TEST_MARKER
    } catch (error) {
      if (error instanceof ProviderServiceError && error.code !== 'MALFORMED_RESPONSE') {
        throw error
      }
      return false
    }
  }

  private async requestWithRetry(
    input: ProviderClientInput,
    body: string,
    signal: AbortSignal,
    events: ProviderClientEvents,
    allowUnsupportedJsonStatus = false
  ): Promise<Response> {
    for (let retryIndex = 0; retryIndex <= MAX_RETRIES; retryIndex += 1) {
      await abortableResolution(input.endpoint, this.dnsLookup, signal)
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      let response: Response
      try {
        response = await this.fetchImpl(input.endpoint.url, {
          method: 'POST',
          redirect: 'manual',
          cache: 'no-store',
          credentials: 'omit',
          headers: {
            Accept: 'application/json, text/event-stream',
            'Accept-Encoding': 'identity',
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json'
          },
          body,
          signal
        })
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw error
        throw new ProviderServiceError('NETWORK_ERROR', true)
      }

      if (response.status >= 300 && response.status < 400) {
        throw new ProviderServiceError('PROVIDER_REDIRECT_BLOCKED', false)
      }
      if (response.status === 401 || response.status === 403) {
        throw new ProviderServiceError('AUTH_FAILED', false, undefined, response.status)
      }
      const retryableStatus = response.status === 429 || response.status >= 500
      if (retryableStatus && retryIndex < MAX_RETRIES) {
        await response.body?.cancel().catch(() => undefined)
        const waitMs = retryWaitMs(response, retryIndex)
        events.onRetry(retryIndex + 2, waitMs)
        await this.sleep(waitMs, signal)
        continue
      }
      if (response.status === 429) {
        throw new ProviderServiceError('RATE_LIMITED', true, undefined, response.status)
      }
      if (response.status >= 500) {
        throw new ProviderServiceError(
          'PROVIDER_UNAVAILABLE',
          true,
          undefined,
          response.status
        )
      }
      if (!response.ok) {
        const code =
          allowUnsupportedJsonStatus
            ? 'MALFORMED_RESPONSE'
            : response.status >= 400 && response.status < 500
              ? 'PROVIDER_REQUEST_REJECTED'
              : 'NETWORK_ERROR'
        throw new ProviderServiceError(
          code,
          allowUnsupportedJsonStatus || code === 'NETWORK_ERROR',
          undefined,
          response.status
        )
      }
      return response
    }
    throw new ProviderServiceError('INTERNAL_ERROR', true)
  }

  private async readBoundedText(response: Response, maximumBytes: number): Promise<string> {
    if (!response.body) throw new ProviderServiceError('MALFORMED_RESPONSE', true)
    const decoder = new TextDecoder()
    let byteCount = 0
    let output = ''
    for await (const chunk of response.body) {
      byteCount += chunk.byteLength
      if (byteCount > maximumBytes) {
        throw new ProviderServiceError('RESPONSE_TOO_LARGE', false)
      }
      output += decoder.decode(chunk, { stream: true })
    }
    return output + decoder.decode()
  }
}
