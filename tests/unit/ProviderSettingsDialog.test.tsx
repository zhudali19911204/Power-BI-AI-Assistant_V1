import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantApi } from '../../src/shared/app-contract'
import {
  providerSuccess,
  type ProviderProfileView,
  type ProviderProfilesState,
  type ProviderResult,
  type ProviderTestEvent,
  type ProviderTestStarted
} from '../../src/shared/provider-contract'
import { ProviderSettingsDialog } from '../../src/renderer/src/ProviderSettingsDialog'

const TEST_ID = '11111111-1111-4111-8111-111111111111'
const RECEIPT_ID = '22222222-2222-4222-8222-222222222222'

const profiles: readonly ProviderProfileView[] = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    displayName: 'Provider A',
    chatCompletionsUrl: 'https://provider-a.example.com/v1/chat/completions',
    model: 'model-a',
    maxContextTokens: 32768,
    supportsStreaming: true,
    supportsJsonMode: true,
    hasSecret: true,
    isActive: true,
    updatedAt: '2026-07-13T06:00:00.000Z'
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    displayName: 'Provider B',
    chatCompletionsUrl: 'https://provider-b.example.com/v1/chat/completions',
    model: 'model-b',
    maxContextTokens: 65536,
    supportsStreaming: true,
    supportsJsonMode: false,
    hasSecret: true,
    isActive: false,
    updatedAt: '2026-07-13T06:01:00.000Z'
  }
]

const initialState: ProviderProfilesState = { revision: 2, profiles }
let testEventListener: ((event: ProviderTestEvent) => void) | null

function installProviderApi() {
  const api = {
    listProviderProfiles: vi.fn().mockResolvedValue(providerSuccess(initialState)),
    startProviderTest: vi.fn().mockResolvedValue(providerSuccess({ testId: TEST_ID })),
    cancelProviderTest: vi.fn().mockResolvedValue(providerSuccess({ cancelled: true })),
    saveTestedProvider: vi.fn().mockResolvedValue(providerSuccess(initialState)),
    deleteProvider: vi.fn().mockResolvedValue(
      providerSuccess({ revision: 3, profiles: profiles.slice(0, 1) } satisfies ProviderProfilesState)
    ),
    activateProvider: vi.fn().mockResolvedValue(
      providerSuccess({
        revision: 3,
        profiles: profiles.map((profile) => ({
          ...profile,
          isActive: profile.id === profiles[1]?.id
        }))
      } satisfies ProviderProfilesState)
    ),
    onProviderTestEvent: vi.fn((listener: (event: ProviderTestEvent) => void) => {
      testEventListener = listener
      return vi.fn()
    })
  }
  window.powerBiAssistant = api as unknown as AssistantApi
  return api
}

function emit(event: ProviderTestEvent): void {
  act(() => testEventListener?.(event))
}

async function startExistingProfileTest(): Promise<void> {
  expect(await screen.findByDisplayValue('Provider A')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: '测试连接' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '取消测试' })).toBeInTheDocument())
}

function completeTest(): void {
  emit({ testId: TEST_ID, sequence: 1, type: 'started' })
  emit({ testId: TEST_ID, sequence: 2, type: 'chunk', delta: '连接' })
  emit({
    testId: TEST_ID,
    sequence: 3,
    type: 'completed',
    output: '连接成功',
    capabilities: { supportsStreaming: true, supportsJsonMode: true },
    receipt: { receiptId: RECEIPT_ID, expiresAt: '2026-07-13T07:00:00.000Z' }
  })
}

