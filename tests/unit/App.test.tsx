import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/src/App'

describe('App', () => {
  beforeEach(() => {
    window.powerBiAssistant = {
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'Power BI 智能助手',
        version: '0.1.0',
        stage: 0,
        connectionStatus: 'disconnected'
      })
    }
  })

  it('shows the stage, version, and disconnected status', async () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '本地工程基线已就绪' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('未连接')
    expect(await screen.findByText('版本 0.1.0')).toBeInTheDocument()
  })
})
