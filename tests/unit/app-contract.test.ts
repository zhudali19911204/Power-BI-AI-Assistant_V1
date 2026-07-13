import { describe, expect, it } from 'vitest'
import { createAppInfo } from '../../src/shared/app-contract'

describe('createAppInfo', () => {
  it('returns the stage 1 application identity', () => {
    expect(createAppInfo('0.2.0')).toEqual({
      name: 'Power BI 智能助手',
      version: '0.2.0',
      stage: 2
    })
  })
})
