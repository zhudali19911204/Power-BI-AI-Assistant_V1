import type { ConnectionApi } from './connection-contract'

export const APP_INFO_CHANNEL = 'app:get-info' as const

export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly stage: 1
}

export interface AssistantApi extends ConnectionApi {
  getAppInfo: () => Promise<AppInfo>
}

export function createAppInfo(version: string): AppInfo {
  return {
    name: 'Power BI 智能助手',
    version,
    stage: 1
  }
}
