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
import {
  PROVIDER_ACTIVATE_CHANNEL,
  PROVIDER_DELETE_CHANNEL,
  PROVIDER_LIST_CHANNEL,
  PROVIDER_SAVE_CHANNEL,
  PROVIDER_TEST_CANCEL_CHANNEL,
  PROVIDER_TEST_EVENT_CHANNEL,
  PROVIDER_TEST_START_CHANNEL,
  type ProviderProfileInput,
  type ProviderProfilesState,
  type ProviderResult,
  type ProviderSaveInput,
  type ProviderTestCancelInput,
  type ProviderTestDraft,
  type ProviderTestEvent,
  type ProviderTestStarted
} from '../shared/provider-contract'

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
  },
  listProviderProfiles: (): Promise<ProviderResult<ProviderProfilesState>> =>
    ipcRenderer.invoke(PROVIDER_LIST_CHANNEL) as Promise<ProviderResult<ProviderProfilesState>>,
  startProviderTest: (
    input: ProviderTestDraft
  ): Promise<ProviderResult<ProviderTestStarted>> =>
    ipcRenderer.invoke(PROVIDER_TEST_START_CHANNEL, input) as Promise<
      ProviderResult<ProviderTestStarted>
    >,
  cancelProviderTest: (
    input: ProviderTestCancelInput
  ): Promise<ProviderResult<{ readonly cancelled: boolean }>> =>
    ipcRenderer.invoke(PROVIDER_TEST_CANCEL_CHANNEL, input) as Promise<
      ProviderResult<{ readonly cancelled: boolean }>
    >,
  saveTestedProvider: (
    input: ProviderSaveInput
  ): Promise<ProviderResult<ProviderProfilesState>> =>
    ipcRenderer.invoke(PROVIDER_SAVE_CHANNEL, input) as Promise<
      ProviderResult<ProviderProfilesState>
    >,
  deleteProvider: (
    input: ProviderProfileInput
  ): Promise<ProviderResult<ProviderProfilesState>> =>
    ipcRenderer.invoke(PROVIDER_DELETE_CHANNEL, input) as Promise<
      ProviderResult<ProviderProfilesState>
    >,
  activateProvider: (
    input: ProviderProfileInput
  ): Promise<ProviderResult<ProviderProfilesState>> =>
    ipcRenderer.invoke(PROVIDER_ACTIVATE_CHANNEL, input) as Promise<
      ProviderResult<ProviderProfilesState>
    >,
  onProviderTestEvent: (listener: (event: ProviderTestEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: ProviderTestEvent): void => {
      listener(event)
    }
    ipcRenderer.on(PROVIDER_TEST_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(PROVIDER_TEST_EVENT_CHANNEL, handler)
  }
})

contextBridge.exposeInMainWorld('powerBiAssistant', assistantApi)
