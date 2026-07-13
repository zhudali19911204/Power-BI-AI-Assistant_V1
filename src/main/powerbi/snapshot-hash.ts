import { createHash } from 'node:crypto'
import type { ModelSnapshot } from '../../shared/model-contract'

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeText(value: string | null): string | null {
  return value?.normalize('NFC').replaceAll('\r\n', '\n') ?? null
}

type HashableSnapshot = Omit<
  ModelSnapshot,
  | 'snapshotId'
  | 'connectionId'
  | 'connectionSessionId'
  | 'schemaHash'
  | 'capturedAt'
  | 'statistics'
>

export function createSchemaHash(snapshot: HashableSnapshot): string {
  const canonical = {
    schemaVersion: snapshot.schemaVersion,
    modelName: normalizeText(snapshot.modelName),
    model: {
      name: normalizeText(snapshot.model.name),
      description: normalizeText(snapshot.model.description),
      culture: normalizeText(snapshot.model.culture),
      compatibilityLevel: snapshot.model.compatibilityLevel,
      discourageImplicitMeasures: snapshot.model.discourageImplicitMeasures
    },
    tables: [...snapshot.tables]
      .sort((left, right) => ordinalCompare(left.name, right.name))
      .map((table) => ({
        name: normalizeText(table.name),
        kind: table.kind,
        expression: normalizeText(table.expression),
        description: normalizeText(table.description),
        isHidden: table.isHidden,
        dateTableStatus: table.dateTableStatus,
        dateColumn: normalizeText(table.dateColumn),
        columns: [...table.columns]
          .sort((left, right) => ordinalCompare(left.name, right.name))
          .map((column) => ({
            name: normalizeText(column.name),
            dataType: normalizeText(column.dataType),
            rawDataType: normalizeText(column.rawDataType),
            kind: column.kind,
            expression: normalizeText(column.expression),
            formatString: normalizeText(column.formatString),
            description: normalizeText(column.description),
            displayFolder: normalizeText(column.displayFolder),
            dataCategory: normalizeText(column.dataCategory),
            summarizeBy: normalizeText(column.summarizeBy),
            sortByColumn: normalizeText(column.sortByColumn),
            isHidden: column.isHidden,
            isKey: column.isKey,
            isNullable: column.isNullable
          })),
        measures: [...table.measures]
          .sort((left, right) => ordinalCompare(left.name, right.name))
          .map((measure) => ({
            name: normalizeText(measure.name),
            tableName: normalizeText(measure.tableName),
            expression: normalizeText(measure.expression),
            formatString: normalizeText(measure.formatString),
            description: normalizeText(measure.description),
            displayFolder: normalizeText(measure.displayFolder),
            dataType: normalizeText(measure.dataType),
            isHidden: measure.isHidden
          }))
      })),
    relationships: [...snapshot.relationships]
      .sort((left, right) => ordinalCompare(left.name, right.name))
      .map((relationship) => ({
        name: normalizeText(relationship.name),
        fromTable: normalizeText(relationship.fromTable),
        fromColumn: normalizeText(relationship.fromColumn),
        toTable: normalizeText(relationship.toTable),
        toColumn: normalizeText(relationship.toColumn),
        fromCardinality: normalizeText(relationship.fromCardinality),
        toCardinality: normalizeText(relationship.toCardinality),
        crossFilteringBehavior: normalizeText(relationship.crossFilteringBehavior),
        securityFilteringBehavior: normalizeText(relationship.securityFilteringBehavior),
        isActive: relationship.isActive
      })),
    dateTables: [...snapshot.dateTables]
      .sort((left, right) => ordinalCompare(left.tableName, right.tableName))
      .map((dateTable) => ({
        tableName: normalizeText(dateTable.tableName),
        status: dateTable.status,
        dateColumn: normalizeText(dateTable.dateColumn)
      }))
  }

  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}
