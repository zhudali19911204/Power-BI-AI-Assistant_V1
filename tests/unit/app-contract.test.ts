import { describe, expect, it } from 'vitest'
import { createAppInfo } from '../../src/shared/app-contract'

describe('createAppInfo', () => {
  it('returns the stage 0 disconnected application state', () => {
    expect(createAppInfo('0.1.0')).toEqual({
      name: 'Power BI 智能助手',
      version: '0.1.0',
      stage: 0,
      connectionStatus: 'disconnected'
    })
  })
})
