import { describe, expect, it } from 'vitest'
import {
  extractRecords,
  findStringDeep,
  McpResponseError,
  parseMcpToolResult,
  readBoolean,
  readNumber,
  readString
} from '../../src/main/mcp/mcp-response-parser'

describe('MCP response parser', () => {
  it('prefers a structured payload and preserves compatible extra fields', () => {
    expect(
      parseMcpToolResult({
        structuredContent: {
          operation: 'List',
          data: { tables: [{ name: '销售' }] },
          futureField: 'compatible'
        },
        content: [{ type: 'text', text: '{"data":{"wrong":true}}' }]
      }, 'List')
    ).toEqual({
      operation: 'List',
      data: { tables: [{ name: '销售' }] },
      futureField: 'compatible'
    })
  })

  it('falls back to the first valid JSON text block', () => {
    expect(
      parseMcpToolResult({
        content: [
          { type: 'image', data: 'ignored' },
          { type: 'text', text: 'not json' },
          {
            type: 'text',
            text: '{"operation":"Get","message":"ok","data":{"count":2}}'
          }
        ]
      }, 'Get')
    ).toEqual({ operation: 'Get', message: 'ok', data: { count: 2 } })
  })

  it.each([
    null,
    [],
    { isError: true, content: [] },
    { structuredContent: {}, content: [] },
    { structuredContent: [], content: [] },
    { content: [{ type: 'text', text: '[]' }] }
  ])('rejects an error or missing structured object payload', (result) => {
    expect(() => parseMcpToolResult(result, 'Get')).toThrow(McpResponseError)
  })

  it('rejects a payload for a different operation', () => {
    expect(() =>
      parseMcpToolResult(
        {
          structuredContent: { operation: 'List', data: [] }
        },
        'Get'
      )
    ).toThrow('different operation')
  })

  it('reads common primitive variants without case-sensitive field assumptions', () => {
    const record = { NAME: '  销售  ', Enabled: 'false', COUNT: '42' }

    expect(readString(record, ['name'])).toBe('销售')
    expect(readBoolean(record, ['enabled'])).toBe(false)
    expect(readNumber(record, ['count'])).toBe(42)
    expect(readNumber({ count: 'not-a-number' }, ['count'])).toBeNull()
  })

  it('extracts nested definitions and finds deep strings', () => {
    const payload = {
      Data: {
        Items: [
          { Definition: { Name: '销售' } },
          { Item: { Name: '日期' } }
        ]
      }
    }

    expect(extractRecords(payload, ['tables'])).toEqual([
      { Name: '销售' },
      { Name: '日期' }
    ])
    expect(findStringDeep({ wrapper: payload }, ['name'])).toBe('销售')
  })
})
