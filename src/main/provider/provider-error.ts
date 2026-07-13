import type { ProviderError, ProviderErrorCode } from '../../shared/provider-contract'

const DEFAULT_MESSAGES: Readonly<Record<ProviderErrorCode, string>> = {
  INVALID_INPUT: 'Provider 配置参数无效。',
  FORBIDDEN_IPC_SENDER: '当前页面无权执行此操作。',
  UNSAFE_PROVIDER_URL: '接口地址不符合安全规则，请填写完整的 chat/completions 地址。',
  PRIVATE_ADDRESS_BLOCKED: '接口地址解析到了不允许访问的网络地址。',
  PROVIDER_REDIRECT_BLOCKED: 'Provider 返回了重定向，请填写重定向后的最终接口地址。',
  SECRET_STORAGE_UNAVAILABLE: '系统安全存储当前不可用，无法保存或使用 API Key。',
  SECRET_DECRYPT_FAILED: '已保存的 API Key 无法解密，请重新输入并测试。',
  PROFILE_NOT_FOUND: '找不到指定的 Provider 配置。',
  TEST_RECEIPT_EXPIRED: '连接测试结果已失效，请重新测试后保存。',
  AUTH_FAILED: '鉴权失败，请检查接口地址、模型名和 API Key。',
  RATE_LIMITED: 'Provider 请求过于频繁，请稍后重试。',
  PROVIDER_UNAVAILABLE: 'Provider 服务暂时不可用。',
  PROVIDER_REQUEST_REJECTED:
    'Provider 拒绝了测试请求，请检查接口地址、模型名称和 OpenAI-compatible 兼容性。',
  TIMEOUT: 'Provider 连接测试已超时。',
  CANCELLED: 'Provider 连接测试已取消。',
  RESPONSE_TOO_LARGE: 'Provider 返回内容超过连接测试允许的大小。',
  MALFORMED_RESPONSE: 'Provider 返回了无法识别的响应。',
  MALFORMED_STREAM: 'Provider 返回的流式响应不符合 OpenAI-compatible 协议。',
  NETWORK_ERROR: '无法连接 Provider，请检查网络和接口地址。',
  CONFIG_CORRUPT: '本地 Provider 配置文件损坏，请联系管理员处理。',
  INTERNAL_ERROR: 'Provider 服务发生内部错误，请重试。'
}

export class ProviderServiceError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly retryable: boolean,
    message = DEFAULT_MESSAGES[code],
    readonly httpStatus?: number
  ) {
    super(message)
    this.name = 'ProviderServiceError'
  }
}

export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderServiceError) {
    return {
      code: error.code,
      message: DEFAULT_MESSAGES[error.code],
      retryable: error.retryable
    }
  }

  return {
    code: 'INTERNAL_ERROR',
    message: DEFAULT_MESSAGES.INTERNAL_ERROR,
    retryable: true
  }
}
