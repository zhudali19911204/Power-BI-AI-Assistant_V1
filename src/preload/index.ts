import { contextBridge, ipcRenderer } from 'electron'
import {
  CONNECTION_CONNECT_CHANNEL,
  CONNECTION_DISCONNECT_CHANNEL,
  CONNECTION_LIST_CHANNEL,
  CONNECTION_RECONNECT_CHANNEL,
  CONNECTION_STATE_CHANGED_CHANNEL,
  CONNECTION_STATE_CHANNEL,
  SCHEMA_SNAPSHOT_CHANNEL,
  type ConnectModelInput,
  type ConnectionViewState,
  type SnapshotInput
} from '../shared/connection-contract'
import {
  APP_INFO_CHANNEL,
  type AppInfo,
  type AssistantApi
} from '../shared/app-contract'
import type { ModelSnapshot } from '../shared/model-contract'
import type { ApiResult } from '../shared/result-contract'

const assistantApi: AssistantApi = Object.freeze({
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL) as Promise<AppInfo>,
  listModels: (): Promise<ApiResult<ConnectionViewState>> =>
    ipcRenderer.invoke(CONNECTION_LIST_CHANNEL) as Promise<ApiResult<ConnectionViewState>>,
  connectModel: (input: ConnectModelInput): Promise<ApiResult<ConnectionViewState>> =>
    ipcRenderer.invoke(CONNECTION_CONNECT_CHANNEL, input) as Promise<
      ApiResult<ConnectionViewState>
    >,
  disconnectModel: (): Promise<ApiResult<ConnectionViewState>> =>
    ipcRenderer.invoke(CONNECTION_DISCONNECT_CHANNEL) as Promise<ApiResult<ConnectionViewState>>,
  reconnectModel: (): Promise<ApiResult<ConnectionViewState>> =>
    ipcRenderer.invoke(CONNECTION_RECONNECT_CHANNEL) as Promise<ApiResult<ConnectionViewState>>,
  getConnectionState: (): Promise<ApiResult<ConnectionViewState>> =>
    ipcRenderer.invoke(CONNECTION_STATE_CHANNEL) as Promise<ApiResult<ConnectionViewState>>,
  getModelSnapshot: (input: SnapshotInput): Promise<ApiResult<ModelSnapshot | null>> =>
    ipcRenderer.invoke(SCHEMA_SNAPSHOT_CHANNEL, input) as Promise<
      ApiResult<ModelSnapshot | null>
    >,
  onConnectionStateChanged: (listener: (state: ConnectionViewState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ConnectionViewState): void => {
      listener(state)
    }
    ipcRenderer.on(CONNECTION_STATE_CHANGED_CHANNEL, handler)
    return () => ipcRenderer.removeListener(CONNECTION_STATE_CHANGED_CHANNEL, handler)
  }
})

contextBridge.exposeInMainWorld('powerBiAssistant', assistantApi)
