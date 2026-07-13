import type {
  ModelColumn,
  ModelMeasure,
  ModelObjectReference,
  ModelRelationship,
  ModelTable
} from '../../shared/model-contract'

function canonicalName(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase('en-US')
}

function assertValidName(name: string, kind: string): void {
  if (name.trim().length === 0 || name.length > 512) {
    throw new Error(`Model contains an invalid ${kind} name.`)
  }
}

function objectKey(table: string, name: string): string {
  return `${canonicalName(table)}\u001f${canonicalName(name)}`
}

export class ModelRegistry {
  private readonly tables = new Map<string, ModelTable>()
  private readonly columns = new Map<string, ModelColumn>()
  private readonly measures = new Map<string, ModelMeasure>()
  private readonly globalMeasures = new Map<string, ModelMeasure>()
  private readonly relationshipNames = new Set<string>()

  constructor(
    modelTables: readonly ModelTable[],
    relationships: readonly ModelRelationship[]
  ) {
    for (const table of modelTables) {
      assertValidName(table.name, 'table')
      const tableKey = canonicalName(table.name)
      if (this.tables.has(tableKey)) {
        throw new Error('Model contains duplicate or case-equivalent table names.')
      }
      this.tables.set(tableKey, table)

      for (const column of table.columns) {
        assertValidName(column.name, 'column')
        const key = objectKey(table.name, column.name)
        if (this.columns.has(key)) {
          throw new Error('Model contains duplicate or case-equivalent column names.')
        }
        this.columns.set(key, column)
      }

      for (const measure of table.measures) {
        assertValidName(measure.name, 'measure')
        const key = objectKey(table.name, measure.name)
        const globalKey = canonicalName(measure.name)
        if (this.measures.has(key) || this.globalMeasures.has(globalKey)) {
          throw new Error('Model contains duplicate or ambiguous measure names.')
        }
        this.measures.set(key, measure)
        this.globalMeasures.set(globalKey, measure)
      }
    }

    for (const relationship of relationships) {
      assertValidName(relationship.name, 'relationship')
      const relationshipKey = canonicalName(relationship.name)
      if (this.relationshipNames.has(relationshipKey)) {
        throw new Error('Model contains duplicate or case-equivalent relationship names.')
      }
      this.relationshipNames.add(relationshipKey)

      if (
        !this.resolveColumn(relationship.fromTable, relationship.fromColumn) ||
        !this.resolveColumn(relationship.toTable, relationship.toColumn)
      ) {
        throw new Error('Model relationship references an unknown table or column.')
      }
    }
  }

  has(reference: ModelObjectReference): boolean {
    return this.get(reference) !== undefined
  }

  get(reference: ModelObjectReference): ModelTable | ModelColumn | ModelMeasure | undefined {
    if (reference.kind === 'table') return this.resolveTable(reference.table)
    if (reference.kind === 'column') return this.resolveColumn(reference.table, reference.name)
    return this.resolveMeasure(reference.name, reference.table)
  }

  resolveTable(name: string): ModelTable | undefined {
    return this.tables.get(canonicalName(name))
  }

  resolveColumn(table: string, name: string): ModelColumn | undefined {
    return this.columns.get(objectKey(table, name))
  }

  resolveMeasure(name: string, table?: string): ModelMeasure | undefined {
    return table
      ? this.measures.get(objectKey(table, name))
      : this.globalMeasures.get(canonicalName(name))
  }
}
