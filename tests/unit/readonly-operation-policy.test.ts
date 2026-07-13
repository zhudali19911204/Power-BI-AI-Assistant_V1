import { describe, expect, it } from 'vitest'
import { getPowerBiMcpLaunchContract } from '../../src/main/mcp/powerbi-mcp-client'
import {
  assertPhaseOneReadOperation,
  assertPhaseOneToolContracts,
  getRequiredPhaseOneTools,
  McpContractError,
  McpPolicyError
} from '../../src/main/mcp/readonly-operation-policy'

const advertisedOperations = {
  connection_operations:
    'Help, Connect, ConnectFabric, ConnectFolder, ConnectBimFile, Disconnect, GetConnection, ListConnections, ListLocalInstances',
  model_operations:
    'Help, Get, Create, Update, RefreshWithXMLA, RefreshWithAPI, CheckStatusOfRefreshWithAPI, CancelRefreshWithAPI, GetStats, Rename, ExportTMDL.',
  table_operations:
    'Help, Create, Update, Delete, Get, List, RefreshWithXMLA, RefreshWithAPI, CheckStatusOfRefreshWithAPI, CancelRefreshWithAPI, Rename, MarkAsDateTable, GetSchema, ExportTMDL, ExportTMSL',
  column_operations: 'Help, Create, Update, Delete, Get, List, Rename, ExportTMDL',
  measure_operations:
    'Help, Create, Update, Delete, Get, List, Rename, Move, ExportTMDL',
  relationship_operations:
    'Help, List, Get, Create, Update, Delete, Rename, Activate, Deactivate, Find, ExportTMDL'
} as const

function createAdvertisedTools() {
  return Object.entries(advertisedOperations).map(([name, description]) => ({
    name,
    inputSchema: {
      type: 'object',
      required: ['request'],
      properties: {
        request: {
          type: 'object',
          required: ['operation'],
          properties: {
            operation: { type: 'string', description },
            connectionName: { type: ['string', 'null'] },
            connectionString: { type: ['string', 'null'] },
            dataSource: { type: ['string', 'null'] },
            initialCatalog: { type: ['string', 'null'] },
            references: { type: ['array', 'null'] },
            filter: { type: ['object', 'null'] }
          }
        }
      }
    }
  }))
}

describe('phase 1 MCP read-only boundary', () => {
  it('pins the reviewed MCP version and starts it in read-only Power BI mode', () => {
    const contract = getPowerBiMcpLaunchContract()

    expect(contract).toEqual({
      version: '0.5.0-beta.11',
      arguments: ['--start', '--readonly', '--compatibility=PowerBI']
    })
    expect(contract.arguments).not.toContain('--readwrite')
    expect(contract.arguments).not.toContain('--skipconfirmation')
  })

  it.each([
    ['connection_operations', 'Connect'],
    ['connection_operations', 'Disconnect'],
    ['connection_operations', 'ListLocalInstances'],
    ['model_operations', 'Get'],
    ['table_operations', 'List'],
    ['column_operations', 'Get'],
    ['measure_operations', 'List'],
    ['relationship_operations', 'Get']
  ])('allows the reviewed operation %s.%s', (tool, operation) => {
    expect(() => assertPhaseOneReadOperation(tool, operation)).not.toThrow()
  })

  it.each([
    ['table_operations', 'Create'],
    ['column_operations', 'Update'],
    ['measure_operations', 'Delete'],
    ['relationship_operations', 'Rename'],
    ['dax_query_operations', 'Execute'],
    ['transaction_operations', 'Begin'],
    ['unknown_tool', 'Get']
  ])('rejects operation outside the phase boundary: %s.%s', (tool, operation) => {
    expect(() => assertPhaseOneReadOperation(tool, operation)).toThrow(McpPolicyError)
  })

  it('exposes only the six required schema and connection tools', () => {
    expect(getRequiredPhaseOneTools()).toEqual([
      'connection_operations',
      'model_operations',
      'table_operations',
      'column_operations',
      'measure_operations',
      'relationship_operations'
    ])
  })

  it('validates the fixed beta.11 request shape and advertised operation set', () => {
    expect(() => assertPhaseOneToolContracts(createAdvertisedTools())).not.toThrow()
  })

  it('does not accept operation names mentioned outside the fixed operation field', () => {
    const tools = createAdvertisedTools()
    const table = tools.find((tool) => tool.name === 'table_operations')!
    const operation = table.inputSchema.properties.request.properties.operation as {
      description: string
    }
    operation.description = 'Help, Get'
    Object.assign(table.inputSchema, {
      unrelatedDescription: 'Create, Update, Delete, List, ExportTMDL'
    })

    expect(() => assertPhaseOneToolContracts(tools)).toThrow(McpContractError)
  })

  it('rejects a contract where operation is not a required string input', () => {
    const tools = createAdvertisedTools()
    const model = tools.find((tool) => tool.name === 'model_operations')!
    model.inputSchema.properties.request.required = []

    expect(() => assertPhaseOneToolContracts(tools)).toThrow(McpContractError)
  })
})
