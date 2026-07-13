export type PhaseOneMcpTool =
  | 'connection_operations'
  | 'model_operations'
  | 'table_operations'
  | 'column_operations'
  | 'measure_operations'
  | 'relationship_operations'

const READ_ONLY_OPERATIONS: Readonly<Record<PhaseOneMcpTool, ReadonlySet<string>>> = {
  connection_operations: new Set([
    'connect',
    'disconnect',
    'getconnection',
    'listconnections',
    'listlocalinstances'
  ]),
  model_operations: new Set(['get']),
  table_operations: new Set(['get', 'list']),
  column_operations: new Set(['get', 'list']),
  measure_operations: new Set(['get', 'list']),
  relationship_operations: new Set(['get', 'list'])
}

const FIXED_ADVERTISED_OPERATIONS: Readonly<
  Record<PhaseOneMcpTool, readonly string[]>
> = {
  connection_operations: [
    'Help',
    'Connect',
    'ConnectFabric',
    'ConnectFolder',
    'ConnectBimFile',
    'Disconnect',
    'GetConnection',
    'ListConnections',
    'ListLocalInstances'
  ],
  model_operations: [
    'Help',
    'Get',
    'Create',
    'Update',
    'RefreshWithXMLA',
    'RefreshWithAPI',
    'CheckStatusOfRefreshWithAPI',
    'CancelRefreshWithAPI',
    'GetStats',
    'Rename',
    'ExportTMDL'
  ],
  table_operations: [
    'Help',
    'Create',
    'Update',
    'Delete',
    'Get',
    'List',
    'RefreshWithXMLA',
    'RefreshWithAPI',
    'CheckStatusOfRefreshWithAPI',
    'CancelRefreshWithAPI',
    'Rename',
    'MarkAsDateTable',
    'GetSchema',
    'ExportTMDL',
    'ExportTMSL'
  ],
  column_operations: [
    'Help',
    'Create',
    'Update',
    'Delete',
    'Get',
    'List',
    'Rename',
    'ExportTMDL'
  ],
  measure_operations: [
    'Help',
    'Create',
    'Update',
    'Delete',
    'Get',
    'List',
    'Rename',
    'Move',
    'ExportTMDL'
  ],
  relationship_operations: [
    'Help',
    'List',
    'Get',
    'Create',
    'Update',
    'Delete',
    'Rename',
    'Activate',
    'Deactivate',
    'Find',
    'ExportTMDL'
  ]
}

const REQUIRED_INPUT_PROPERTIES: Readonly<
  Record<PhaseOneMcpTool, Readonly<Record<string, string>>>
> = {
  connection_operations: {
    operation: 'string',
    connectionName: 'string',
    connectionString: 'string',
    dataSource: 'string',
    initialCatalog: 'string'
  },
  model_operations: { operation: 'string', connectionName: 'string' },
  table_operations: {
    operation: 'string',
    connectionName: 'string',
    references: 'array'
  },
  column_operations: {
    operation: 'string',
    connectionName: 'string',
    references: 'array',
    filter: 'object'
  },
  measure_operations: {
    operation: 'string',
    connectionName: 'string',
    references: 'array',
    filter: 'object'
  },
  relationship_operations: {
    operation: 'string',
    connectionName: 'string',
    references: 'array'
  }
}

type JsonSchemaObject = Record<string, unknown>

export interface AdvertisedMcpTool {
  readonly name: string
  readonly inputSchema: unknown
}

export class McpPolicyError extends Error {
  constructor(tool: string, operation: string) {
    super(`MCP operation is not allowed in phase 1: ${tool}.${operation}`)
    this.name = 'McpPolicyError'
  }
}

export class McpContractError extends Error {
  constructor(tool: string) {
    super(`Power BI MCP has an incompatible fixed input contract for ${tool}.`)
    this.name = 'McpContractError'
  }
}

function asObject(value: unknown): JsonSchemaObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonSchemaObject)
    : null
}

function hasRequiredProperty(schema: JsonSchemaObject, name: string): boolean {
  return Array.isArray(schema.required) && schema.required.includes(name)
}

function schemaAllowsType(schema: JsonSchemaObject, expectedType: string): boolean {
  return (
    schema.type === expectedType ||
    (Array.isArray(schema.type) && schema.type.includes(expectedType))
  )
}

function parseAdvertisedOperations(operationSchema: JsonSchemaObject): string[] | null {
  if (typeof operationSchema.description !== 'string') return null
  const operations = operationSchema.description
    .split(',')
    .map((operation) => operation.trim().replace(/\.$/, ''))
  if (
    operations.length === 0 ||
    operations.some((operation) => !/^[A-Za-z][A-Za-z0-9]*$/.test(operation)) ||
    new Set(operations.map((operation) => operation.toLocaleLowerCase('en-US'))).size !==
      operations.length
  ) {
    return null
  }
  return operations
}

function sameOperationSet(actual: readonly string[], expected: readonly string[]): boolean {
  const normalize = (values: readonly string[]): string[] =>
    values.map((value) => value.toLocaleLowerCase('en-US')).sort()
  const normalizedActual = normalize(actual)
  const normalizedExpected = normalize(expected)
  return (
    normalizedActual.length === normalizedExpected.length &&
    normalizedExpected.every((operation, index) => operation === normalizedActual[index])
  )
}

export function assertPhaseOneToolContracts(tools: readonly AdvertisedMcpTool[]): void {
  for (const toolName of getRequiredPhaseOneTools()) {
    const matches = tools.filter((tool) => tool.name === toolName)
    if (matches.length !== 1) throw new McpContractError(toolName)

    const input = asObject(matches[0]?.inputSchema)
    const inputProperties = asObject(input?.properties)
    const request = asObject(inputProperties?.request)
    const requestProperties = asObject(request?.properties)
    const operation = asObject(requestProperties?.operation)
    if (
      !input ||
      input.type !== 'object' ||
      !hasRequiredProperty(input, 'request') ||
      !request ||
      request.type !== 'object' ||
      !hasRequiredProperty(request, 'operation') ||
      !requestProperties ||
      !operation ||
      operation.type !== 'string'
    ) {
      throw new McpContractError(toolName)
    }

    for (const [propertyName, expectedType] of Object.entries(
      REQUIRED_INPUT_PROPERTIES[toolName]
    )) {
      const property = asObject(requestProperties[propertyName])
      if (!property || !schemaAllowsType(property, expectedType)) {
        throw new McpContractError(toolName)
      }
    }

    const advertisedOperations = parseAdvertisedOperations(operation)
    if (
      !advertisedOperations ||
      !sameOperationSet(advertisedOperations, FIXED_ADVERTISED_OPERATIONS[toolName])
    ) {
      throw new McpContractError(toolName)
    }
  }
}

export function assertPhaseOneReadOperation(
  tool: string,
  operation: string
): asserts tool is PhaseOneMcpTool {
  if (!(tool in READ_ONLY_OPERATIONS)) {
    throw new McpPolicyError(tool, operation)
  }

  const allowedOperations = READ_ONLY_OPERATIONS[tool as PhaseOneMcpTool]
  if (!allowedOperations.has(operation.toLocaleLowerCase('en-US'))) {
    throw new McpPolicyError(tool, operation)
  }
}

export function getRequiredPhaseOneTools(): readonly PhaseOneMcpTool[] {
  return Object.keys(READ_ONLY_OPERATIONS) as PhaseOneMcpTool[]
}

export function getAllowedPhaseOneOperations(tool: PhaseOneMcpTool): readonly string[] {
  return [...READ_ONLY_OPERATIONS[tool]]
}
