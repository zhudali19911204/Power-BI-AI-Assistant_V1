import type {
  ModelColumn,
  ModelMeasure,
  ModelRelationship,
  ModelSnapshot,
  ModelTable
} from '../../src/shared/model-contract'
import type {
  InternalConnectionHandle,
  InternalDesktopModel,
  RawModelRead
} from '../../src/main/powerbi/powerbi-read-adapter'

export function createModelColumn(
  overrides: Partial<ModelColumn> = {}
): ModelColumn {
  return {
    name: '金额',
    dataType: 'Decimal',
    rawDataType: 'Decimal',
    kind: 'data',
    expression: null,
    formatString: '#,0.00',
    description: null,
    displayFolder: null,
    dataCategory: null,
    summarizeBy: 'Sum',
    sortByColumn: null,
    isHidden: false,
    isKey: false,
    isNullable: true,
    ...overrides
  }
}

export function createModelMeasure(
  overrides: Partial<ModelMeasure> = {}
): ModelMeasure {
  return {
    name: '总销售额',
    tableName: '销售',
    expression: "SUM('销售'[金额])",
    formatString: '¥#,0.00',
    description: '含税销售额',
    displayFolder: '核心指标',
    dataType: 'Decimal',
    isHidden: false,
    ...overrides
  }
}

export function createModelTable(
  overrides: Partial<ModelTable> = {}
): ModelTable {
  return {
    name: '销售',
    kind: 'table',
    expression: null,
    description: '销售事实表',
    isHidden: false,
    dateTableStatus: 'unmarked',
    dateColumn: null,
    columns: [createModelColumn()],
    measures: [createModelMeasure()],
    ...overrides
  }
}

export function createModelRelationship(
  overrides: Partial<ModelRelationship> = {}
): ModelRelationship {
  return {
    name: '销售日期',
    fromTable: '销售',
    fromColumn: '日期键',
    toTable: '日期',
    toColumn: '日期',
    fromCardinality: 'Many',
    toCardinality: 'One',
    crossFilteringBehavior: 'OneDirection',
    securityFilteringBehavior: 'OneDirection',
    isActive: true,
    ...overrides
  }
}

export function createHashableSnapshot(
  overrides: Partial<
    Pick<
      ModelSnapshot,
      'schemaVersion' | 'modelName' | 'model' | 'tables' | 'relationships' | 'dateTables'
    >
  > = {}
): Pick<
  ModelSnapshot,
  'schemaVersion' | 'modelName' | 'model' | 'tables' | 'relationships' | 'dateTables'
> {
  const dateTable = createModelTable({
    name: '日期',
    dateTableStatus: 'marked',
    dateColumn: '日期',
    columns: [
      createModelColumn({
        name: '日期',
        dataType: 'DateTime',
        rawDataType: 'DateTime',
        formatString: 'yyyy-MM-dd',
        summarizeBy: 'None'
      })
    ],
    measures: []
  })
  const salesTable = createModelTable({
    columns: [
      createModelColumn(),
      createModelColumn({
        name: '日期键',
        dataType: 'DateTime',
        rawDataType: 'DateTime',
        formatString: 'yyyy-MM-dd',
        summarizeBy: 'None'
      })
    ]
  })

  return {
    schemaVersion: 1,
    modelName: '销售模型',
    model: {
      name: '销售模型',
      description: '测试\r\n模型',
      culture: 'zh-CN',
      compatibilityLevel: 1601,
      discourageImplicitMeasures: true
    },
    tables: [salesTable, dateTable],
    relationships: [createModelRelationship()],
    dateTables: [
      { tableName: '销售', status: 'unmarked', dateColumn: null },
      { tableName: '日期', status: 'marked', dateColumn: '日期' }
    ],
    ...overrides
  }
}

export function createRawModelRead(): RawModelRead {
  return {
    modelName: '销售模型',
    model: {
      Definition: {
        Name: '销售模型',
        Description: '测试\r\n模型',
        Culture: 'zh-CN',
        CompatibilityLevel: '1601',
        DiscourageImplicitMeasures: 'true'
      }
    },
    tables: [
      {
        name: '销售',
        summary: { Name: '销售', IsHidden: false },
        detail: [
          {
            Definition: {
              Name: '销售',
              Description: '销售\r\n事实表',
              IsDateTable: false
            }
          }
        ],
        columns: [
          {
            Definition: {
              Name: '日期键',
              DataType: 'DateTime',
              SourceColumn: 'OrderDate',
              FormatString: 'yyyy-MM-dd',
              SummarizeBy: 'None',
              IsNullable: false
            }
          },
          {
            Definition: {
              Name: '金额',
              DataType: 'Decimal',
              SourceColumn: 'Amount',
              FormatString: '#,0.00',
              Description: '含税金额',
              SummarizeBy: 'Sum'
            }
          }
        ],
        measures: [
          {
            Definition: {
              Name: '总销售额',
              TableName: '销售',
              DaxExpression: "SUM('销售'[金额])",
              FormatString: '¥#,0.00',
              DisplayFolder: '核心指标',
              DataType: 'Decimal'
            }
          }
        ]
      },
      {
        name: '日期',
        summary: { Name: '日期' },
        detail: [
          {
            Definition: {
              Name: '日期',
              IsDateTable: true,
              DateColumnName: '日期'
            }
          }
        ],
        columns: [
          {
            Definition: {
              Name: '日期',
              DataType: 'DateTime',
              SourceColumn: 'Date',
              IsKey: true,
              IsNullable: false
            }
          }
        ],
        measures: []
      }
    ],
    relationships: [
      {
        Definition: {
          Name: '销售日期',
          From: { Table: '销售', Column: '日期键' },
          To: { Table: '日期', Column: '日期' },
          FromCardinality: 'Many',
          ToCardinality: 'One',
          CrossFilterDirection: 'OneDirection',
          IsActive: true
        }
      }
    ]
  }
}

export function createDesktopModel(
  overrides: Partial<InternalDesktopModel> = {}
): InternalDesktopModel {
  return {
    fingerprint: 'desktop-model-a',
    displayName: '销售分析.pbix',
    modelName: '销售模型',
    disambiguator: 'PID 100',
    connectionString: 'Data Source=localhost:50000',
    dataSource: 'localhost:50000',
    initialCatalog: '销售模型',
    ...overrides
  }
}

export function createConnectionHandle(
  overrides: Partial<InternalConnectionHandle> = {}
): InternalConnectionHandle {
  return {
    connectionName: 'connection-a',
    instanceFingerprint: 'desktop-model-a',
    displayName: '销售分析.pbix',
    modelName: '销售模型',
    ...overrides
  }
}
