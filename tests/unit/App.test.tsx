import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantApi } from '../../src/shared/app-contract'
import type { ConnectionViewState } from '../../src/shared/connection-contract'
import type { ModelSnapshot } from '../../src/shared/model-contract'
import { apiSuccess } from '../../src/shared/result-contract'
import { App } from '../../src/renderer/src/App'

const noModelsState: ConnectionViewState = {
  phase: 'no_models',
  candidates: [],
  activeConnection: null,
  disconnectReason: null,
  error: null,
  updatedAt: '2026-07-13T02:00:00.000Z'
}

const candidates = [
  {
    candidateId: '11111111-1111-4111-8111-111111111111',
    displayName: '销售分析.pbix',
    modelName: '销售模型',
    source: 'power-bi-desktop' as const,
    disambiguator: 'localhost:51111'
  },
  {
    candidateId: '22222222-2222-4222-8222-222222222222',
    displayName: '客户分析.pbix',
    modelName: '客户模型',
    source: 'power-bi-desktop' as const,
    disambiguator: 'localhost:52222'
  }
]

const selectionState: ConnectionViewState = {
  phase: 'selection_required',
  candidates,
  activeConnection: null,
  disconnectReason: null,
  error: null,
  updatedAt: '2026-07-13T02:01:00.000Z'
}

const connectedState: ConnectionViewState = {
  phase: 'connected',
  candidates,
  activeConnection: {
    connectionId: '33333333-3333-4333-8333-333333333333',
    modelName: '销售模型',
    displayName: '销售分析.pbix',
    connectedAt: '2026-07-13T02:02:00.000Z',
    objectCounts: { tables: 2, columns: 3, measures: 1, relationships: 1 }
  },
  disconnectReason: null,
  error: null,
  updatedAt: '2026-07-13T02:02:00.000Z'
}

const snapshot: ModelSnapshot = {
  schemaVersion: 1,
  snapshotId: 'snapshot-1',
  connectionId: '33333333-3333-4333-8333-333333333333',
  connectionSessionId: 'session-1',
  modelName: '销售模型',
  schemaHash: 'hash-1',
  capturedAt: '2026-07-13T02:02:00.000Z',
  model: {
    name: '销售模型',
    description: '销售分析模型',
    culture: 'zh-CN',
    compatibilityLevel: 1601,
    discourageImplicitMeasures: true
  },
  tables: [
    {
      name: '销售事实',
      kind: 'table',
      expression: null,
      description: '销售明细',
      isHidden: false,
      dateTableStatus: 'unknown',
      dateColumn: null,
      columns: [
        {
          name: '销售额',
          dataType: 'Decimal',
          rawDataType: 'decimal',
          kind: 'data',
          expression: null,
          formatString: '#,0.00',
          description: '订单销售额',
          displayFolder: null,
          dataCategory: null,
          summarizeBy: 'Sum',
          sortByColumn: null,
          isHidden: false,
          isKey: false,
          isNullable: false
        },
        {
          name: '客户键',
          dataType: 'Int64',
          rawDataType: 'int64',
          kind: 'data',
          expression: null,
          formatString: null,
          description: null,
          displayFolder: null,
          dataCategory: null,
          summarizeBy: 'None',
          sortByColumn: null,
          isHidden: true,
          isKey: false,
          isNullable: false
        }
      ],
      measures: [
        {
          name: '总销售额',
          tableName: '销售事实',
          expression: "SUM('销售事实'[销售额])",
          formatString: '¥#,0.00',
          description: '当前筛选上下文的销售额',
          displayFolder: 'KPI',
          dataType: 'Decimal',
          isHidden: false
        }
      ]
    },
    {
      name: '客户',
      kind: 'table',
      expression: null,
      description: '客户维度',
      isHidden: false,
      dateTableStatus: 'unknown',
      dateColumn: null,
      columns: [
        {
          name: '客户键',
          dataType: 'Int64',
          rawDataType: 'int64',
          kind: 'data',
          expression: null,
          formatString: null,
          description: null,
          displayFolder: null,
          dataCategory: null,
          summarizeBy: 'None',
          sortByColumn: null,
          isHidden: false,
          isKey: true,
          isNullable: false
        }
      ],
      measures: []
    }
  ],
  relationships: [
    {
      name: 'relationship-1',
      fromTable: '销售事实',
      fromColumn: '客户键',
      toTable: '客户',
      toColumn: '客户键',
      fromCardinality: 'Many',
      toCardinality: 'One',
      crossFilteringBehavior: 'Single',
      securityFilteringBehavior: 'OneDirection',
      isActive: true
    }
  ],
  dateTables: [],
  statistics: { tables: 2, columns: 3, measures: 1, relationships: 1 }
}

