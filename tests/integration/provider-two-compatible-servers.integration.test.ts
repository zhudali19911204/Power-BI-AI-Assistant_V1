import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OpenAiCompatibleProviderClient,
  STAGE_2_JSON_TEST_MARKER,
  STAGE_2_STREAM_TEST_MARKER
} from '../../src/main/provider/openai-compatible-client'
import { validateProviderUrl } from '../../src/main/provider/provider-url-policy'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve()))
    )
  )
})

async function startCompatibleServer(
  dialect: 'crlf' | 'usage-chunk'
): Promise<{ readonly url: string; readonly bodies: Record<string, unknown>[] }> {
  const bodies: Record<string, unknown>[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      expect(request.method).toBe('POST')
      expect(request.headers.authorization).toBe('Bearer integration-secret')
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
        string,
        unknown
      >
      bodies.push(body)

      if (body.stream === true) {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
        const separator = dialect === 'crlf' ? '\r\n\r\n' : '\n\n'
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'PBI_ASSISTANT_' } }] })}${separator}`
        )
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'STAGE2_STREAM_OK' } }] })}${separator}`
        )
        if (dialect === 'usage-chunk') {
          response.write(
            `data: ${JSON.stringify({ choices: [], usage: { total_tokens: 5 } })}${separator}`
          )
        }
        response.end(`data: [DONE]${separator}`)
        return
      }

      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ status: STAGE_2_JSON_TEST_MARKER })
              }
            }
          ]
        })
      )
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test server port')
  return {
    url: `http://127.0.0.1:${address.port}/v1/chat/completions`,
    bodies
  }
}

describe('two OpenAI-compatible Provider protocol variants', () => {
  it.each(['crlf', 'usage-chunk'] as const)(
    'passes fixed streaming and JSON probes for the %s variant',
    async (dialect) => {
      const mock = await startCompatibleServer(dialect)
      const client = new OpenAiCompatibleProviderClient({ timeoutMs: 2000 })
      const result = await client.testConnection(
        {
          endpoint: validateProviderUrl(mock.url),
          model: `mock-${dialect}`,
          apiKey: 'integration-secret'
        },
        new AbortController().signal,
        { onChunk: vi.fn(), onRetry: vi.fn(), onCapability: vi.fn() }
      )

      expect(result).toEqual({
        output: STAGE_2_STREAM_TEST_MARKER,
        capabilities: { supportsStreaming: true, supportsJsonMode: true }
      })
      expect(mock.bodies).toHaveLength(2)
      const serialized = JSON.stringify(mock.bodies)
      expect(serialized).toContain(STAGE_2_STREAM_TEST_MARKER)
      expect(serialized).toContain(STAGE_2_JSON_TEST_MARKER)
      expect(serialized).not.toContain('销售事实')
      expect(serialized).not.toContain('ModelSnapshot')
      expect(serialized).not.toContain('SUM(')
    }
  )
})
