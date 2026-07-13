import { createHash } from 'node:crypto'
import type { JsonObject } from '../mcp/mcp-response-parser'
import {
  extractRecords,
  findStringDeep,
  getCaseInsensitive,
  isJsonObject,
  readNumber,
  readString
} from '../mcp/mcp-response-parser'
import type { McpCallInput } from '../mcp/powerbi-mcp-client'

const PER_TABLE_RESULT_LIMIT = 5_000
const SCHEMA_CONCURRENCY = 3
const GET_BATCH_SIZE = 100

export interface InternalDesktopModel {
  readonly fingerprint: string
  readonly displayName: string
  readonly modelName: string | null
  readonly disambiguator: string | null
  readonly connectionString: string | null
  readonly dataSource: string | null
  readonly initialCatalog: string | null
}

export interface InternalConnectionHandle {
  readonly connectionName: string
  readonly instanceFingerprint: string
  readonly displayName: string
  readonly modelName: string
}

export interface RawTableMetadata {
  readonly name: string
  readonly summary: JsonObject
  readonly detail: unknown
  readonly columns: readonly JsonObject[]
  readonly measures: readonly JsonObject[]
}

export interface RawModelRead {
  readonly modelName: string
  readonly model: unknown
  readonly tables: readonly RawTableMetadata[]
  readonly relationships: readonly JsonObject[]
}

export interface PowerBiReadAdapter {
  discoverDesktopModels(signal?: AbortSignal): Promise<readonly InternalDesktopModel[]>
  connect(model: InternalDesktopModel, signal?: AbortSignal): Promise<InternalConnectionHandle>
  readModel(handle: InternalConnectionHandle, signal?: AbortSignal): Promise<RawModelRead>
  disconnect(handle: InternalConnectionHandle): Promise<void>
  onTransportClosed(listener: () => void): () => void
  dispose(): Promise<void>
}

export interface PowerBiMcpReadClient {
  call(input: McpCallInput): Promise<JsonObject>
  onTransportClosed(listener: () => void): () => void
  dispose(): Promise<void>
}

export class SchemaReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaReadError'
  }
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeFingerprintPart(value: string | null): string {
  return (value ?? '').normalize('NFC').replaceAll('\r\n', '\n').trim()
}

function createInstanceFingerprint(parts: readonly (string | null)[]): string {
  return createHash('sha256')
    .update(parts.map(normalizeFingerprintPart).join('\u001f'), 'utf8')
    .digest('hex')
}

function unwrapRecord(record: JsonObject): JsonObject {
  const nested = getCaseInsensitive(record, ['definition', 'data', 'item', 'result'])
  return isJsonObject(nested) ? nested : record
}

function canonicalName(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('en-US')
}

function requireResponseData(response: JsonObject, objectKind: string): unknown {
  const data = getCaseInsensitive(response, ['data'])
  if (data === undefined || (data !== null && !Array.isArray(data) && !isJsonObject(data))) {
    throw new SchemaReadError(`Power BI MCP returned invalid ${objectKind} list data.`)
  }
  return data
}

function assertNoTruncation(
  response: JsonObject,
  returnedCount: number,
  objectKind: string,
  safetyLimit?: number
): void {
  const data = getCaseInsensitive(response, ['data'])
  const containers = [response, ...(isJsonObject(data) ? [data] : [])]

  for (const container of containers) {
    const truncated = getCaseInsensitive(container, [
      'hasMore',
      'hasNextPage',
      'isTruncated',
      'truncated'
    ])
    if (truncated === true || (typeof truncated === 'string' && truncated.toLowerCase() === 'true')) {
      throw new SchemaReadError(`Power BI MCP returned a truncated ${objectKind} list.`)
    }

    const continuation = getCaseInsensitive(container, [
      'continuationToken',
      'nextPageToken',
      'nextLink',
      'nextPage'
    ])
    if (
      (typeof continuation === 'string' && continuation.trim().length > 0) ||
      (typeof continuation === 'number' && Number.isFinite(continuation)) ||
      isJsonObject(continuation)
    ) {
      throw new SchemaReadError(`Power BI MCP requires unsupported ${objectKind} pagination.`)
    }

    const totalCount = readNumber(container, ['totalCount', 'totalResults', 'availableCount'])
    if (totalCount !== null && totalCount > returnedCount) {
      throw new SchemaReadError(`Power BI MCP returned an incomplete ${objectKind} list.`)
    }
  }

  if (safetyLimit !== undefined && returnedCount >= safetyLimit) {
    throw new SchemaReadError(`Power BI MCP ${objectKind} list reached the safety limit.`)
  }
}

