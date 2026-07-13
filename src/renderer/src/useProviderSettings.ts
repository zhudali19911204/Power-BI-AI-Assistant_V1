import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ProviderError,
  ProviderProfileView,
  ProviderProfilesState,
  ProviderTestDraft,
  ProviderTestEvent,
  ProviderTestReceipt
} from '../../shared/provider-contract'

export interface ProviderDraftForm {
  readonly profileId?: string
  readonly displayName: string
  readonly chatCompletionsUrl: string
  readonly model: string
  readonly maxContextTokens: string
  readonly apiKey: string
}

export type ProviderDraftField = Exclude<keyof ProviderDraftForm, 'profileId'>
export type ProviderFieldErrors = Partial<Record<ProviderDraftField, string>>

export type ProviderTestPhase =
  | 'idle'
  | 'starting'
  | 'started'
  | 'retry_wait'
  | 'streaming'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed'

interface ProbedCapabilities {
  readonly streaming: boolean | null
  readonly jsonMode: boolean | null
}

export interface ProviderTestUiState {
  readonly phase: ProviderTestPhase
  readonly testId: string | null
  readonly output: string
  readonly attempt: number | null
  readonly waitMs: number | null
  readonly capabilities: ProbedCapabilities
  readonly receipt: ProviderTestReceipt | null
  readonly error: ProviderError | null
}

export type ProviderProfileOperation = 'idle' | 'loading' | 'saving' | 'deleting' | 'activating'

export interface ProviderSettingsState {
  readonly profiles: readonly ProviderProfileView[]
  readonly selectedProfile: ProviderProfileView | null
  readonly draft: ProviderDraftForm
  readonly fieldErrors: ProviderFieldErrors
  readonly formError: ProviderError | null
  readonly notice: string | null
  readonly test: ProviderTestUiState
  readonly profileOperation: ProviderProfileOperation
  readonly canStartTest: boolean
  readonly canCancelTest: boolean
  readonly canSave: boolean
  readonly selectProfile: (profileId: string) => void
  readonly createProfile: () => void
  readonly updateDraft: (field: ProviderDraftField, value: string) => void
  readonly startTest: () => Promise<void>
  readonly cancelTest: () => Promise<void>
  readonly saveTestedProfile: () => Promise<void>
  readonly deleteSelectedProfile: () => Promise<void>
  readonly activateSelectedProfile: () => Promise<void>
  readonly refreshProfiles: () => Promise<void>
}

const DEFAULT_CONTEXT_TOKENS = '32768'

function emptyDraft(): ProviderDraftForm {
  return {
    displayName: '',
    chatCompletionsUrl: '',
    model: '',
    maxContextTokens: DEFAULT_CONTEXT_TOKENS,
    apiKey: ''
  }
}

function draftFromProfile(profile: ProviderProfileView): ProviderDraftForm {
  return {
    profileId: profile.id,
    displayName: profile.displayName,
    chatCompletionsUrl: profile.chatCompletionsUrl,
    model: profile.model,
    maxContextTokens: String(profile.maxContextTokens),
    // Main 永远不返回密钥；空值表示测试时复用该配置已加密保存的密钥。
    apiKey: ''
  }
}

function initialCapabilities(): ProbedCapabilities {
  return { streaming: null, jsonMode: null }
}

function initialTestState(): ProviderTestUiState {
  return {
    phase: 'idle',
    testId: null,
    output: '',
    attempt: null,
    waitMs: null,
    capabilities: initialCapabilities(),
    receipt: null,
    error: null
  }
}

function unexpectedError(message = 'Provider 服务暂时无法响应，请重试。'): ProviderError {
  return { code: 'INTERNAL_ERROR', message, retryable: true }
}

function isExplicitLoopback(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase().replace(/^\[|\]$/gu, '')
  if (normalized === 'localhost' || normalized === '::1') return true
  const firstPart = Number(normalized.split('.')[0])
  return Number.isInteger(firstPart) && firstPart === 127
}

function validateUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return '请输入完整的 chat/completions 接口地址。'
  }

  if (url.username || url.password || url.hash || !url.hostname) {
    return '接口地址不能包含账号、密码或片段。'
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isExplicitLoopback(url.hostname))) {
    return '仅允许 HTTPS；HTTP 只允许 localhost 或回环地址。'
  }
  if (!url.pathname.replace(/\/+$/gu, '').toLocaleLowerCase().endsWith('/chat/completions')) {
    return '接口路径必须以 /chat/completions 结尾。'
  }
  if (url.search) return '接口地址不能包含查询参数；请填写最终的 Bearer Key 接口地址。'
  return null
}

export function validateProviderDraft(draft: ProviderDraftForm): ProviderFieldErrors {
  const errors: ProviderFieldErrors = {}
  const displayName = draft.displayName.trim()
  const model = draft.model.trim()
  const maxContextTokens = Number(draft.maxContextTokens)

  if (!displayName) errors.displayName = '请输入配置名称。'
  else if (displayName.length > 80) errors.displayName = '配置名称不能超过 80 个字符。'

  if (!draft.chatCompletionsUrl.trim()) {
    errors.chatCompletionsUrl = '请输入接口地址。'
  } else {
    const urlError = validateUrl(draft.chatCompletionsUrl.trim())
    if (urlError) errors.chatCompletionsUrl = urlError
  }

  if (!model) errors.model = '请输入模型名称。'
  else if (model.length > 200) errors.model = '模型名称不能超过 200 个字符。'

  if (!Number.isInteger(maxContextTokens) || maxContextTokens < 1024 || maxContextTokens > 10_000_000) {
    errors.maxContextTokens = '请输入 1,024 到 10,000,000 之间的整数。'
  }

  if (!draft.profileId && !draft.apiKey) errors.apiKey = '新配置必须输入 API Key。'
  if (
    draft.apiKey &&
    [...draft.apiKey].some((character) => {
      const code = character.codePointAt(0)
      return code === 0 || code === 10 || code === 13
    })
  ) {
    errors.apiKey = 'API Key 不能包含换行或空字符。'
  }

  return errors
}

function isTestRunning(phase: ProviderTestPhase): boolean {
  return ['starting', 'started', 'retry_wait', 'streaming', 'cancelling'].includes(phase)
}

