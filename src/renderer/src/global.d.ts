import type { AssistantApi } from '../../shared/app-contract'

declare global {
  interface Window {
    powerBiAssistant: AssistantApi
  }
}

export {}