function requireRecordNames(
  records: readonly JsonObject[],
  nameFields: readonly string[],
  objectKind: string,
  expectedTableName?: string
): string[] {
  const names = records.map((value) => {
    const record = unwrapRecord(value)
    const name = readString(record, nameFields)
    if (!name) {
      throw new SchemaReadError(`Power BI MCP returned an unnamed ${objectKind}.`)
    }
    const owner = readString(record, ['tableName', 'table'])
    if (
      expectedTableName &&
      owner &&
      canonicalName(owner) !== canonicalName(expectedTableName)
    ) {
      throw new SchemaReadError(`Power BI MCP returned a ${objectKind} from another table.`)
    }
    return name.normalize('NFC')
  })

  if (new Set(names.map(canonicalName)).size !== names.length) {
    throw new SchemaReadError(`Power BI MCP returned duplicate ${objectKind} names.`)
  }
  return names
}

function assertMatchingNames(
  expectedNames: readonly string[],
  records: readonly JsonObject[],
  nameFields: readonly string[],
  objectKind: string,
  expectedTableName?: string
): void {
  const actualNames = requireRecordNames(
    records,
    nameFields,
    objectKind,
    expectedTableName
  )
  const expected = [...expectedNames].map(canonicalName).sort(ordinalCompare)
  const actual = actualNames.map(canonicalName).sort(ordinalCompare)
  if (
    expected.length !== actual.length ||
    expected.some((name, index) => name !== actual[index])
  ) {
    throw new SchemaReadError(`Power BI MCP returned mismatched ${objectKind} details.`)
  }
}

function getResultRecords(response: JsonObject): JsonObject[] {
  const results = getCaseInsensitive(response, ['results'])
  if (Array.isArray(results)) {
    return results.flatMap((result) => {
      if (!isJsonObject(result)) return []
      const data = getCaseInsensitive(result, ['data', 'definition', 'item'])
      return isJsonObject(data) ? [data] : []
    })
  }
  return extractRecords(response.data)
}