let stateListener: ((state: ConnectionViewState) => void) | null

function installApi(initialState: ConnectionViewState): AssistantApi {
  const api: AssistantApi = {
    getAppInfo: vi.fn().mockResolvedValue({
      name: 'Power BI 智能助手',
      version: '0.2.0',
      stage: 1
    }),
    listModels: vi.fn().mockResolvedValue(apiSuccess(initialState)),
    connectModel: vi.fn().mockResolvedValue(apiSuccess(connectedState)),
    disconnectModel: vi.fn().mockResolvedValue(
      apiSuccess({
        ...noModelsState,
        phase: 'disconnected',
        disconnectReason: 'user'
      })
    ),
    reconnectModel: vi.fn().mockResolvedValue(apiSuccess(initialState)),
    getConnectionState: vi.fn().mockResolvedValue(apiSuccess(initialState)),
    getModelSnapshot: vi.fn().mockResolvedValue(apiSuccess(snapshot)),
    onConnectionStateChanged: vi.fn((listener: (state: ConnectionViewState) => void) => {
      stateListener = listener
      return vi.fn()
    })
  }
  window.powerBiAssistant = api
  return api
}

describe('App 阶段 1 连接与模型浏览', () => {
  beforeEach(() => {
    stateListener = null
  })

  afterEach(() => {
    cleanup()
  })

  it('启动时自动扫描，未发现模型时显示指引并可重新扫描', async () => {
    const api = installApi(noModelsState)
    render(<App />)

    expect(await screen.findByRole('heading', { name: '先打开一个 Power BI 模型' })).toBeInTheDocument()
    expect(screen.getByText('打开 .pbix 文件')).toBeInTheDocument()
    expect(screen.getByText('版本 0.2.0')).toBeInTheDocument()
    expect(api.listModels).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /重新扫描/ }))
    await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(2))
  })

  it('多模型时要求选择，并连接指定模型', async () => {
    const api = installApi(selectionState)
    render(<App />)

    expect(await screen.findByRole('heading', { name: '选择要连接的模型' })).toBeInTheDocument()
    const connectButton = screen.getByRole('button', { name: '连接所选模型' })
    expect(connectButton).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', { name: /客户分析\.pbix/ }))
    expect(connectButton).toBeEnabled()
    fireEvent.click(connectButton)

    await waitFor(() =>
      expect(api.connectModel).toHaveBeenCalledWith({
        candidateId: '22222222-2222-4222-8222-222222222222'
      })
    )
    expect(await screen.findByRole('heading', { name: '模型架构' })).toBeInTheDocument()
  })

  it('连接后可搜索真实对象、查看只读 DAX 和关系', async () => {
    installApi(connectedState)
    render(<App />)

    expect(await screen.findByRole('heading', { name: '模型架构' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '总销售额' }))
    expect(screen.getByText("SUM('销售事实'[销售额])")).toBeInTheDocument()
    expect(screen.getByLabelText('DAX 定义')).toHaveTextContent('只读')

    fireEvent.click(screen.getByRole('button', { name: '销售事实' }))
    expect(screen.getByText('日期标记状态未知')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索模型对象' }), {
      target: { value: '不存在的对象' }
    })
    expect(screen.getByText('未找到匹配对象')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    fireEvent.click(screen.getByRole('tab', { name: /关系/ }))
    expect(screen.getByText('relationship-1')).toBeInTheDocument()
    expect(screen.getByText('活动')).toBeInTheDocument()
  })

  it('连接断开时立即清除旧模型快照', async () => {
    installApi(connectedState)
    render(<App />)

    expect(await screen.findByRole('heading', { name: '模型架构' })).toBeInTheDocument()
    expect(screen.getByText('销售事实')).toBeInTheDocument()

    act(() => {
      stateListener?.({
        phase: 'disconnected',
        candidates: [],
        activeConnection: null,
        disconnectReason: 'model_closed',
        error: null,
        updatedAt: '2026-07-13T02:03:00.000Z'
      })
    })

    expect(screen.queryByRole('heading', { name: '模型架构' })).not.toBeInTheDocument()
    expect(screen.queryByText('销售事实')).not.toBeInTheDocument()
    expect(screen.getByText('已连接的 Power BI Desktop 模型已关闭。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新连接/ })).toBeInTheDocument()
  })
})
