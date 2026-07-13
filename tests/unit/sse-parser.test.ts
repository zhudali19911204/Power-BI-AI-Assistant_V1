import { describe, expect, it } from 'vitest'
import { OpenAiSseParser } from '../../src/main/provider/sse-parser'

describe('OpenAI-compatible SSE parser', () => {
  it('handles CRLF, split chunks, comments, usage chunks and DONE', () => {
    const parser = new OpenAiSseParser()
    const first = parser.push(
      ': keepalive\r\ndata: {"choices":[{"delta":{"content":"连接"}}]}\r\n\r\ndata: {"choices"'
    )
    const second = parser.push(
      ':[{"delta":{"content":"成功"}}]}\n\ndata: {"choices":[]}\n\ndata: [DONE]\n\n'
    )

    expect([...first, ...second]).toEqual([
      { done: false, delta: '连接' },
      { done: false, delta: '成功' },
      { done: false, delta: '' },
      { done: true, delta: '' }
    ])
  })

  it('rejects malformed JSON without returning the raw provider body', () => {
    const parser = new OpenAiSseParser()
    expect(() => parser.push('data: not-json\n\n')).toThrowError(
      expect.objectContaining({ code: 'MALFORMED_STREAM' })
    )
  })
})