describe('ProviderSettingsDialog 阶段 2 Renderer', () => {
  beforeEach(() => {
    testEventListener = null
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('读取配置列表但绝不回填已保存密钥，并支持新建和编辑选择', async () => {
    installProviderApi()
    render(<ProviderSettingsDialog open onClose={vi.fn()} />)

    expect(await screen.findByDisplayValue('Provider A')).toBeInTheDocument()
    const secretInput = screen.getByLabelText(/API Key/)
    expect(secretInput).toHaveAttribute('type', 'password')
    expect(secretInput).toHaveValue('')
    expect(screen.getByText(/密钥已安全保存且不会回填/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Provider B/ }))
    expect(screen.getByDisplayValue('model-b')).toBeInTheDocument()
    expect(secretInput).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: /新建/ }))
    expect(screen.getByLabelText('配置名称')).toHaveValue('')
    expect(screen.getByLabelText(/API Key/)).toBeRequired()
  })

  it('呈现完整流式状态且按纯文本显示响应，只有 completed 回执允许保存', async () => {
    const api = installProviderApi()
    const { container } = render(<ProviderSettingsDialog open onClose={vi.fn()} />)
    await startExistingProfileTest()

    expect(screen.getByRole('button', { name: '保存并设为当前' })).toBeDisabled()
    emit({ testId: TEST_ID, sequence: 1, type: 'started' })
    expect(screen.getByText('测试请求已启动')).toBeInTheDocument()
    emit({ testId: TEST_ID, sequence: 2, type: 'retry_wait', attempt: 1, waitMs: 1200 })
    expect(screen.getByText(/第 1 次请求暂未成功/)).toBeInTheDocument()
    emit({ testId: TEST_ID, sequence: 3, type: 'chunk', delta: '<img src=x onerror=alert(1)>' })
    expect(screen.getByLabelText('固定测试文本响应')).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(container.querySelector('img')).toBeNull()
    emit({ testId: TEST_ID, sequence: 4, type: 'capability', capability: 'streaming', supported: true })
    emit({ testId: TEST_ID, sequence: 5, type: 'capability', capability: 'json_mode', supported: false })
    expect(screen.getByText('流式输出：支持')).toBeInTheDocument()
    expect(screen.getByText('JSON Mode：不支持')).toBeInTheDocument()
    emit({
      testId: TEST_ID,
      sequence: 6,
      type: 'completed',
      output: '固定测试完成',
      capabilities: { supportsStreaming: true, supportsJsonMode: false },
      receipt: { receiptId: RECEIPT_ID, expiresAt: '2026-07-13T07:00:00.000Z' }
    })

    const save = screen.getByRole('button', { name: '保存并设为当前' })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(api.saveTestedProvider).toHaveBeenCalledWith({ receiptId: RECEIPT_ID }))
  })

  it('草稿任一字段改变立即使 completed 回执失效', async () => {
    installProviderApi()
    render(<ProviderSettingsDialog open onClose={vi.fn()} />)
    await startExistingProfileTest()
    completeTest()

    expect(screen.getByRole('button', { name: '保存并设为当前' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'model-a-v2' } })
    expect(screen.getByRole('button', { name: '保存并设为当前' })).toBeDisabled()
    expect(screen.getByText('尚未测试')).toBeInTheDocument()
  })

  it('支持显式取消、失败错误播报、设为当前和确认删除', async () => {
    const api = installProviderApi()
    render(<ProviderSettingsDialog open onClose={vi.fn()} />)
    await startExistingProfileTest()

    fireEvent.click(screen.getByRole('button', { name: '取消测试' }))
    await waitFor(() => expect(api.cancelProviderTest).toHaveBeenCalledWith({ testId: TEST_ID }))
    emit({ testId: TEST_ID, sequence: 1, type: 'cancelled', output: '部分响应' })
    expect(screen.getByText('测试已取消')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Provider B/ }))
    fireEvent.click(screen.getByRole('button', { name: '设为当前' }))
    await waitFor(() =>
      expect(api.activateProvider).toHaveBeenCalledWith({ profileId: profiles[1]?.id })
    )

    fireEvent.click(screen.getByRole('button', { name: '删除配置' }))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(api.deleteProvider).toHaveBeenCalled())
  })

  it('failed 事件通过可访问警报显示且保存保持禁用', async () => {
    installProviderApi()
    render(<ProviderSettingsDialog open onClose={vi.fn()} />)
    await startExistingProfileTest()
    emit({
      testId: TEST_ID,
      sequence: 1,
      type: 'failed',
      error: { code: 'AUTH_FAILED', message: '鉴权失败，请检查 API Key。', retryable: false }
    })

    expect(screen.getByRole('alert')).toHaveTextContent('鉴权失败，请检查 API Key。')
    expect(screen.getByRole('button', { name: '保存并设为当前' })).toBeDisabled()
  })

  it('不会丢失早于 start IPC 返回的极快 Provider 事件', async () => {
    const api = installProviderApi()
    api.startProviderTest.mockImplementation(async () => {
      testEventListener?.({ testId: TEST_ID, sequence: 1, type: 'started' })
      testEventListener?.({ testId: TEST_ID, sequence: 2, type: 'chunk', delta: '极快响应' })
      testEventListener?.({
        testId: TEST_ID,
        sequence: 3,
        type: 'completed',
        output: '极快响应',
        capabilities: { supportsStreaming: true, supportsJsonMode: true },
        receipt: { receiptId: RECEIPT_ID, expiresAt: '2026-07-13T07:00:00.000Z' }
      })
      return providerSuccess({ testId: TEST_ID })
    })
    render(<ProviderSettingsDialog open onClose={vi.fn()} />)
    expect(await screen.findByDisplayValue('Provider A')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))

    expect(await screen.findByText('连接测试通过')).toBeInTheDocument()
    expect(screen.getByLabelText('固定测试文本响应')).toHaveTextContent('极快响应')
    expect(screen.getByRole('button', { name: '保存并设为当前' })).toBeEnabled()
  })

  it('启动请求返回前草稿变化会取消旧测试且不会绑定旧 testId', async () => {
    const api = installProviderApi()
    let resolveStart: ((result: ProviderResult<ProviderTestStarted>) => void) | null = null
    api.startProviderTest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        })
    )
    render(<ProviderSettingsDialog open onClose={vi.fn()} />)
    expect(await screen.findByDisplayValue('Provider A')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    await waitFor(() => expect(api.startProviderTest).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByLabelText('模型名称'), {
      target: { value: 'model-after-start' }
    })
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()

    await act(async () => {
      resolveStart?.(providerSuccess({ testId: TEST_ID }))
    })
    await waitFor(() =>
      expect(api.cancelProviderTest).toHaveBeenCalledWith({ testId: TEST_ID })
    )
    expect(screen.getByRole('button', { name: '测试连接' })).toBeEnabled()
    emit({ testId: TEST_ID, sequence: 1, type: 'started' })
    expect(screen.getByText('尚未测试')).toBeInTheDocument()
  })
})
