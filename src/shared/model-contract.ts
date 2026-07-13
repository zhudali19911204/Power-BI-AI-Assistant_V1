export type DateTableStatus = 'marked' | 'unmarked' | 'unknown'
export type ModelTableKind = 'table' | 'calculatedTable' | 'calculationGroup'
export type ModelColumnKind =
  | 'data'
  | 'calculated'
  | 'calculatedTableColumn'
  | 'rowNumber'
  | 'unknown'

export interface ModelColumn {
  readonly name: string
  readonly dataType: string
  readonly rawDataType: string | null
  readonly kind: ModelColumnKind
  readonly expression: string | null
  readonly formatString: string | null
  readonly description: string | null
  readonly displayFolder: string | null
  readonly dataCategory: string | null
  readonly summarizeBy: string | null
  readonly sortByColumn: string | null
  readonly isHidden: boolean
  readonly isKey: boolean
  readonly isNullable: boolean | null
}

export interface ModelMeasure {
  readonly name: string
  readonly tableName: string
  readonly expression: string | null
  readonly formatString: string | null
  readonly description: string | null
  readonly displayFolder: string | null
  readonly dataType: string | null
  readonly isHidden: boolean
}

export interface ModelTable {
  readonly name: string
  readonly kind: ModelTableKind
  readonly expression: string | null
  readonly description: string | null
  readonly isHidden: boolean
  readonly dateTableStatus: DateTableStatus
  readonly dateColumn: string | null
  readonly columns: readonly ModelColumn[]
  readonly measures: readonly ModelMeasure[]
}

export interface ModelRelationship {
  readonly name: string
  readonly fromTable: string
  readonly fromColumn: string
  readonly toTable: string
  readonly toColumn: string
  readonly fromCardinality: string | null
  readonly toCardinality: string | null
  readonly crossFilteringBehavior: string | null
  readonly securityFilteringBehavior: string | null
  readonly isActive: boolean
}

export interface DateTableInfo {
  readonly tableName: string
  readonly status: DateTableStatus
  readonly dateColumn: string | null
}

export interface ModelMetadata {
  readonly name: string
  readonly description: string | null
  readonly culture: string | null
  readonly compatibilityLevel: number | null
  readonly discourageImplicitMeasures: boolean | null
}

export interface ModelObjectCounts {
  readonly tables: number
  readonly columns: number
  readonly measures: number
  readonly relationships: number
}

export interface ModelSnapshot {
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly connectionId: string
  readonly connectionSessionId: string
  readonly modelName: string
  readonly schemaHash: string
  readonly capturedAt: string
  readonly model: ModelMetadata
  readonly tables: readonly ModelTable[]
  readonly relationships: readonly ModelRelationship[]
  readonly dateTables: readonly DateTableInfo[]
  readonly statistics: ModelObjectCounts
}

export type ModelObjectReference =
  | { readonly kind: 'table'; readonly table: string }
  | { readonly kind: 'column'; readonly table: string; readonly name: string }
  | { readonly kind: 'measure'; readonly table: string; readonly name: string }
