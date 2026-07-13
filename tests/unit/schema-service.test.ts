import { describe, expect, it } from 'vitest'
import {
  buildModelSnapshot,
  SchemaValidationError
} from '../../src/main/powerbi/schema-service'
import { createRawModelRead } from '../fixtures/model-fixtures'

describe('buildModelSnapshot', () => {
  it('normalizes MCP variants into a sorted, grounded model snapshot', () => {
    const result = buildModelSnapshot(createRawModelRead(), {
      connectionId: 'connection-1',
      connectionSessionId: 'session-1'
    })
    const { snapshot, registry } = result

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      connectionId: 'connection-1',
      connectionSessionId: 'session-1',
      modelName: '销售模型',
      model: {
        name: '销售模型',
        description: '测试\n模型',
        culture: 'zh-CN',
        compatibilityLevel: 1601,
        discourageImplicitMeasures: true
      },
      statistics: { tables: 2, columns: 3, measures: 1, relationships: 1 }
    })
    expect(snapshot.snapshotId).toMatch(/^[0-9a-f-]{36}$/)
    expect(snapshot.schemaHash).toMatch(/^[0-9a-f]{64}$/)
    expect(snapshot.tables.map((table) => table.name)).toEqual(['日期', '销售'])

    const sales = snapshot.tables.find((table) => table.name === '销售')
    expect(sales).toMatchObject({
      kind: 'table',
      description: '销售\n事实表',
      dateTableStatus: 'unmarked',
      columns: [
        { name: '日期键', kind: 'data', dataType: 'DateTime', isNullable: false },
        { name: '金额', kind: 'data', dataType: 'Decimal', description: '含税金额' }
      ],
      measures: [
        {
          name: '总销售额',
          tableName: '销售',
          expression: "SUM('销售'[金额])",
          displayFolder: '核心指标'
        }
      ]
    })
    expect(snapshot.dateTables).toEqual([
      { tableName: '日期', status: 'marked', dateColumn: '日期' },
      { tableName: '销售', status: 'unmarked', dateColumn: null }
    ])
    expect(snapshot.relationships[0]).toMatchObject({
      name: '销售日期',
      fromTable: '销售',
      fromColumn: '日期键',
      toTable: '日期',
      toColumn: '日期',
      isActive: true
    })
    expect(registry.resolveColumn('销售', '金额')).toBe(sales?.columns[1])
    expect(registry.resolveMeasure('总销售额')).toBe(sales?.measures[0])
  })

  it('does not infer a marked date table from its name or date-like column', () => {
    const original = createRawModelRead()
    const raw = {
      ...original,
      tables: original.tables.map((table) =>
        table.name === '日期'
          ? { ...table, detail: [{ Definition: { Name: '日期' } }] }
          : table
      )
    }

    const { snapshot } = buildModelSnapshot(raw, {
      connectionId: 'connection-1',
      connectionSessionId: 'session-1'
    })

    expect(snapshot.dateTables[0]).toEqual({
      tableName: '日期',
      status: 'unknown',
      dateColumn: null
    })
  })

  it('rejects a partial schema with an invalid relationship endpoint', () => {
    const original = createRawModelRead()
    const raw = {
      ...original,
      relationships: [
        {
          Definition: {
            Name: '无效关系',
            From: { Table: '销售', Column: '不存在' },
            To: { Table: '日期', Column: '日期' }
          }
        }
      ]
    }

    expect(() =>
      buildModelSnapshot(raw, {
        connectionId: 'connection-1',
        connectionSessionId: 'session-1'
      })
    ).toThrow(SchemaValidationError)
  })

  it.each([
    ['column', (raw: ReturnType<typeof createRawModelRead>) => {
      const sales = raw.tables[0]!
      return {
        ...raw,
        tables: [
          {
            ...sales,
            columns: [{ Definition: { DataType: 'Decimal' } }]
          },
          raw.tables[1]!
        ]
      }
    }],
    ['measure', (raw: ReturnType<typeof createRawModelRead>) => {
      const sales = raw.tables[0]!
      return {
        ...raw,
        tables: [
          {
            ...sales,
            measures: [{ Definition: { DaxExpression: '1' } }]
          },
          raw.tables[1]!
        ]
      }
    }],
    ['relationship name', (raw: ReturnType<typeof createRawModelRead>) => ({
      ...raw,
      relationships: [
        {
          Definition: {
            From: { Table: '销售', Column: '日期键' },
            To: { Table: '日期', Column: '日期' }
          }
        }
      ]
    })],
    ['relationship endpoint', (raw: ReturnType<typeof createRawModelRead>) => ({
      ...raw,
      relationships: [
        {
          Definition: {
            Name: '缺端点关系',
            From: { Table: '销售', Column: '日期键' }
          }
        }
      ]
    })]
  ])('rejects an unnamed or incomplete %s instead of publishing a partial snapshot', (_, mutate) => {
    expect(() =>
      buildModelSnapshot(mutate(createRawModelRead()), {
        connectionId: 'connection-1',
        connectionSessionId: 'session-1'
      })
    ).toThrow(SchemaValidationError)
  })

  it('rejects columns without a grounded data type', () => {
    const raw = createRawModelRead()
    const sales = raw.tables[0]!
    const invalid = {
      ...raw,
      tables: [
        {
          ...sales,
          columns: [{ Definition: { Name: '金额' } }]
        },
        raw.tables[1]!
      ]
    }

    expect(() =>
      buildModelSnapshot(invalid, {
        connectionId: 'connection-1',
        connectionSessionId: 'session-1'
      })
    ).toThrow('without a data type')
  })

  it('rejects measures without a grounded DAX expression', () => {
    const raw = createRawModelRead()
    const sales = raw.tables[0]!
    const invalid = {
      ...raw,
      tables: [
        {
          ...sales,
          measures: [{ Definition: { Name: '空度量值', TableName: '销售' } }]
        },
        raw.tables[1]!
      ]
    }

    expect(() =>
      buildModelSnapshot(invalid, {
        connectionId: 'connection-1',
        connectionSessionId: 'session-1'
      })
    ).toThrow('without a DAX expression')
  })

  it('keeps calculated-table output columns distinct from expression-bearing calculated columns', () => {
    const raw = createRawModelRead()
    const sales = raw.tables[0]!
    const snapshot = buildModelSnapshot(
      {
        ...raw,
        tables: [
          {
            ...sales,
            columns: [
              ...sales.columns,
              {
                Definition: {
                  Name: '计算表派生列',
                  ColumnType: 'CalculatedTableColumn',
                  DataType: 'String'
                }
              }
            ]
          },
          raw.tables[1]!
        ]
      },
      {
        connectionId: 'connection-1',
        connectionSessionId: 'session-1'
      }
    ).snapshot

    expect(
      snapshot.tables
        .find((table) => table.name === '销售')
        ?.columns.find((column) => column.name === '计算表派生列')
    ).toMatchObject({ kind: 'calculatedTableColumn', expression: null })
  })

  it.each([
    ['column', (raw: ReturnType<typeof createRawModelRead>) => {
      const sales = raw.tables[0]!
      return {
        ...raw,
        tables: [
          {
            ...sales,
            columns: [
              { Definition: { Name: '计算列', Type: 'Calculated', DataType: 'Decimal' } }
            ]
          },
          raw.tables[1]!
        ]
      }
    }],
    ['table', (raw: ReturnType<typeof createRawModelRead>) => {
      const sales = raw.tables[0]!
      return {
        ...raw,
        tables: [
          {
            ...sales,
            detail: [{ Definition: { Name: '销售', Type: 'CalculatedTable' } }]
          },
          raw.tables[1]!
        ]
      }
    }]
  ])('rejects a calculated %s without an expression', (_, mutate) => {
    expect(() =>
      buildModelSnapshot(mutate(createRawModelRead()), {
        connectionId: 'connection-1',
        connectionSessionId: 'session-1'
      })
    ).toThrow('without an expression')
  })
})
