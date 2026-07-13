import { describe, expect, it } from 'vitest'
import { ModelRegistry } from '../../src/main/powerbi/model-registry'
import {
  createModelColumn,
  createModelMeasure,
  createModelRelationship,
  createModelTable
} from '../fixtures/model-fixtures'

describe('ModelRegistry', () => {
  it('grounds table, column, and measure references case-insensitively', () => {
    const table = createModelTable({
      name: "O'Brien] ",
      columns: [createModelColumn({ name: 'Amount]' })],
      measures: [createModelMeasure({ name: '净销售', tableName: "O'Brien] " })]
    })
    const registry = new ModelRegistry([table], [])

    expect(registry.resolveTable("o'brien] ")).toBe(table)
    expect(registry.resolveColumn("O'BRIEN] ", 'amount]')).toBe(table.columns[0])
    expect(registry.resolveMeasure('净销售')).toBe(table.measures[0])
    expect(registry.has({ kind: 'measure', table: "O'Brien] ", name: '净销售' })).toBe(true)
    expect(registry.has({ kind: 'column', table: "O'Brien] ", name: '不存在' })).toBe(false)
  })

  it.each([
    [
      'case-equivalent tables',
      [createModelTable({ name: '销售' }), createModelTable({ name: '销售'.toUpperCase() })]
    ],
    [
      'canonically equivalent tables',
      [createModelTable({ name: 'Café' }), createModelTable({ name: 'Cafe\u0301' })]
    ],
    [
      'case-equivalent columns',
      [
        createModelTable({
          columns: [createModelColumn({ name: 'Amount' }), createModelColumn({ name: 'amount' })]
        })
      ]
    ],
    [
      'globally ambiguous measures',
      [
        createModelTable({
          name: 'A',
          columns: [],
          measures: [createModelMeasure({ name: 'Total', tableName: 'A' })]
        }),
        createModelTable({
          name: 'B',
          columns: [],
          measures: [createModelMeasure({ name: 'total', tableName: 'B' })]
        })
      ]
    ]
  ])('rejects %s', (_description, tables) => {
    expect(() => new ModelRegistry(tables, [])).toThrow()
  })

  it.each(['', '   ', 'x'.repeat(513)])('rejects invalid object name %j', (name) => {
    expect(() => new ModelRegistry([createModelTable({ name })], [])).toThrow(
      'invalid table name'
    )
  })

  it('rejects a relationship whose endpoint is absent from the registry', () => {
    const sales = createModelTable({
      columns: [createModelColumn({ name: '日期键' })],
      measures: []
    })
    const date = createModelTable({
      name: '日期',
      columns: [createModelColumn({ name: '日期' })],
      measures: []
    })

    expect(
      () =>
        new ModelRegistry(
          [sales, date],
          [createModelRelationship({ toColumn: '不存在' })]
        )
    ).toThrow('relationship references an unknown table or column')
  })

  it('rejects duplicate or case-equivalent relationship identities', () => {
    const sales = createModelTable({
      columns: [createModelColumn({ name: '日期键' })],
      measures: []
    })
    const date = createModelTable({
      name: '日期',
      columns: [createModelColumn({ name: '日期' })],
      measures: []
    })

    expect(
      () =>
        new ModelRegistry(
          [sales, date],
          [
            createModelRelationship({ name: 'SalesDate' }),
            createModelRelationship({ name: 'salesdate' })
          ]
        )
    ).toThrow('duplicate or case-equivalent relationship names')
  })
})
