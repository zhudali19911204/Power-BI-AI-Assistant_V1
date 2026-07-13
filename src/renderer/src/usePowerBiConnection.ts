import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppInfo } from '../../shared/app-contract'
import type {
  ConnectionViewState,
  DesktopModelCandidate
} from '../../shared/connection-contract'
import type { ModelSnapshot } from '../../shared/model-contract'
import type { ApiError, ApiResult } from '../../shared/result-contract'

const initialAppInfo: AppInfo = {
  name: 'Power BI 智能助手',
  version: '读取中',
  stage: 1
}

const initialConnectionState: ConnectionViewState = {
  phase: 'discovering',
  candidates: [],
  activeConnection: null,
  disconnectReason: 'initial',
  error: null,
  updatedAt: new Date(0).toISOString()
}

function unexpectedError(): ApiError {
  return {
    code: 'INTERNAL_ERROR',
    message: '本地连接服务暂时无法响应，请重试。',
    retryable: true
  }
}

export interface PowerBiUiState {
  readonly appInfo: AppInfo
  readonly connection: ConnectionViewState
  readonly snapshot: ModelSnapshot | null
  readonly schemaLoading: boolean
  readonly schemaError: string | null
  readonly discover: () => Promise<void>
  readonly connect: (candidate: DesktopModelCandidate) => Promise<void>
  readonly disconnect: () => Promise<void>
  readonly reconnect: () => Promise<void>
}