function getGroupedRecords(
  value: unknown,
  collectionName: 'columns' | 'measures',
  fallbackTableName: string
): JsonObject[] {
  return extractRecords(value).flatMap((group) => {
    const tableName = readString(group, ['tableName', 'table']) ?? fallbackTableName
    const children = getCaseInsensitive(group, [collectionName])
    if (!Array.isArray(children)) return [group]
    return children.flatMap((child) =>
      isJsonObject(child) ? [{ ...child, tableName }] : []
    )
  })
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function isPowerBiDesktopInstance(record: JsonObject): boolean {
  const descriptor = [
    readString(record, ['type', 'instanceType', 'sourceType']),
    readString(record, ['processName', 'productName', 'applicationName']),
    readString(record, ['displayName', 'name'])
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase('en-US')

  if (descriptor.includes('analysis services') && !descriptor.includes('power bi')) {
    return false
  }
  return !descriptor.includes('ssas') || descriptor.includes('power bi')
}

function parseDesktopModel(record: JsonObject, index: number): InternalDesktopModel | null {
  const raw = unwrapRecord(record)
  if (!isPowerBiDesktopInstance(raw)) return null

  const port = readNumber(raw, ['port', 'serverPort', 'msmdsrvPort'])
  const connectionString = readString(raw, ['connectionString'])
  const dataSource =
    readString(raw, ['dataSource', 'server', 'serverName']) ??
    (port === null ? null : `localhost:${port}`)
  if (!connectionString && !dataSource) return null

  const modelName = readString(raw, [
    'modelName',
    'databaseName',
    'initialCatalog',
    'catalogName'
  ])
  const displayName =
    readString(raw, ['displayName', 'fileName', 'windowTitle', 'name']) ??
    modelName ??
    `Power BI Desktop ${index + 1}`
  const processId = readString(raw, ['processId', 'pid'])
  const initialCatalog = readString(raw, ['initialCatalog', 'databaseName', 'catalogName'])

  return {
    fingerprint: createInstanceFingerprint([
      connectionString,
      dataSource,
      initialCatalog,
      processId,
      displayName
    ]),
    displayName,
    modelName,
    disambiguator: processId ? `PID ${processId}` : dataSource,
    connectionString,
    dataSource,
    initialCatalog
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      const value = values[index]
      if (value !== undefined) results[index] = await mapper(value, index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  )
  return results
}

export class MicrosoftPowerBiReadAdapter implements PowerBiReadAdapter {
  constructor(private readonly mcp: PowerBiMcpReadClient) {}

  async discoverDesktopModels(signal?: AbortSignal): Promise<readonly InternalDesktopModel[]> {
    const response = await this.mcp.call({
      tool: 'connection_operations',
      operation: 'ListLocalInstances',
      signal
    })
    const data = requireResponseData(response, 'local Power BI instance')
    const records = extractRecords(data, ['instances', 'connections'])
    assertNoTruncation(response, records.length, 'local Power BI instance')
    const models = records
      .map(parseDesktopModel)
      .filter((model): model is InternalDesktopModel => model !== null)

    return models.sort((left, right) =>
      ordinalCompare(
        `${left.displayName}\u001f${left.fingerprint}`,
        `${right.displayName}\u001f${right.fingerprint}`
      )
    )
  }

  async connect(
    model: InternalDesktopModel,
    signal?: AbortSignal
  ): Promise<InternalConnectionHandle> {
    const request: Record<string, unknown> = {}
    if (model.connectionString) {
      request.connectionString = model.connectionString
    } else if (model.dataSource) {
      request.dataSource = model.dataSource
      if (model.initialCatalog) request.initialCatalog = model.initialCatalog
    } else {
      throw new Error('The selected Power BI Desktop instance has no connection address.')
    }

    const response = await this.mcp.call({
      tool: 'connection_operations',
      operation: 'Connect',
      request,
      signal
    })
    let connectionName = findStringDeep(response.data, [
      'connectionName',
      'name'
    ])
    if (!connectionName) {
      const connectionsResponse = await this.mcp.call({
        tool: 'connection_operations',
        operation: 'ListConnections',
        signal
      })
      const connections = extractRecords(connectionsResponse.data, ['connections'])
      const matching = connections
        .filter((connection) => {
          const databaseName = readString(connection, [
            'databaseName',
            'modelName',
            'initialCatalog'
          ])
          return !model.modelName || databaseName === model.modelName
        })
        .sort((left, right) => {
          const leftTime = readString(left, ['connectedAt', 'lastUsedAt']) ?? ''
          const rightTime = readString(right, ['connectedAt', 'lastUsedAt']) ?? ''
          return ordinalCompare(rightTime, leftTime)
        })[0]
      connectionName = matching
        ? readString(matching, ['connectionName', 'name'])
        : null
    }
    if (!connectionName) {
      throw new Error('Power BI Modeling MCP did not return a connection name.')
    }

    const modelName =
      findStringDeep(response.data, ['modelName', 'databaseName', 'initialCatalog']) ??
      model.modelName ??
      model.displayName

    return {
      connectionName,
      instanceFingerprint: model.fingerprint,
      displayName: model.displayName,
      modelName
    }
  }

  async readModel(
    handle: InternalConnectionHandle,
    signal?: AbortSignal
  ): Promise<RawModelRead> {
    const [modelResponse, tableResponse, relationshipResponse] = await Promise.all([
      this.mcp.call({
        tool: 'model_operations',
        operation: 'Get',
        request: { connectionName: handle.connectionName },
        signal
      }),
      this.mcp.call({
        tool: 'table_operations',
        operation: 'List',
        request: { connectionName: handle.connectionName },
        signal
      }),
      this.mcp.call({
        tool: 'relationship_operations',
        operation: 'List',
        request: { connectionName: handle.connectionName },
        signal
      })
    ])

    const tableData = requireResponseData(tableResponse, 'table')
    const tableSummaries = extractRecords(tableData, ['tables'])
    assertNoTruncation(tableResponse, tableSummaries.length, 'table')
    const tableNames = requireRecordNames(tableSummaries, ['name', 'tableName'], 'table')
    const tableEntries = tableSummaries
      .map((summary, index) => ({
        name: tableNames[index]!,
        summary
      }))
      .sort((left, right) => ordinalCompare(left.name, right.name))

    const relationshipData = requireResponseData(relationshipResponse, 'relationship')
    const relationshipSummaries = extractRecords(relationshipData, ['relationships'])
    assertNoTruncation(
      relationshipResponse,
      relationshipSummaries.length,
      'relationship'
    )
    const relationshipNames = requireRecordNames(
      relationshipSummaries,
      ['name', 'relationshipName'],
      'relationship'
    )

    const tables = await mapWithConcurrency(
      tableEntries,
      SCHEMA_CONCURRENCY,
      async ({ name, summary }): Promise<RawTableMetadata> => {
        const [detail, columnList, measureList] = await Promise.all([
          this.mcp.call({
            tool: 'table_operations',
            operation: 'Get',
            request: {
              connectionName: handle.connectionName,
              references: [{ name }]
            },
            signal
          }),
          this.mcp.call({
            tool: 'column_operations',
            operation: 'List',
            request: {
              connectionName: handle.connectionName,
              filter: { tableNames: [name], maxResults: PER_TABLE_RESULT_LIMIT }
            },
            signal
          }),
          this.mcp.call({
            tool: 'measure_operations',
            operation: 'List',
            request: {
              connectionName: handle.connectionName,
              filter: { tableNames: [name], maxResults: PER_TABLE_RESULT_LIMIT }
            },
            signal
          })
        ])

        const columnData = requireResponseData(columnList, 'column')
        const measureData = requireResponseData(measureList, 'measure')
        const columnSummaries = getGroupedRecords(columnData, 'columns', name)
        const measureSummaries = getGroupedRecords(measureData, 'measures', name)
        assertNoTruncation(
          columnList,
          columnSummaries.length,
          'column',
          PER_TABLE_RESULT_LIMIT
        )
        assertNoTruncation(
          measureList,
          measureSummaries.length,
          'measure',
          PER_TABLE_RESULT_LIMIT
        )
        const columnNames = requireRecordNames(
          columnSummaries,
          ['name', 'columnName'],
          'column',
          name
        )
        const measureNames = requireRecordNames(
          measureSummaries,
          ['name', 'measureName'],
          'measure',
          name
        )

        const tableDetails = getResultRecords(detail)
        assertMatchingNames([name], tableDetails, ['name', 'tableName'], 'table')

        const columnBatches = await mapWithConcurrency(
          chunks(columnNames, GET_BATCH_SIZE),
          2,
          async (batch) => {
            const response = await this.mcp.call({
              tool: 'column_operations',
              operation: 'Get',
              request: {
                connectionName: handle.connectionName,
                references: batch.map((columnName) => ({
                  tableName: name,
                  name: columnName
                }))
              },
              signal
            })
            return getResultRecords(response)
          }
        )
        const measureBatches = await mapWithConcurrency(
          chunks(measureNames, GET_BATCH_SIZE),
          2,
          async (batch) => {
            const response = await this.mcp.call({
              tool: 'measure_operations',
              operation: 'Get',
              request: {
                connectionName: handle.connectionName,
                references: batch.map((measureName) => ({
                  tableName: name,
                  name: measureName
                }))
              },
              signal
            })
            return getResultRecords(response)
          }
        )
        const columnRecords = columnBatches.flat()
        const measureRecords = measureBatches.flat()
        assertMatchingNames(columnNames, columnRecords, ['name', 'columnName'], 'column', name)
        assertMatchingNames(measureNames, measureRecords, ['name', 'measureName'], 'measure', name)

        return {
          name,
          summary,
          detail: tableDetails,
          columns: columnRecords,
          measures: measureRecords
        }
      }
    )

    const modelRecords = getResultRecords(modelResponse)
    if (modelRecords.length !== 1) {
      throw new SchemaReadError('Power BI MCP returned an incomplete model definition.')
    }
    const modelData = modelRecords[0]!
    const modelName =
      findStringDeep(modelData, ['name', 'modelName', 'databaseName']) ??
      handle.modelName

    const relationshipBatches = await mapWithConcurrency(
      chunks(relationshipNames, GET_BATCH_SIZE),
      2,
      async (batch) => {
        const response = await this.mcp.call({
          tool: 'relationship_operations',
          operation: 'Get',
          request: {
            connectionName: handle.connectionName,
            references: batch.map((name) => ({ name }))
          },
          signal
        })
        return getResultRecords(response)
      }
    )
    const relationshipRecords = relationshipBatches.flat()
    assertMatchingNames(
      relationshipNames,
      relationshipRecords,
      ['name', 'relationshipName'],
      'relationship'
    )

    return {
      modelName,
      model: modelData,
      tables,
      relationships: relationshipRecords
    }
  }

  async disconnect(handle: InternalConnectionHandle): Promise<void> {
    await this.mcp.call({
      tool: 'connection_operations',
      operation: 'Disconnect',
      request: { connectionName: handle.connectionName }
    })
  }

  onTransportClosed(listener: () => void): () => void {
    return this.mcp.onTransportClosed(listener)
  }

  dispose(): Promise<void> {
    return this.mcp.dispose()
  }
}
