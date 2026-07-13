import { describe, expect, it } from 'vitest'
import type { JsonObject } from '../../src/main/mcp/mcp-response-parser'
import type { McpCallInput } from '../../src/main/mcp/powerbi-mcp-client'
import {
  MicrosoftPowerBiReadAdapter,
  SchemaReadError,
  type PowerBiMcpReadClient
} from '../../src/main/powerbi/powerbi-read-adapter'
import { createConnectionHandle } from '../fixtures/model-fixtures'

type ResponseOverride = (input: McpCallInput) => JsonObject | undefined

class FakeMcpClient implements PowerBiMcpReadClient {
  constructor(private readonly override?: ResponseOverride) {}

  async call(input: McpCallInput): Promise<JsonObject> {
    const overridden = this.override?.(input)
    if (overridden) return overridden

    const key = `${input.tool}.${input.operation}`
    if (key === 'model_operations.Get') {
      return { operation: 'Get', results: [{ data: { Name: '测试模型' } }] }
    }
    if (key === 'table_operations.List') {
      return { operation: 'List', data: [{ Name: '事实表' }] }
    }
    if (key === 'relationship_operations.List') {
      return { operation: 'List', data: [] }
    }
    if (key === 'table_operations.Get') {
      return { operation: 'Get', results: [{ data: { Name: '事实表' } }] }
    }
    if (key === 'column_operations.List') {
      return {
        operation: 'List',
        data: [{ TableName: '事实表', Columns: [{ Name: '金额' }] }]
      }
    }
    if (key === 'measure_operations.List') {
      return { operation: 'List', data: [] }
    }
    if (key === 'column_operations.Get') {
      return {
        operation: 'Get',
        results: [
          { data: { Name: '金额', TableName: '事实表', DataType: 'Decimal' } }
        ]
      }
    }
    throw new Error(`Unexpected fake MCP call: ${key}`)
  }

  onTransportClosed(): () => void {
    return () => undefined
  }

  async dispose(): Promise<void> {}
}

describe('MicrosoftPowerBiReadAdapter schema completeness', () => {
  it('loads a complete List-to-Get schema without inventing objects', async () => {
    const adapter = new MicrosoftPowerBiReadAdapter(new FakeMcpClient())

    const raw = await adapter.readModel(createConnectionHandle())

    expect(raw).toMatchObject({
      modelName: '测试模型',
      tables: [
        {
          name: '事实表',
          columns: [{ Name: '金额', TableName: '事实表', DataType: 'Decimal' }],
          measures: []
        }
      ],
      relationships: []
    })
  })

  it('rejects an unnamed table summary instead of silently dropping it', async () => {
    const adapter = new MicrosoftPowerBiReadAdapter(
      new FakeMcpClient((input) =>
        input.tool === 'table_operations' && input.operation === 'List'
          ? { operation: 'List', data: [{}] }
          : undefined
      )
    )

    await expect(adapter.readModel(createConnectionHandle())).rejects.toThrow(
      SchemaReadError
    )
  })

  it('rejects mixed named and unnamed relationship summaries', async () => {
    const adapter = new MicrosoftPowerBiReadAdapter(
      new FakeMcpClient((input) => {
        if (input.tool === 'table_operations' && input.operation === 'List') {
          return { operation: 'List', data: [] }
        }
        if (input.tool === 'relationship_operations' && input.operation === 'List') {
          return {
            operation: 'List',
            data: [
              { Name: '有效关系' },
              { FromTable: '事实表', FromColumn: '键' }
            ]
          }
        }
        return undefined
      })
    )

    await expect(adapter.readModel(createConnectionHandle())).rejects.toThrow(
      'unnamed relationship'
    )
  })

  it.each([
    ['truncation flag', { hasMore: true }],
    ['continuation token', { continuationToken: 'next-page' }],
    ['larger total count', { totalCount: 1 }]
  ])('rejects table List responses carrying %s', async (_, metadata) => {
    const adapter = new MicrosoftPowerBiReadAdapter(
      new FakeMcpClient((input) =>
        input.tool === 'table_operations' && input.operation === 'List'
          ? { operation: 'List', data: [], ...metadata }
          : undefined
      )
    )

    await expect(adapter.readModel(createConnectionHandle())).rejects.toThrow(
      SchemaReadError
    )
  })

  it('rejects a same-count Get result whose identity differs from List', async () => {
    const adapter = new MicrosoftPowerBiReadAdapter(
      new FakeMcpClient((input) =>
        input.tool === 'column_operations' && input.operation === 'Get'
          ? {
              operation: 'Get',
              results: [
                {
                  data: {
                    Name: '其他列',
                    TableName: '事实表',
                    DataType: 'Decimal'
                  }
                }
              ]
            }
          : undefined
      )
    )

    await expect(adapter.readModel(createConnectionHandle())).rejects.toThrow(
      'mismatched column details'
    )
  })
})
