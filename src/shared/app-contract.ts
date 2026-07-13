import type { ConnectionApi } from './connection-contract'
import type { ProviderApi } from './provider-contract'

export const APP_INFO_CHANNEL = 'app:get-info' as const

export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly stage: 2
}

export interface AssistantApi extends ConnectionApi, ProviderApi {
  getAppInfo: () => Promise<AppInfo>
}

export function createAppInfo(version: string): AppInfo {
  return {
    name: 'Power BI 智能助手',
    version,
    stage: 2
  }
}