export function useProviderSettings(): ProviderSettingsState {
  const [profilesState, setProfilesState] = useState<ProviderProfilesState>({
    revision: 0,
    profiles: []
  })
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProviderDraftForm>(emptyDraft)
  const [draftRevision, setDraftRevision] = useState(0)
  const [testedRevision, setTestedRevision] = useState<number | null>(null)
  const [showValidation, setShowValidation] = useState(false)
  const [formError, setFormError] = useState<ProviderError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [test, setTest] = useState<ProviderTestUiState>(initialTestState)
  const [profileOperation, setProfileOperation] = useState<ProviderProfileOperation>('loading')
  const [startRequestPending, setStartRequestPending] = useState(false)

  const mountedRef = useRef(true)
  const activeTestIdRef = useRef<string | null>(null)
  const activeTestRevisionRef = useRef<number | null>(null)
  const lastSequenceRef = useRef(0)
  const draftRevisionRef = useRef(0)
  const cancelRequestedRef = useRef(false)
  const testStartPendingRef = useRef(false)
  const pendingTestEventsRef = useRef<ProviderTestEvent[]>([])
  const processProviderEventRef = useRef<(event: ProviderTestEvent) => void>(() => undefined)

  const fieldErrors = useMemo(
    () => (showValidation ? validateProviderDraft(draft) : {}),
    [draft, showValidation]
  )
  const selectedProfile = useMemo(
    () => profilesState.profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profilesState.profiles, selectedProfileId]
  )

  const resetDraft = useCallback((nextDraft: ProviderDraftForm): void => {
    const activeTestId = activeTestIdRef.current
    activeTestIdRef.current = null
    activeTestRevisionRef.current = null
    lastSequenceRef.current = 0
    if (!testStartPendingRef.current) pendingTestEventsRef.current = []
    setTestedRevision(null)
    if (activeTestId && !cancelRequestedRef.current) {
      cancelRequestedRef.current = true
      void window.powerBiAssistant.cancelProviderTest({ testId: activeTestId })
    }

    draftRevisionRef.current += 1
    setDraftRevision(draftRevisionRef.current)
    setDraft(nextDraft)
    setTest(initialTestState())
    setShowValidation(false)
    setFormError(null)
    setNotice(null)
    cancelRequestedRef.current = false
  }, [])

  const applyProfiles = useCallback(
    (state: ProviderProfilesState, preferredProfileId?: string): void => {
      setProfilesState(state)
      const selected =
        state.profiles.find((profile) => profile.id === preferredProfileId) ??
        state.profiles.find((profile) => profile.isActive) ??
        state.profiles[0] ??
        null
      setSelectedProfileId(selected?.id ?? null)
      resetDraft(selected ? draftFromProfile(selected) : emptyDraft())
    },
    [resetDraft]
  )

  const refreshProfiles = useCallback(async (): Promise<void> => {
    setProfileOperation('loading')
    setFormError(null)
    try {
      const result = await window.powerBiAssistant.listProviderProfiles()
      if (!mountedRef.current) return
      if (result.ok) applyProfiles(result.data)
      else setFormError(result.error)
    } catch {
      if (mountedRef.current) setFormError(unexpectedError())
    } finally {
      if (mountedRef.current) setProfileOperation('idle')
    }
  }, [applyProfiles])

  useEffect(() => {
    mountedRef.current = true
    const refreshTimer = window.setTimeout(() => void refreshProfiles(), 0)
    return () => {
      window.clearTimeout(refreshTimer)
      mountedRef.current = false
      const activeTestId = activeTestIdRef.current
      if (activeTestId && !cancelRequestedRef.current) {
        void window.powerBiAssistant.cancelProviderTest({ testId: activeTestId })
      }
      activeTestIdRef.current = null
      if (!testStartPendingRef.current) pendingTestEventsRef.current = []
    }
  }, [refreshProfiles])

  useEffect(() => {
    const processEvent = (event: ProviderTestEvent): void => {
        if (
          event.testId !== activeTestIdRef.current ||
          event.sequence <= lastSequenceRef.current
        ) {
          return
        }
        lastSequenceRef.current = event.sequence

        if (event.type === 'started') {
          setTest((current) => ({ ...current, phase: 'started' }))
          return
        }
        if (event.type === 'retry_wait') {
          setTest((current) => ({
            ...current,
            phase: 'retry_wait',
            attempt: event.attempt,
            waitMs: event.waitMs
          }))
          return
        }
        if (event.type === 'chunk') {
          setTest((current) => ({
            ...current,
            phase: 'streaming',
            output: `${current.output}${event.delta}`
          }))
          return
        }
        if (event.type === 'capability') {
          setTest((current) => ({
            ...current,
            capabilities: {
              ...current.capabilities,
              [event.capability === 'streaming' ? 'streaming' : 'jsonMode']:
                event.supported
            }
          }))
          return
        }
        if (event.type === 'completed') {
          if (activeTestRevisionRef.current !== draftRevisionRef.current) return
          setTestedRevision(activeTestRevisionRef.current)
          activeTestIdRef.current = null
          activeTestRevisionRef.current = null
          cancelRequestedRef.current = false
          setTest({
            phase: 'completed',
            testId: event.testId,
            output: event.output,
            attempt: null,
            waitMs: null,
            capabilities: {
              streaming: event.capabilities.supportsStreaming,
              jsonMode: event.capabilities.supportsJsonMode
            },
            receipt: event.receipt,
            error: null
          })
          return
        }
        if (event.type === 'cancelled') {
          activeTestIdRef.current = null
          activeTestRevisionRef.current = null
          cancelRequestedRef.current = false
          setTestedRevision(null)
          setTest({
            ...initialTestState(),
            phase: 'cancelled',
            testId: event.testId,
            output: event.output
          })
          return
        }

        activeTestIdRef.current = null
        activeTestRevisionRef.current = null
        cancelRequestedRef.current = false
        setTestedRevision(null)
        setTest({
          ...initialTestState(),
          phase: 'failed',
          testId: event.testId,
          error: event.error
        })
    }
    processProviderEventRef.current = processEvent
    const unsubscribe = window.powerBiAssistant.onProviderTestEvent(
      (event: ProviderTestEvent): void => {
        if (activeTestIdRef.current === null && testStartPendingRef.current) {
          if (pendingTestEventsRef.current.length < 256) {
            pendingTestEventsRef.current.push(event)
          }
          return
        }
        processEvent(event)
      }
    )
    return () => {
      processProviderEventRef.current = () => undefined
      unsubscribe()
    }
  }, [])

  const selectProfile = useCallback(
    (profileId: string): void => {
      const profile = profilesState.profiles.find((candidate) => candidate.id === profileId)
      if (!profile) return
      setSelectedProfileId(profile.id)
      resetDraft(draftFromProfile(profile))
    },
    [profilesState.profiles, resetDraft]
  )

  const createProfile = useCallback((): void => {
    setSelectedProfileId(null)
    resetDraft(emptyDraft())
  }, [resetDraft])

  const updateDraft = useCallback(
    (field: ProviderDraftField, value: string): void => {
      const activeTestId = activeTestIdRef.current
      if (activeTestId && !cancelRequestedRef.current) {
        cancelRequestedRef.current = true
        void window.powerBiAssistant.cancelProviderTest({ testId: activeTestId })
      }
      activeTestIdRef.current = null
      activeTestRevisionRef.current = null
      lastSequenceRef.current = 0
      testStartPendingRef.current = false
      pendingTestEventsRef.current = []
      setTestedRevision(null)
      draftRevisionRef.current += 1
      setDraftRevision(draftRevisionRef.current)
      setDraft((current) => ({ ...current, [field]: value }))
      setTest(initialTestState())
      setFormError(null)
      setNotice(null)
      cancelRequestedRef.current = false
    },
    []
  )

  const startTest = useCallback(async (): Promise<void> => {
    setShowValidation(true)
    setFormError(null)
    setNotice(null)
    const errors = validateProviderDraft(draft)
    if (
      Object.keys(errors).length > 0 ||
      isTestRunning(test.phase) ||
      testStartPendingRef.current
    ) {
      return
    }

    const requestedRevision = draftRevisionRef.current
    setTestedRevision(null)
    activeTestRevisionRef.current = requestedRevision
    lastSequenceRef.current = 0
    cancelRequestedRef.current = false
    testStartPendingRef.current = true
    setStartRequestPending(true)
    pendingTestEventsRef.current = []
    setTest({ ...initialTestState(), phase: 'starting' })

    const maxContextTokens = Number(draft.maxContextTokens)
    const input: ProviderTestDraft = {
      ...(draft.profileId ? { profileId: draft.profileId } : {}),
      displayName: draft.displayName,
      chatCompletionsUrl: draft.chatCompletionsUrl,
      model: draft.model,
      maxContextTokens,
      ...(draft.apiKey ? { apiKey: draft.apiKey } : {})
    }

    try {
      const result = await window.powerBiAssistant.startProviderTest(input)
      const requestBecameStale =
        activeTestRevisionRef.current !== requestedRevision ||
        draftRevisionRef.current !== requestedRevision
      if (!mountedRef.current || requestBecameStale) {
        if (result.ok) {
          void window.powerBiAssistant.cancelProviderTest({ testId: result.data.testId })
        }
        testStartPendingRef.current = false
        pendingTestEventsRef.current = []
        if (mountedRef.current) setStartRequestPending(false)
        return
      }
      if (!result.ok) {
        activeTestRevisionRef.current = null
        testStartPendingRef.current = false
        setStartRequestPending(false)
        pendingTestEventsRef.current = []
        setTest({ ...initialTestState(), phase: 'failed', error: result.error })
        return
      }
      activeTestIdRef.current = result.data.testId
      setTest((current) => ({ ...current, testId: result.data.testId }))
      testStartPendingRef.current = false
      setStartRequestPending(false)
      const pendingEvents = pendingTestEventsRef.current
        .filter((event) => event.testId === result.data.testId)
        .sort((left, right) => left.sequence - right.sequence)
      pendingTestEventsRef.current = []
      for (const event of pendingEvents) processProviderEventRef.current(event)
    } catch {
      if (mountedRef.current) {
        activeTestRevisionRef.current = null
        testStartPendingRef.current = false
        setStartRequestPending(false)
        pendingTestEventsRef.current = []
        setTest({ ...initialTestState(), phase: 'failed', error: unexpectedError() })
      }
    }
  }, [draft, test.phase])

  const cancelTest = useCallback(async (): Promise<void> => {
    const testId = activeTestIdRef.current
    if (!testId || cancelRequestedRef.current) return
    cancelRequestedRef.current = true
    setTestedRevision(null)
    setTest((current) => ({ ...current, phase: 'cancelling', receipt: null }))
    try {
      const result = await window.powerBiAssistant.cancelProviderTest({ testId })
      if (!mountedRef.current || result.ok) return
      activeTestIdRef.current = null
      activeTestRevisionRef.current = null
      cancelRequestedRef.current = false
      setTest({ ...initialTestState(), phase: 'failed', testId, error: result.error })
    } catch {
      if (mountedRef.current) {
        activeTestIdRef.current = null
        activeTestRevisionRef.current = null
        cancelRequestedRef.current = false
        setTest({
          ...initialTestState(),
          phase: 'failed',
          testId,
          error: unexpectedError('无法取消当前连接测试，请重试。')
        })
      }
    }
  }, [])

  const canSave =
    test.phase === 'completed' &&
    test.receipt !== null &&
    testedRevision === draftRevision

  const saveTestedProfile = useCallback(async (): Promise<void> => {
    if (!canSave || !test.receipt) return
    setProfileOperation('saving')
    setFormError(null)
    try {
      const result = await window.powerBiAssistant.saveTestedProvider({
        receiptId: test.receipt.receiptId
      })
      if (!mountedRef.current) return
      if (!result.ok) {
        setFormError(result.error)
        if (result.error.code === 'TEST_RECEIPT_EXPIRED') {
          setTestedRevision(null)
          setTest(initialTestState())
        }
        return
      }
      applyProfiles(result.data)
      setNotice('Provider 配置已安全保存并设为当前配置。')
    } catch {
      if (mountedRef.current) setFormError(unexpectedError('保存 Provider 配置失败，请重试。'))
    } finally {
      if (mountedRef.current) setProfileOperation('idle')
    }
  }, [applyProfiles, canSave, test.receipt])

  const deleteSelectedProfile = useCallback(async (): Promise<void> => {
    if (!selectedProfile) return
    setProfileOperation('deleting')
    setFormError(null)
    try {
      const result = await window.powerBiAssistant.deleteProvider({
        profileId: selectedProfile.id
      })
      if (!mountedRef.current) return
      if (result.ok) {
        applyProfiles(result.data)
        setNotice('Provider 配置已删除。')
      } else setFormError(result.error)
    } catch {
      if (mountedRef.current) setFormError(unexpectedError('删除 Provider 配置失败，请重试。'))
    } finally {
      if (mountedRef.current) setProfileOperation('idle')
    }
  }, [applyProfiles, selectedProfile])

  const activateSelectedProfile = useCallback(async (): Promise<void> => {
    if (!selectedProfile || selectedProfile.isActive) return
    setProfileOperation('activating')
    setFormError(null)
    try {
      const result = await window.powerBiAssistant.activateProvider({
        profileId: selectedProfile.id
      })
      if (!mountedRef.current) return
      if (result.ok) {
        setProfilesState(result.data)
        setNotice(`已将“${selectedProfile.displayName}”设为当前 Provider。`)
      } else setFormError(result.error)
    } catch {
      if (mountedRef.current) setFormError(unexpectedError('切换当前 Provider 失败，请重试。'))
    } finally {
      if (mountedRef.current) setProfileOperation('idle')
    }
  }, [selectedProfile])

  return {
    profiles: profilesState.profiles,
    selectedProfile,
    draft,
    fieldErrors,
    formError,
    notice,
    test,
    profileOperation,
    canStartTest:
      !startRequestPending && !isTestRunning(test.phase) && profileOperation === 'idle',
    canCancelTest: isTestRunning(test.phase) && test.phase !== 'cancelling' && Boolean(test.testId),
    canSave,
    selectProfile,
    createProfile,
    updateDraft,
    startTest,
    cancelTest,
    saveTestedProfile,
    deleteSelectedProfile,
    activateSelectedProfile,
    refreshProfiles
  }
}
