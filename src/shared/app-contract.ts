export const APP_INFO_CHANNEL = 'app:get-info' as const

export type ConnectionStatus = 'disconnected'

export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly stage: 0
  readonly connectionStatus: ConnectionStatus
}

export interface AssistantApi {
  getAppInfo: () => Promise<AppInfo>
}

export function createAppInfo(version: string): AppInfo {
  return {
    name: 'Power BI 智能助手',
    version,
    stage: 0,
    connectionStatus: 'disconnected'
  }
}
