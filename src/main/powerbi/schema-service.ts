import { randomUUID } from 'node:crypto'
import type {
  DateTableStatus,
  ModelColumn,
  ModelColumnKind,
  ModelMeasure,
  ModelMetadata,
  ModelRelationship,
  ModelSnapshot,
  ModelTable,
  ModelTableKind
} from '../../shared/model-contract'
import type { JsonObject } from '../mcp/mcp-response-parser'
import {
  extractRecords,
  getCaseInsensitive,
  isJsonObject,
  readBoolean,
  readNumber,
  readString
} from '../mcp/mcp-response-parser'
import { ModelRegistry } from './model-registry'
import type { RawModelRead, RawTableMetadata } from './powerbi-read-adapter'
import { createSchemaHash } from './snapshot-hash'

export interface SnapshotIdentity {
  readonly connectionId: string
  readonly connectionSessionId: string
}

export interface SnapshotBuildResult {
  readonly snapshot: ModelSnapshot
  readonly registry: ModelRegistry
}

export class SchemaValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SchemaValidationError'
  }
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeNullable(value: string | null): string | null {
  return value?.normalize('NFC').replaceAll('\r\n', '\n') ?? null
}

function requireName(value: string | null, kind: string): string {
  if (!value || value.length > 512) {
    throw new SchemaValidationError(`Power BI schema contains an unnamed or invalid ${kind}.`)
  }
  return value.normalize('NFC')
}

function canonicalName(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('en-US')
}

function unwrapRecord(value: unknown): JsonObject | null {
  const records = extractRecords(value)
  if (records.length === 0) return null

  const record = records[0]
  if (!record) return null
  const nested = getCaseInsensitive(record, ['definition', 'data', 'item', 'result'])
  return isJsonObject(nested) ? nested : record
}

function findNamedRecord(value: unknown, expectedName: string): JsonObject | null {
  const expected = expectedName.normalize('NFC').toLocaleLowerCase('en-US')

  function visit(current: unknown, depth: number): JsonObject | null {
    if (depth > 6) return null
    if (Array.isArray(current)) {
      for (const item of current) {
        const found = visit(item, depth + 1)
        if (found) return found
      }
      return null
    }
    if (!isJsonObject(current)) return null

    const name = readString(current, ['name', 'tableName'])
    if (name?.normalize('NFC').toLocaleLowerCase('en-US') === expected) {
      return current
    }
    for (const child of Object.values(current)) {
      const found = visit(child, depth + 1)
      if (found) return found
    }
    return null
  }

  return visit(value, 0)
}

function tableKind(record: JsonObject): ModelTableKind {
  const type = readString(record, ['type', 'tableType', 'objectType'])?.toLocaleLowerCase('en-US')
  if (type?.includes('calculationgroup')) return 'calculationGroup'
  if (type?.includes('calculated') || readString(record, ['expression'])) {
    return 'calculatedTable'
  }
  return 'table'
}

function dateTableStatus(record: JsonObject): DateTableStatus {
  const marked = readBoolean(record, ['isDateTable', 'markedAsDateTable', 'isMarkedAsDateTable'])
  if (marked === true) return 'marked'
  if (marked === false) return 'unmarked'
  return 'unknown'
}

function columnKind(record: JsonObject): ModelColumnKind {
  const type = readString(record, ['type', 'columnType', 'objectType'])?.toLocaleLowerCase('en-US')
  if (type?.includes('calculatedtablecolumn')) return 'calculatedTableColumn'
  if (type?.includes('rownumber')) return 'rowNumber'
  if (type?.includes('calculated') || readString(record, ['expression'])) return 'calculated'
  if (type?.includes('data') || readString(record, ['sourceColumn'])) return 'data'
  return 'unknown'
}