export function usePowerBiConnection(): PowerBiUiState {
  const [appInfo, setAppInfo] = useState<AppInfo>(initialAppInfo)
  const [connection, setConnection] = useState<ConnectionViewState>(initialConnectionState)
  const [snapshot, setSnapshot] = useState<ModelSnapshot | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError] = useState<string | null>(null)

  const mountedRef = useRef(false)
  const initialLoadStartedRef = useRef(false)
  const activeConnectionIdRef = useRef<string | null>(null)
  const snapshotRef = useRef<ModelSnapshot | null>(null)
  const snapshotRequestRef = useRef(0)
  const snapshotLoadingForRef = useRef<string | null>(null)

  const clearSnapshot = useCallback((): void => {
    snapshotRequestRef.current += 1
    snapshotLoadingForRef.current = null
    snapshotRef.current = null
    setSnapshot(null)
    setSchemaLoading(false)
    setSchemaError(null)
  }, [])

  const loadSnapshot = useCallback(async (connectionId: string): Promise<void> => {
    if (
      snapshotRef.current?.connectionId === connectionId ||
      snapshotLoadingForRef.current === connectionId
    ) {
      return
    }

    const requestId = snapshotRequestRef.current + 1
    snapshotRequestRef.current = requestId
    snapshotLoadingForRef.current = connectionId
    setSchemaLoading(true)
    setSchemaError(null)

    try {
      const result = await window.powerBiAssistant.getModelSnapshot({ connectionId })
      if (
        !mountedRef.current ||
        requestId !== snapshotRequestRef.current ||
        activeConnectionIdRef.current !== connectionId
      ) {
        return
      }

      snapshotLoadingForRef.current = null
      setSchemaLoading(false)
      if (!result.ok) {
        snapshotRef.current = null
        setSnapshot(null)
        setSchemaError(result.error.message)
        return
      }

      if (!result.data) {
        snapshotRef.current = null
        setSnapshot(null)
        setSchemaError('模型架构尚未就绪，请重新连接。')
        return
      }

      snapshotRef.current = result.data
      setSnapshot(result.data)
    } catch {
      if (
        mountedRef.current &&
        requestId === snapshotRequestRef.current &&
        activeConnectionIdRef.current === connectionId
      ) {
        snapshotLoadingForRef.current = null
        setSchemaLoading(false)
        setSchemaError('读取模型架构失败，请重新连接。')
      }
    }
  }, [])

  const applyConnectionState = useCallback(
    (next: ConnectionViewState): void => {
      if (!mountedRef.current) return

      const nextConnectionId =
        next.phase === 'connected' ? (next.activeConnection?.connectionId ?? null) : null
      activeConnectionIdRef.current = nextConnectionId
      setConnection(next)

      if (!nextConnectionId) {
        clearSnapshot()
        return
      }

      if (snapshotRef.current?.connectionId !== nextConnectionId) {
        snapshotRef.current = null
        setSnapshot(null)
        setSchemaError(null)
        void loadSnapshot(nextConnectionId)
      }
    },
    [clearSnapshot, loadSnapshot]
  )

  const applyFailure = useCallback(
    (error: ApiError): void => {
      applyConnectionState({
        phase: 'error',
        candidates: [],
        activeConnection: null,
        disconnectReason: 'connection_failed',
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable
        },
        updatedAt: new Date().toISOString()
      })
    },
    [applyConnectionState]
  )

  const handleResult = useCallback(
    (result: ApiResult<ConnectionViewState>): void => {
      if (result.ok) applyConnectionState(result.data)
      else applyFailure(result.error)
    },
    [applyConnectionState, applyFailure]
  )

  const perform = useCallback(
    async (
      optimisticState: ConnectionViewState,
      operation: () => Promise<ApiResult<ConnectionViewState>>
    ): Promise<void> => {
      applyConnectionState(optimisticState)
      try {
        handleResult(await operation())
      } catch {
        applyFailure(unexpectedError())
      }
    },
    [applyConnectionState, applyFailure, handleResult]
  )

  const discover = useCallback(async (): Promise<void> => {
    await perform(
      {
        phase: 'discovering',
        candidates: [],
        activeConnection: null,
        disconnectReason: null,
        error: null,
        updatedAt: new Date().toISOString()
      },
      () => window.powerBiAssistant.listModels()
    )
  }, [perform])

  const connect = useCallback(
    async (candidate: DesktopModelCandidate): Promise<void> => {
      await perform(
        {
          phase: 'connecting',
          candidates: connection.candidates,
          activeConnection: null,
          disconnectReason: null,
          error: null,
          updatedAt: new Date().toISOString()
        },
        () => window.powerBiAssistant.connectModel({ candidateId: candidate.candidateId })
      )
    },
    [connection.candidates, perform]
  )

  const disconnect = useCallback(async (): Promise<void> => {
    await perform(
      {
        phase: 'disconnected',
        candidates: [],
        activeConnection: null,
        disconnectReason: 'user',
        error: null,
        updatedAt: new Date().toISOString()
      },
      () => window.powerBiAssistant.disconnectModel()
    )
  }, [perform])

  const reconnect = useCallback(async (): Promise<void> => {
    await perform(
      {
        phase: 'reconnecting',
        candidates: [],
        activeConnection: null,
        disconnectReason: connection.disconnectReason,
        error: null,
        updatedAt: new Date().toISOString()
      },
      () => window.powerBiAssistant.reconnectModel()
    )
  }, [connection.disconnectReason, perform])

  useEffect(() => {
    mountedRef.current = true
    const unsubscribe = window.powerBiAssistant.onConnectionStateChanged(applyConnectionState)

    if (!initialLoadStartedRef.current) {
      initialLoadStartedRef.current = true
      void window.powerBiAssistant
        .getAppInfo()
        .then((info) => {
          if (mountedRef.current) setAppInfo(info)
        })
        .catch(() => undefined)

      void window.powerBiAssistant
        .listModels()
        .then(handleResult)
        .catch(() => applyFailure(unexpectedError()))
    }

    return () => {
      mountedRef.current = false
      snapshotRequestRef.current += 1
      unsubscribe()
    }
  }, [applyConnectionState, applyFailure, handleResult])

  return {
    appInfo,
    connection,
    snapshot,
    schemaLoading,
    schemaError,
    discover,
    connect,
    disconnect,
    reconnect
  }
}
