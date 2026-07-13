# 阶段 1 验收记录

| 项目 | 内容 |
|---|---|
| 阶段 | 1——Power BI 连接与 Schema 浏览 |
| 版本 | 0.2.0 |
| 开发完成日期 | 2026-07-13 |
| 当前状态 | 验收通过 |
| 验收日期 | 2026-07-13 |
| 验收依据 | 项目负责人明确授权进入阶段 2 |
| 自动验证 | 通过 |
| 真实模型只读验证 | 通过（当前唯一打开的 Power BI Desktop 模型） |
| 技术基线 | `docs/TECHNICAL_DEVELOPMENT.md` 1.1 |

## 1. 本阶段目标

建立 Power BI Desktop 的严格只读连接能力，完成模型发现、选择、Schema 快照、对象浏览、
断线失效和重连。本阶段不得调用大模型、执行 DAX 查询或修改模型。

## 2. 实际完成项

- 精确锁定 `@microsoft/powerbi-modeling-mcp-win32-x64@0.5.0-beta.11`。
- MCP 固定使用 `--start --readonly --compatibility=PowerBI` 启动。
- 启动时校验固定版本的工具输入结构和 operation 集；应用层再次限制工具与只读 operation。
- 支持发现当前用户已打开的 Power BI Desktop 模型；单模型自动连接，多模型要求用户选择。
- 连接标识、端口和连接串仅保留在 Main 进程；Renderer 只接收随机、不透明的候选 UUID。
- 读取模型、表、列、度量值和关系，List 后批量 Get 并核对对象名称集合。
- 构建版本化 `ModelSnapshot`，包含稳定 SHA-256 Schema 哈希、连接会话标识和对象统计。
- 建立大小写与 Unicode 规范化对象注册表，拒绝重复、歧义、缺名及关系端点不存在的 Schema。
- 列缺少数据类型、度量值缺少 DAX、计算列或计算表缺少表达式时拒绝发布不完整快照。
- 将 `CalculatedTableColumn` 独立表示为“计算表列”，不错误要求逐列表达式。
- 日期表状态保持 `marked`、`unmarked`、`unknown` 三态，不按表名或日期列推断。
- 连接切换采用串行 Disconnect/Connect，使用 operation epoch 和取消信号阻止迟到结果覆盖新状态。
- Desktop 关闭或 MCP 退出时立即清空旧快照和注册表；连接后每 3 秒执行非重叠健康检查。
- 建立严格输入校验的类型化 IPC 与 Preload API，不向 Renderer 暴露通用 channel 或 Electron API。
- 完成连接状态、空状态、模型选择、Schema 搜索、对象详情、只读 DAX、关系、断开和重连 UI。
- 增加可重复执行的 `npm run test:live-model` 真实模型只读验收命令。

## 3. 范围边界检查

本阶段未实现或调用以下后续能力：

- 大模型 Provider、API Key 或任何外部 LLM 网络请求。
- 五个业务功能入口和需求完整性判断。
- DAX 查询、生成、诊断或运行时验证。
- 模型评估。
- Create、Update、Delete、Rename、Refresh、Transaction、Trace 等 MCP 操作。
- 度量值、计算列、计算表或其他模型对象写回。

## 4. 自动验证结果

| 验证项 | 命令 | 结果 |
|---|---|---|
| 完整质量门禁 | `npm run quality` | 通过 |
| ESLint | `npm run lint` | 通过，0 警告 |
| 类型检查 | `npm run typecheck` | 通过 |
| 单元测试 | `npm run test:unit` | 9 个文件、82 项通过 |
| 集成测试 | `npm run test:integration` | 4 个文件、10 项通过 |
| 固定 MCP 真实契约 | 集成测试内执行 | beta.11 只读启动、工具契约和模型发现通过 |
| 当前真实模型快照 | `npm run test:live-model` | 1 项通过；完整读取并建立注册表与哈希 |
| 生产构建 | `npm run build` | 通过 |
| Electron 启动 | `npm run smoke` | 通过，Renderer 返回 `SMOKE_OK` |

核心自动用例覆盖写操作拒绝、MCP 回包 operation 校验、截断检测、Schema 不完整拒绝、
稳定哈希、对象注册表、快速切换竞态、断线立即失效、IPC 输入与错误脱敏，以及 Renderer
主要状态和 Schema 交互。

真实模型验证时检测到 Power BI Desktop `2.155.756.0` x64，MCP 发现一个本地实例；测试仅
读取 Schema 元数据，没有输出模型名称、对象名称或 DAX，也没有执行查询或写操作。

## 5. 项目负责人人工验收参考

项目负责人已明确授权进入阶段 2，作为对阶段 1 方向和开发交付的验收确认。以下检查项
保留为后续回归参考；本记录不虚构未单独反馈的逐项人工结果。

在 Power BI Desktop 中打开一个用于验收的 PBIX，然后在项目根目录执行：

```powershell
npm run dev
```

请检查：

- 一个模型时自动连接，页面显示正确的模型名称和对象数量。
- 抽查表、列、数据类型、度量值表达式、格式、描述和关系，与 Desktop 一致。
- 搜索表、列或度量值后，结果和对象详情正确；DAX 仅供查看。
- 日期表标记未知时显示“标记状态未知”，不会被误认为已标记日期表。
- 同时打开两个 PBIX，重新扫描后显示选择器，并可分别选择和切换。
- 关闭当前连接的 PBIX，最迟在约 3 秒健康检查窗口内清空旧 Schema。
- 重开 PBIX 后重新发现并建立新会话，不复用旧快照。
- 手动断开和重新连接正常。
- 全流程没有大模型请求、DAX 查询或模型写入。

也可以在只打开一个 PBIX 时执行：

```powershell
npm run test:live-model
```

该命令只验证 Schema 完整性和注册表引用，不替代上述 UI 抽查、多模型切换和关闭模型测试。

## 6. 偏差、风险与限制

- 固定 beta.11 的 Table/Relationship List 契约没有 `maxResults` 或分页参数。本地适配器会检测
  `hasMore`、截断标志、continuation、`totalCount`，并核对 List/Get 名称集合；如果上游在
  没有任何标记的情况下静默截断，客户端无法从现有契约证明完整性。
- Modeling MCP 仍是预览组件，许可限制为内部开发测试且禁止分发。当前构建明确排除其二进制；
  获得 Microsoft 另行许可或组织法务确认前，不交付包含 MCP 的安装包。
- 当前自动真实模型测试已完成单模型快照验证；多模型切换、关闭模型后的 UI 失效和视觉抽查仍
  需要项目负责人按第 5 节执行。

## 7. 阶段门禁

阶段 1 开发运行版、自动验证、真实单模型只读验证和项目负责人验收均已完成，可以创建
`stage-1-approved` 本地 Git 标签并进入阶段 2。阶段 2 仍须遵守“只发送固定测试文本，
不发送 Power BI 内容”的范围边界。