function normalizeColumn(value: JsonObject, tableName: string): ModelColumn {
  const record = unwrapRecord(value)
  if (!record) {
    throw new SchemaValidationError('Power BI schema contains an invalid column record.')
  }
  const name = requireName(readString(record, ['name', 'columnName']), 'column')
  const owner = readString(record, ['tableName', 'table'])
  if (owner && canonicalName(owner) !== canonicalName(tableName)) {
    throw new SchemaValidationError('Power BI schema contains a column assigned to another table.')
  }
  const rawDataType = readString(record, ['dataType', 'rawDataType', 'sourceProviderType'])
  if (!rawDataType) {
    throw new SchemaValidationError('Power BI schema contains a column without a data type.')
  }
  const kind = columnKind(record)
  const expression = normalizeNullable(readString(record, ['expression']))
  if (kind === 'calculated' && !expression) {
    throw new SchemaValidationError(
      'Power BI schema contains a calculated column without an expression.'
    )
  }

  return {
    name,
    dataType: rawDataType,
    rawDataType,
    kind,
    expression,
    formatString: normalizeNullable(readString(record, ['formatString'])),
    description: normalizeNullable(readString(record, ['description'])),
    displayFolder: normalizeNullable(readString(record, ['displayFolder'])),
    dataCategory: normalizeNullable(readString(record, ['dataCategory'])),
    summarizeBy: normalizeNullable(readString(record, ['summarizeBy'])),
    sortByColumn: normalizeNullable(readString(record, ['sortByColumn', 'sortByColumnName'])),
    isHidden: readBoolean(record, ['isHidden', 'hidden']) ?? false,
    isKey: readBoolean(record, ['isKey', 'key']) ?? false,
    isNullable: readBoolean(record, ['isNullable', 'nullable'])
  }
}

function normalizeMeasure(value: JsonObject, tableName: string): ModelMeasure {
  const record = unwrapRecord(value)
  if (!record) {
    throw new SchemaValidationError('Power BI schema contains an invalid measure record.')
  }
  const name = requireName(readString(record, ['name', 'measureName']), 'measure')
  const owner = readString(record, ['tableName', 'table']) ?? tableName
  if (canonicalName(owner) !== canonicalName(tableName)) {
    throw new SchemaValidationError('Power BI schema contains a measure assigned to another table.')
  }
  const expression = normalizeNullable(readString(record, ['expression', 'daxExpression']))
  if (!expression) {
    throw new SchemaValidationError('Power BI schema contains a measure without a DAX expression.')
  }

  return {
    name,
    tableName,
    expression,
    formatString: normalizeNullable(readString(record, ['formatString'])),
    description: normalizeNullable(readString(record, ['description'])),
    displayFolder: normalizeNullable(readString(record, ['displayFolder'])),
    dataType: normalizeNullable(readString(record, ['dataType'])),
    isHidden: readBoolean(record, ['isHidden', 'hidden']) ?? false
  }
}

function nestedRecords(record: JsonObject, keys: readonly string[]): JsonObject[] {
  const value = getCaseInsensitive(record, keys)
  return extractRecords(value, keys)
}

function normalizeTable(raw: RawTableMetadata): ModelTable {
  const name = requireName(
    typeof raw.name === 'string' ? raw.name.trim() : null,
    'table'
  )
  const summaryName = requireName(
    readString(raw.summary, ['name', 'tableName']),
    'table summary'
  )
  if (canonicalName(name) !== canonicalName(summaryName)) {
    throw new SchemaValidationError('Power BI schema contains mismatched table identities.')
  }

  const detail = findNamedRecord(raw.detail, name) ?? unwrapRecord(raw.detail)
  const tableRecord = detail ? { ...raw.summary, ...detail } : raw.summary
  const kind = tableKind(tableRecord)
  const expression = normalizeNullable(readString(tableRecord, ['expression']))
  if (kind === 'calculatedTable' && !expression) {
    throw new SchemaValidationError(
      'Power BI schema contains a calculated table without an expression.'
    )
  }
  const columnSource = raw.columns.length > 0 ? raw.columns : nestedRecords(tableRecord, ['columns'])
  const measureSource = raw.measures.length > 0 ? raw.measures : nestedRecords(tableRecord, ['measures'])

  const columns = columnSource
    .map((column) => normalizeColumn(column, name))
    .sort((left, right) => ordinalCompare(left.name, right.name))
  const measures = measureSource
    .map((measure) => normalizeMeasure(measure, name))
    .sort((left, right) => ordinalCompare(left.name, right.name))

  return {
    name,
    kind,
    expression,
    description: normalizeNullable(readString(tableRecord, ['description'])),
    isHidden: readBoolean(tableRecord, ['isHidden', 'hidden']) ?? false,
    dateTableStatus: dateTableStatus(tableRecord),
    dateColumn: normalizeNullable(
      readString(tableRecord, ['dateColumn', 'dateColumnName', 'dateTableColumnName'])
    ),
    columns,
    measures
  }
}

