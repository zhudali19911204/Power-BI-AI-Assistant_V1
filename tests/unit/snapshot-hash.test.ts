import { describe, expect, it } from 'vitest'
import { createSchemaHash } from '../../src/main/powerbi/snapshot-hash'
import {
  createHashableSnapshot,
  createModelColumn,
  createModelTable
} from '../fixtures/model-fixtures'

describe('createSchemaHash', () => {
  it('is stable across collection ordering, CRLF/LF, and canonically equivalent Unicode', () => {
    const first = createHashableSnapshot()
    const second = createHashableSnapshot({
      modelName: 'vente\u0301',
      model: {
        ...first.model,
        name: 'vente\u0301',
        description: '测试\n模型'
      },
      tables: [...first.tables].reverse().map((table) => ({
        ...table,
        columns: [...table.columns].reverse(),
        measures: [...table.measures].reverse()
      })),
      relationships: [...first.relationships].reverse(),
      dateTables: [...first.dateTables].reverse()
    })
    const equivalentFirst = createHashableSnapshot({
      modelName: 'venté',
      model: {
        ...first.model,
        name: 'venté'
      }
    })

    expect(createSchemaHash(second)).toBe(createSchemaHash(equivalentFirst))
    expect(createSchemaHash(first)).toHaveLength(64)
  })

  it.each([
    ['model name', (base: ReturnType<typeof createHashableSnapshot>) => ({ ...base, modelName: '其他模型' })],
    ['model setting', (base: ReturnType<typeof createHashableSnapshot>) => ({
      ...base,
      model: { ...base.model, discourageImplicitMeasures: false }
    })],
    ['column type', (base: ReturnType<typeof createHashableSnapshot>) => ({
      ...base,
      tables: base.tables.map((table) =>
        table.name === '销售'
          ? {
              ...table,
              columns: table.columns.map((column) =>
                column.name === '金额' ? { ...column, dataType: 'Double' } : column
              )
            }
          : table
      )
    })],
    ['DAX expression', (base: ReturnType<typeof createHashableSnapshot>) => ({
      ...base,
      tables: base.tables.map((table) => ({
        ...table,
        measures: table.measures.map((measure) => ({
          ...measure,
          expression: "SUMX('销售', '销售'[金额])"
        }))
      }))
    })],
    ['relationship activity', (base: ReturnType<typeof createHashableSnapshot>) => ({
      ...base,
      relationships: base.relationships.map((relationship) => ({
        ...relationship,
        isActive: !relationship.isActive
      }))
    })],
    ['date table status', (base: ReturnType<typeof createHashableSnapshot>) => ({
      ...base,
      dateTables: base.dateTables.map((dateTable) =>
        dateTable.tableName === '日期'
          ? { ...dateTable, status: 'unmarked' as const }
          : dateTable
      )
    })]
  ])('changes when %s changes', (_name, mutate) => {
    const base = createHashableSnapshot()
    expect(createSchemaHash(mutate(base))).not.toBe(createSchemaHash(base))
  })

  it('distinguishes table and column names that include DAX punctuation', () => {
    const base = createHashableSnapshot()
    const changed = createHashableSnapshot({
      tables: [
        ...base.tables,
        createModelTable({
          name: "O'Brien] ",
          columns: [createModelColumn({ name: 'Amount]' })],
          measures: []
        })
      ]
    })

    expect(createSchemaHash(changed)).not.toBe(createSchemaHash(base))
  })
})
