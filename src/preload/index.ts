import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_INFO_CHANNEL,
  type AppInfo,
  type AssistantApi
} from '../shared/app-contract'

const assistantApi: AssistantApi = Object.freeze({
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL) as Promise<AppInfo>
})

contextBridge.exposeInMainWorld('powerBiAssistant', assistantApi)