function readEndpoint(
  record: JsonObject,
  prefix: 'from' | 'to'
): { table: string | null; column: string | null } {
  const directTable = readString(record, [`${prefix}Table`, `${prefix}TableName`])
  const directColumn = readString(record, [`${prefix}Column`, `${prefix}ColumnName`])
  const endpoint = getCaseInsensitive(record, [prefix, `${prefix}Column`])
  if (!isJsonObject(endpoint)) return { table: directTable, column: directColumn }

  return {
    table: directTable ?? readString(endpoint, ['table', 'tableName']),
    column: directColumn ?? readString(endpoint, ['column', 'columnName', 'name'])
  }
}

function normalizeRelationship(value: JsonObject): ModelRelationship {
  const record = unwrapRecord(value)
  if (!record) {
    throw new SchemaValidationError('Power BI schema contains an invalid relationship record.')
  }
  const name = requireName(
    readString(record, ['name', 'relationshipName']),
    'relationship'
  )
  const from = readEndpoint(record, 'from')
  const to = readEndpoint(record, 'to')
  if (!from.table || !from.column || !to.table || !to.column) {
    throw new SchemaValidationError('Power BI schema contains a relationship without both endpoints.')
  }

  return {
    name,
    fromTable: requireName(from.table, 'relationship endpoint table'),
    fromColumn: requireName(from.column, 'relationship endpoint column'),
    toTable: requireName(to.table, 'relationship endpoint table'),
    toColumn: requireName(to.column, 'relationship endpoint column'),
    fromCardinality: normalizeNullable(readString(record, ['fromCardinality'])),
    toCardinality: normalizeNullable(readString(record, ['toCardinality'])),
    crossFilteringBehavior: normalizeNullable(
      readString(record, ['crossFilteringBehavior', 'crossFilterDirection'])
    ),
    securityFilteringBehavior: normalizeNullable(
      readString(record, ['securityFilteringBehavior'])
    ),
    isActive: readBoolean(record, ['isActive', 'active']) ?? true
  }
}

function normalizeModel(value: unknown, fallbackName: string): ModelMetadata {
  const record = unwrapRecord(value) ?? {}
  return {
    name: readString(record, ['name', 'modelName']) ?? fallbackName,
    description: normalizeNullable(readString(record, ['description'])),
    culture: normalizeNullable(readString(record, ['culture'])),
    compatibilityLevel: readNumber(record, ['compatibilityLevel']),
    discourageImplicitMeasures: readBoolean(record, ['discourageImplicitMeasures'])
  }
}

export function buildModelSnapshot(
  raw: RawModelRead,
  identity: SnapshotIdentity
): SnapshotBuildResult {
  const rawModelName = requireName(
    typeof raw.modelName === 'string' ? raw.modelName.trim() : null,
    'model'
  )
  const tables = raw.tables
    .map(normalizeTable)
    .sort((left, right) => ordinalCompare(left.name, right.name))
  const relationships = raw.relationships
    .map(normalizeRelationship)
    .sort((left, right) => ordinalCompare(left.name, right.name))
  let registry: ModelRegistry
  try {
    registry = new ModelRegistry(tables, relationships)
  } catch (error) {
    throw new SchemaValidationError('Power BI schema failed registry validation.', {
      cause: error
    })
  }
  const model = normalizeModel(raw.model, rawModelName)
  const dateTables = tables.map((table) => ({
    tableName: table.name,
    status: table.dateTableStatus,
    dateColumn: table.dateColumn
  }))
  const statistics = {
    tables: tables.length,
    columns: tables.reduce((total, table) => total + table.columns.length, 0),
    measures: tables.reduce((total, table) => total + table.measures.length, 0),
    relationships: relationships.length
  }
  const hashInput = {
    schemaVersion: 1 as const,
    modelName: rawModelName,
    model,
    tables,
    relationships,
    dateTables
  }
  const snapshot: ModelSnapshot = {
    ...hashInput,
    snapshotId: randomUUID(),
    connectionId: identity.connectionId,
    connectionSessionId: identity.connectionSessionId,
    schemaHash: createSchemaHash(hashInput),
    capturedAt: new Date().toISOString(),
    statistics
  }

  return { snapshot, registry }
}
