# 阶段 2 验收记录

| 项目 | 内容 |
|---|---|
| 阶段 | 2——功能首页与 Provider 配置 |
| 版本 | 0.3.0 |
| 开发完成日期 | 2026-07-13 |
| 当前状态 | 开发完成，待两个真实国产 Provider 人工验收 |
| 自动验证 | 通过 |
| 真实 Provider 验证 | 待项目负责人使用自有配置执行 |
| 技术基线 | `docs/TECHNICAL_DEVELOPMENT.md` 1.1 |

## 1. 本阶段目标

在不进入需求完整性判断和 DAX 业务流程的前提下，交付五个固定功能入口、
OpenAI-compatible Provider 配置、Windows 安全存储、保存前连接测试、流式响应、取消、
超时、重试和安全错误处理。本阶段只能发送应用内置的固定测试文本，不能发送 Power BI
Schema、对象名称、DAX 或用户业务需求。

## 2. 实际完成项

- 固定 `generate_measure`、`generate_calculated_column`、`generate_calculated_table`、
  `diagnose_measure` 和 `assess_model` 五类功能策略。
- 三类生成功能明确标记为后续需要需求完整性确认；诊断度量值和模型评估明确绕过该流程。
- 连接 Power BI 后默认显示五功能首页，可切换回阶段 1 的只读模型架构页面。
- 阶段 2 点击功能卡只显示后续阶段边界，不收集需求、不调用 Provider、不生成 DAX，
  也不执行诊断、评估或模型写入。
- Provider 设置不依赖 Power BI 连接，支持多配置的新建、编辑、删除和当前配置切换。
- 配置包含显示名称、完整 `chat/completions` 地址、模型名和最大上下文 Token；流式与
  JSON Mode 能力只能由测试结果写入，不能由 Renderer 自行声明。
- 保存前必须通过当前草稿的固定文本测试；地址、模型、上下文或密钥变化会立即使旧回执失效。
- 测试成功后由 Main 签发绑定当前窗口、十分钟有效且一次性消费的短期回执，Renderer 不能
  绕过测试直接保存。
- API Key 通过 Electron 异步 `safeStorage` 加密，Windows 使用 DPAPI；安全存储不可用时
  失败关闭，不降级为明文。
- 配置文件位于 Electron `userData` 下，仅保存密文和非秘密元数据；Renderer 列表只返回
  `hasSecret`，不返回密文、解密值或密钥片段。
- 编辑已保存配置时不回填 API Key；留空测试时由 Main 在单次请求生命周期内解密复用。
- Provider 请求只由 Main 构造两类固定测试体，没有接受任意 messages、prompt、headers、
  MCP 工具或 Power BI 快照的 IPC。
- Provider 出站请求使用 Electron Chromium 网络栈，继承 Windows 系统证书、代理/PAC 和
  企业代理认证；不关闭 TLS 证书校验。
- 支持 OpenAI-compatible Chat Completions SSE `data:` 事件、分块 UTF-8、CRLF/LF、
  usage 空 choices 事件、`choices[].delta.content` 和 `[DONE]`。
- 独立探测 `response_format: {"type":"json_object"}`；不支持时记录能力为否，不伪造支持。
- 单次完整测试默认 120 秒超时；401/403 不重试，429/5xx 最多退避重试两次；其他 4xx
  明确归类为 Provider 拒绝请求；重试等待、流式片段、成功、失败和取消均有显式 UI 状态。
- 所有 Provider 重定向均被阻止；只允许 HTTPS，HTTP 仅允许 `localhost`、IPv4 回环和
  IPv6 回环；拒绝 URL userinfo、fragment、任何查询参数和非 `chat/completions` 路径。
- 连接前解析目标地址；显式本地地址必须全部解析为回环，公网域名解析到私网、回环或
  link-local 地址时拒绝请求。
- app、connection、schema 和 Provider IPC 全部校验当前主窗口的 main frame；Preload 只暴露
  固定方法和事件载荷，不暴露通用 `ipcRenderer`。
- 加固 Renderer 导航、子 frame、重定向、WebView、权限、外链和 CSP；生产 Renderer
  `connect-src 'none'`，Provider 网络只存在于 Main。

## 3. 范围边界检查

本阶段没有实现以下阶段 3 及以后能力：

- 不判断用户业务需求是否完整，不生成澄清问题或可选答案。
- 不创建需求会话、需求摘要、确认状态或多轮反馈状态机。
- 不生成、优化、修复或验证 DAX。
- 不执行度量值诊断或综合模型评估。
- 不执行 DAX 查询，不调用任何 MCP 写操作，不修改 Power BI 模型。
- 不发送 Power BI Schema、表列名称、度量值定义、DAX、描述或明细数据给 Provider。

## 4. 自动验证结果

| 验证项 | 命令 | 结果 |
|---|---|---|
| ESLint | `npm run lint` | 通过，0 警告 |
| 类型检查 | `npm run typecheck` | 通过 |
| 单元测试 | `npm run test:unit` | 17 个文件、138 项通过 |
| 集成测试 | `npm run test:integration` | 7 个文件、23 项通过 |
| 完整测试 | `npm run test` | 通过 |
| 生产构建 | `npm run build` | 通过 |
| Electron 启动 | `npm run smoke` | 通过，Renderer 返回 `SMOKE_OK` |

