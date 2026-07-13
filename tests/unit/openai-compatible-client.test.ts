import { describe, expect, it, vi } from 'vitest'
import {
  OpenAiCompatibleProviderClient,
  STAGE_2_JSON_TEST_MARKER,
  STAGE_2_STREAM_TEST_MARKER
} from '../../src/main/provider/openai-compatible-client'
import { validateProviderUrl } from '../../src/main/provider/provider-url-policy'

function streamResponse(text = STAGE_2_STREAM_TEST_MARKER): Response {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(0, 10) } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(10) } }] })}\n\n`,
    'data: [DONE]\n\n'
  ].join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function jsonResponse(): Response {
  return Response.json({
    choices: [
      { message: { content: JSON.stringify({ status: STAGE_2_JSON_TEST_MARKER }) } }
    ]
  })
}

function client(fetchMock: typeof fetch): OpenAiCompatibleProviderClient {
  return new OpenAiCompatibleProviderClient({
    fetch: fetchMock,
    dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }],
    sleep: async () => undefined,
    timeoutMs: 1000
  })
}

const input = {
  endpoint: validateProviderUrl('https://api.example.com/v1/chat/completions'),
  model: 'example-model',
  apiKey: 'secret-test-key'
}

const events = () => ({
  onChunk: vi.fn(),
  onRetry: vi.fn(),
  onCapability: vi.fn()
})

describe('OpenAI-compatible Provider connection client', () => {
  it('sends only fixed stage 2 probes and parses streaming plus JSON mode', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(streamResponse())
      .mockResolvedValueOnce(jsonResponse())
    const eventSink = events()
    const result = await client(fetchMock).testConnection(
      input,
      new AbortController().signal,
      eventSink
    )

    expect(result).toEqual({
      output: STAGE_2_STREAM_TEST_MARKER,
      capabilities: { supportsStreaming: true, supportsJsonMode: true }
    })
    expect(eventSink.onChunk.mock.calls.flat().join('')).toBe(STAGE_2_STREAM_TEST_MARKER)
    expect(eventSink.onCapability).toHaveBeenCalledWith('streaming', true)
    expect(eventSink.onCapability).toHaveBeenCalledWith('json_mode', true)

    const requestBodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    expect(JSON.stringify(requestBodies)).toContain(STAGE_2_STREAM_TEST_MARKER)
    expect(JSON.stringify(requestBodies)).toContain(STAGE_2_JSON_TEST_MARKER)
    expect(JSON.stringify(requestBodies)).not.toContain('销售事实')
    expect(JSON.stringify(requestBodies)).not.toContain('ModelSnapshot')
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('manual')
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer secret-test-key'
    )
  })

  it('retries 429 and 5xx at most twice and reports the wait state', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(streamResponse())
      .mockResolvedValueOnce(jsonResponse())
    const eventSink = events()

    await expect(
      client(fetchMock).testConnection(input, new AbortController().signal, eventSink)
    ).resolves.toMatchObject({ capabilities: { supportsStreaming: true } })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(eventSink.onRetry).toHaveBeenNthCalledWith(1, 2, 0)
    expect(eventSink.onRetry).toHaveBeenNthCalledWith(2, 3, 1000)
  })

  it('never retries 401/403 and blocks redirects', async () => {
    for (const status of [401, 403, 302]) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }))
      await expect(
        client(fetchMock).testConnection(input, new AbortController().signal, events())
      ).rejects.toMatchObject({
        code: status === 302 ? 'PROVIDER_REDIRECT_BLOCKED' : 'AUTH_FAILED'
      })
      expect(fetchMock).toHaveBeenCalledOnce()
    }
  })

  it.each([400, 404, 405, 415, 422])(
    'classifies HTTP %s as a rejected Provider request without retrying',
    async (status) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }))
      const eventSink = events()

      await expect(
        client(fetchMock).testConnection(input, new AbortController().signal, eventSink)
      ).rejects.toMatchObject({
        code: 'PROVIDER_REQUEST_REJECTED',
        retryable: false,
        httpStatus: status
      })
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(eventSink.onRetry).not.toHaveBeenCalled()
    }
  )

  it('keeps transport failures distinct from rejected HTTP requests', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('diagnostic transport failure'))

    await expect(
      client(fetchMock).testConnection(input, new AbortController().signal, events())
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true })
  })

  it('rejects a non-marker stream and oversized responses', async () => {
    const wrongMarkerFetch = vi.fn<typeof fetch>().mockResolvedValue(streamResponse('unexpected'))
    await expect(
      client(wrongMarkerFetch).testConnection(input, new AbortController().signal, events())
    ).rejects.toMatchObject({ code: 'MALFORMED_STREAM' })

    const oversizedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('x'.repeat(1024 * 1024 + 1), {
        headers: { 'content-type': 'text/event-stream' }
      })
    )
    await expect(
      client(oversizedFetch).testConnection(input, new AbortController().signal, events())
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('records malformed JSON mode output as unsupported without failing streaming', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(streamResponse())
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: 'not-json' } }] })
      )

    await expect(
      client(fetchMock).testConnection(input, new AbortController().signal, events())
    ).resolves.toMatchObject({
      capabilities: { supportsStreaming: true, supportsJsonMode: false }
    })
  })

  it('records an unsupported JSON mode HTTP status without failing streaming', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(streamResponse())
      .mockResolvedValueOnce(new Response('', { status: 400 }))

    await expect(
      client(fetchMock).testConnection(input, new AbortController().signal, events())
    ).resolves.toMatchObject({
      capabilities: { supportsStreaming: true, supportsJsonMode: false }
    })
  })

  it('cancels an in-flight request without producing another attempt', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<typeof fetch>((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    )
    const pending = client(fetchMock).testConnection(input, controller.signal, events())
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('enforces the overall timeout even when DNS lookup never settles', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const timeoutClient = new OpenAiCompatibleProviderClient({
      fetch: fetchMock,
      dnsLookup: () => new Promise(() => undefined),
      timeoutMs: 20
    })

    await expect(
      timeoutClient.testConnection(input, new AbortController().signal, events())
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