阶段 2 自动用例覆盖：

- 五功能数量、策略、阶段边界及“点击卡片不调用 Provider”。
- 密钥加密存储、明文 sentinel 不落配置文件、不返回 Renderer、安全存储不可用和密文损坏。
- HTTPS/回环 URL、恶意协议、userinfo、fragment、全部查询参数、私网 DNS 和重定向拒绝。
- 固定请求体中不存在阶段 1 fixture 的表名、列名、DAX 或 `ModelSnapshot` sentinel。
- SSE 分块、CRLF/LF、usage 事件、JSON Mode、固定响应标记、畸形流、响应大小限制和 `[DONE]`。
- 401/403 零重试、其他 4xx 与真实传输失败的分类、429/5xx 总尝试不超过三次、等待事件、
  DNS 卡住时的整体超时和取消。
- 两个本机 OpenAI-compatible 模拟服务通过真实 HTTP 流式和 JSON 测试；两个模拟变体分别
  覆盖 CRLF 与 usage 空 choices 事件。该结果只证明协议适配，不替代两个真实国产 Provider。
- 测试回执绑定、一次性保存、草稿变化失效、密钥不回填、事件顺序、启动响应竞态缓冲和
  迟到事件忽略。
- 非可信 frame 调用全部 Provider/Power BI IPC 时在进入 service 前被拒绝。
- 阶段 0/1 的模型发现、选择、Schema、只读 DAX、关系、断线失效和窗口安全回归继续通过。

## 5. 项目负责人人工验收步骤

在项目根目录执行：

```powershell
npm run dev
```

不需要先打开 PBIX。请为两个真实国产 OpenAI-compatible Provider 分别执行：

1. 点击“Provider 设置”并新建配置。
2. 填写显示名称、供应商提供的完整 `chat/completions` HTTPS 地址、准确模型名、最大上下文
   Token 和 API Key。不要把 Key 写入终端、环境变量、文件、截图或验收记录。
3. 点击“测试连接”，确认状态从启动进入流式响应，输出区只显示固定连接测试结果。
4. 在测试过程中执行一次“取消测试”，确认不再追加片段；随后重新测试。
5. 确认流式能力为“支持”；记录 JSON Mode 是支持还是不支持。JSON Mode 不支持不应伪装为支持。
6. 测试成功后点击“保存并设为当前”。关闭并重新打开设置，确认 API Key 输入框为空，配置仍可
   在不回填密钥的情况下重新测试。
7. 故意使用一次错误 Key，确认 401/403 不显示自动重试，界面和终端不出现 Key 或原始响应体。
8. 对第二个 Provider 重复上述流程，并验证“设为当前”、删除确认和配置切换。
9. 打开 PBIX，确认首页恰好五个功能；逐个点击后只出现阶段说明，Provider 请求次数不增加。
10. 切换到“模型架构”，抽查阶段 1 浏览、断线清空和重连仍正常。

验收完成后，请向开发者反馈两个 Provider 的显示名称、模型名、流式是否通过、JSON Mode
是否支持及任何安全错误代码；不要反馈 API Key。

## 6. 偏差、风险与限制

- HTML 密码输入框中的新 API Key 必然会短暂存在于 Renderer 和 IPC structured-clone 内存，
  这是纯 Electron 表单输入的技术边界。当前保证的是：已保存密钥、密文和解密值永不返回
  Renderer；密钥不进入 Renderer 持久化存储、配置文件、错误或应用日志。若要求密钥从不进入
  Renderer 内存，需要 Windows 原生安全输入、凭据管理器或 OAuth/device-code，超出阶段 2。
- Windows DPAPI 主要隔离不同 Windows 登录用户，不能抵御同一用户会话内的其他恶意进程。
- 连接前 DNS 检查和实际 `fetch` 解析之间仍存在很小的 DNS rebinding 时间窗口。当前同时阻止
  重定向并限制地址范围；若未来威胁模型要求完全固定目标 IP，需要改用自定义 `lookup` 的
  Node HTTP 传输，并单独评估企业代理/PAC 兼容性。
- 当前只完成两个本地兼容协议变体，未持有也未使用任何真实国产 Provider 凭据，因此不能宣称
  已满足“至少两个国产 Provider 通过连接和流式测试”的退出条件。
- `npm run test:coverage` 可用于生成覆盖率报告；本次阶段交付没有把覆盖率百分比作为自动门禁，
  项目负责人可在最终验收前补跑并复核核心状态机达到技术文档要求。

## 7. 阶段门禁

阶段 2 代码、自动测试、生产构建和烟雾启动已经完成，但阶段退出条件中的两个真实国产
Provider 验证尚未执行。因此当前不得创建 `stage-2-approved` 标签，也不得进入阶段 3。

项目负责人完成第 5 节、确认方向正确并明确授权进入阶段 3 后，才能更新本记录为“验收通过”、
创建阶段提交和 `stage-2-approved` 本地标签。
