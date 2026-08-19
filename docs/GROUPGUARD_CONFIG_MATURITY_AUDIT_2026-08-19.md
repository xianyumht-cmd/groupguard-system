# GroupGuard 成熟度审查与整改（2026-08-19）

状态：`engineering_review_in_progress`

任务分支：`audit/config-maturity-20260819`  
PR：`#42 refactor: mature global and group config inheritance`

目标：连续完成 1–6 阶段的成熟度审查与整改，不把人工验收拆成多轮。开发期间不自动变更 `192.168.3.89`；工程、CI、合并全部完成后，由 Windows 一键脚本做一次最终部署，保留独立一键回滚。

---

## 0. 本轮审查标准

这不是上一轮“找确定 Bug”的重复工作。本轮判断标准是：即使代码没有报错，产品模型、配置来源、运行时行为、管理界面和恢复能力是否已经达到成熟群管系统应有的可解释性与可维护性。

统一检查十个维度：

| 维度 | 达标标准 |
|---|---|
| 产品领域模型 | 全局、分群、模块、规则、权限概念不混用 |
| 配置架构 | 默认值、全局值、分群覆盖、最终值来源明确 |
| 继承与覆盖 | 可继承、可覆盖、可恢复继承、可批量操作 |
| 信息架构 | 普通管理员无需理解 `config.json` 结构即可管理 |
| 数据所有权 | 每类数据只有一个权威 Source of Truth |
| 运行时一致性 | UI 值、API effective 值、Runtime 实际使用值一致 |
| 安全与权限 | 动态路径、危险操作、秘密、批量操作均有边界 |
| 可靠性与恢复 | 保存、部署、回滚失败时不存在未知半状态 |
| 可观测性 | 能回答“为什么现在是这个值/为什么做了这个动作” |
| 工程治理 | CI、文档、仓库、发布和回滚可重复且可审计 |

---

# 阶段 1：配置领域模型与继承语义

## CFG-001 — Critical — 分群运行时原为顶层浅合并

原行为等价于：

```ts
{ ...global, ...group }
```

嵌套对象一旦分群出现一个子字段，就可能遮住整个全局对象。`qaLinkDelivery`、`contentRisk`、`selfRecall`、`featureSwitches` 等都会受到这种模型限制。

### 整改

新增 `src/config_effective.ts`，统一：

- `deepMergeConfig()`：Plain Object 递归深合并；
- Array：按原子值整体覆盖；
- 缺失 / `undefined`：继承；
- `false`、`0`、空字符串：合法显式覆盖；
- `resolveEffectiveGroupSettings()`：生成唯一 Runtime Effective Config。

状态：`fixed_in_branch`

## CFG-002 — Critical — SQLite 稀疏分群记录曾被完整 normalization 展开

完整 `GroupGuardSettings` 的 normalization 会补默认值；如果对 SQLite 的“分群覆盖记录”也这么做，本来不存在、应该继承的字段会被补成分群显式值。

### 整改

新增 `normalizeGroupOverride()`：只规范实际存在的路径，不补不存在字段。启动加载、运行时写入、API 展示均按稀疏覆盖处理。

状态：`fixed_in_branch`

## CFG-003 — High — 一个 TypeScript 类型承担三种语义

历史上 `GroupGuardSettings` 同时代表：

1. 完整全局配置；
2. SQLite 分群持久化配置；
3. Runtime 最终生效配置。

### 整改

新增：

```ts
type GroupSettingsOverride = DeepPartial<GroupGuardSettings> & { useGlobal?: boolean }
```

内部 resolver / normalizer 已按 Override 语义工作；旧 API 与存储接口仍保留兼容 cast，避免本轮把“生产语义修复”和“大面积类型重构”绑在一起。

状态：`mitigated`  
剩余债务：后续可完全拆分持久化 DTO 与 Effective DTO，但不是本轮上线阻塞项。

## CFG-004 — High — `useGlobal` 是整群模式，不应该拿来同步一个字段

`useGlobal=true` 的含义固定为：**整群完全继承全局**。它不是“某一个字段使用全局”。

成熟后的字段级模型是：

```text
Global Full Defaults
       +
Group Sparse Override
       ↓
Effective Config
```

管理员只想让一个字段继续跟随全局时，应删除该字段的 override，而不是切换整个群的 `useGlobal`。

状态：`fixed_in_branch`

## CFG-005 — High — 历史群记录缺少 `useGlobal` 时 UI 与 Runtime 可能解释不一致

旧数据可能在 `useGlobal` 字段出现之前已经存在。如果“有群记录但没有 `useGlobal`”被新 UI 当成完全继承，会改变历史语义；旧 Runtime 实际上把这种记录视为活动分群配置。

### 整改

新增 `isGroupFullyInherited()`：

```text
没有 group row        => 完全继承全局
useGlobal === true    => 完全继承全局
已有 row 且字段缺失   => 保持历史语义：活动分群 overlay
```

API 列表、单群详情、source map 与 Runtime 统一使用这一定义，并加入回归测试。

状态：`fixed_in_branch`

---

# 阶段 2：数据所有权与持久化

## Source of Truth

| 数据 | 权威来源 | 说明 |
|---|---|---|
| 全局默认配置 | `config.json` / runtime `config.global` | 完整配置 |
| 分群覆盖 | SQLite `group_config` | 稀疏 override |
| `config.json.groups` | 非独立 SoT | 正常持久化保持 `{}`，避免双源 |
| Runtime Effective Config | resolver 计算 | 不持久化成第三份配置 |
| 字段来源 | stored override + resolver | `global` / `group` |
| License / blacklist 等插件级数据 | 各自既有 SoT | 不塞进 group inheritance |

## DATA-001 — High — JSON 与 SQLite 双源风险

仓库已有 `config_persistence_guard.ts`，`saveConfigStrict()` 会阻止空 runtime group map 误清 SQLite，并把主配置文件与 SQLite 写入放在受控保存流程中。

### 本轮补强

新增和批量分群写入均：

```text
snapshot runtime groups
→ apply mutation
→ saveConfigStrict / SQLite transaction
→ success
或
→ restore runtime snapshot
```

状态：`fixed_in_branch`

## DATA-002 — Medium — 历史完整群记录不能猜测性“稀疏化”

历史字段即使恰好等于全局值，也可能是管理员明确固定的值，不能因为“看起来重复”就删除。

### 安全迁移决策

- 历史已存在路径继续视为显式覆盖；
- 新 broad-form 写入只压缩“此前不存在、且只是重复当前全局”的新路径；
- 恢复继承必须由管理员明确执行“恢复继承”，本质是删除对应 override path；
- 不做破坏性批量猜测迁移。

状态：`accepted_safe_migration_strategy`

---

# 阶段 3：Runtime Effective Config 统一

唯一有效规则：

```text
if no group row:
    effective = normalized(global)
else if explicit useGlobal == true:
    effective = normalized(global)
else:
    effective = normalize(deepMerge(global, sparseGroupOverride))
```

## RUNTIME-001 — High — State service 与 PluginState 曾存在两套读取入口

命令层使用 `configStateService.resolveGroupSettings()`，但 PluginState 内部发送/风控路径仍有直接 `this.getGroupSettings()` 的历史调用。

### 整改

`plugin_state_config_adapter.ts` 安装同一个 `resolveEffectiveGroupSettings()` resolver，并保持幂等；两条 Runtime 路径加入一致性回归。

状态：`fixed_in_branch_with_compatibility_bridge`

## RUNTIME-002 — High — Runtime 必须能解释值来源

`GET /api/groups/:id` 现在区分：

```json
{
  "global": {},
  "group": {},
  "effective": {},
  "sources": {
    "qaLinkDelivery.enabled": "group",
    "qaLinkDelivery.noticeText": "global"
  }
}
```

状态：`fixed_in_branch`

---

# 阶段 4：WebUI 管理模型

## UI-001 — High — “全量配置”不能等同于“全局配置”

新增“群首配置 → 全局配置”入口；高级“全量配置”继续保留。

定义：

- **全局配置**：管理员日常修改全局默认；
- **分群配置**：查看/修改一个群的 sparse override；
- **全量配置**：高级完整配置工具，不再承担“全局配置”的产品语义。

状态：`fixed_in_branch`

## UI-002 — High — `useGlobal` 文案语义不清

“使用全局配置”改为：

```text
继承全局配置
```

并显示：

```text
配置模式：完全继承全局
或
配置模式：全局默认 + 本群覆盖
```

状态：`fixed_in_branch`

## UI-003 — High — 缺少字段来源与恢复继承

每个可识别字段展示：

```text
来源：全局
来源：本群 [恢复继承]
```

“恢复继承”不是复制当前全局值，而是删除该字段的 persisted override，因此以后全局再次改变仍会跟随。

状态：`fixed_in_branch`

## UI-004 — High — 原始问题不能用“把当前全局值复制到所有群”来伪装成继承

原始症状：全局 `qaLinkDelivery.enabled=false`，多个群仍保存自己的 `true`。

成熟处理改为：

```text
让所有群的链接提示继承全局
→ batch restore-path(qaLinkDelivery.enabled)
```

它只删除这一条分群覆盖，查询、问答、动态命令、冷却等其它分群差异完全保留；以后全局链接提示再次开/关也会继续传播。

同时保留两类明确不同的高级批量操作：

- **恢复该字段为全局继承**：删除该字段 override；
- **将目标值写成分群覆盖**：创建/更新固定分群值，未来不自动跟随全局。

状态：`fixed_in_branch`

---

# 阶段 5：可靠性、安全、可观测性、仓库治理

## SAFE-001 — High — 动态 dotted path 防护不完整

统一拒绝动态 path segment：

```text
__proto__
prototype
constructor
```

状态：`fixed_in_branch`

## SAFE-002 — High — 批量配置失败必须恢复内存状态

所有新增批量 group mutation 使用 snapshot + strict save；失败恢复 runtime snapshot，避免“内存已改、磁盘没改”的半状态。

状态：`fixed_in_branch`

## SAFE-003 — High — 休眠历史覆盖不能被单字段批量操作偷偷删除或激活

`useGlobal=true` 的历史行可能仍保存旧 override。单字段批量设置如果直接改成 `useGlobal=false`，可能突然激活大量未知旧配置；如果先清空旧配置，又会造成数据丢失。

### 整改

- `restore-path`：只删除目标字段，所有其它休眠字段原样保留；
- `set-path`：如果发现 `useGlobal=true` 且存在其它休眠历史覆盖，安全跳过该群，不删除也不激活；
- API 返回 `skippedDormant` / `skippedDormantGroupIds`，WebUI 明确提示管理员；
- 只有没有休眠数据的纯全局行，才可以安全进入单字段 override 模式。

状态：`fixed_in_branch`

## OBS-001 — Medium — 管理员过去无法判断“为什么是这个值”

新增 `sources`、`effective`、`overrideFieldCount` 与 WebUI 来源 badge。

状态：`fixed_in_branch`

## REPO-001 — Medium — 仓库根目录存在明显本地/工具残留

已确认并处理：

- 删除空 `$null`；
- 删除无意义 `.gitguu`；
- 删除历史 `push.log`；
- `.gitignore` 增加 `*.log`、`$null`、`.gitguu`、Trae safe-rm 残留模式，阻止再次提交。

另有一个历史 Trae 终端异常长文件名仍为 tracked artifact。当前 GitHub 连接器对该文件名的删除请求触发安全拦截，未伪装为已清理。它不参与构建或生产 Runtime，并已被 ignore 规则覆盖未来同类文件；最终仓库清洁验收仍应在本地/Codex 能正常处理该特殊路径时删除这一条 tracked 历史残留。

状态：`partially_fixed_non_runtime_residual`

---

# 阶段 6：兼容迁移、测试、发布与回滚

## 自动化测试

`verify:config-inheritance` 已覆盖：

- nested sparse override；
- 全局 sibling 后续变化仍能继承；
- `useGlobal=true` 忽略休眠 override；
- 历史 row 缺 `useGlobal` 保持活动 overlay；
- source map；
- broad form 新值压缩；
- 历史显式等于全局值仍保留；
- field set/delete；
- 单字段恢复不删除其它休眠值；
- prototype path 拒绝；
- state service 与 PluginState resolver 一致。

该验证进入：

- `npm test`
- `build:debug`
- `build:snowluma`
- `build:onebot`

## WebUI 浏览器验收

新增真实 Chromium 场景：

1. “全局配置”是独立管理员入口并自动进入 `global.*` 过滤模式；
2. “让所有群的链接提示继承全局”实际发送 `restore-path`，不是复制当前值；
3. 显式批量 override 遇到休眠历史数据时，UI 能显示“安全跳过”而不是隐藏数据风险。

## 部署脚本 CI

原 CI 只解析旧 `onebot-plugin-groupguard/scripts/ops/*.ps1`，并没有验证本轮新建的根级 Windows 一键部署/回滚脚本。

本轮已修正 CI：

- path trigger 纳入 `scripts/windows/**`、两个根级 `.cmd`；
- PowerShell parser 同时检查 `scripts/windows/*.ps1`；
- `sh -n` 检查两个远端 shell helper。

## Windows 最终部署

合并后用户运行：

```text
GROUPGUARD-UPDATE.cmd
```

流程：

1. 检查 `git/npm/ssh/scp/tar`；
2. 要求 Windows worktree 干净；
3. `main` 仅允许 strict fast-forward 到 `origin/main`；
4. `npm ci`；
5. 完整 `npm test`；
6. 构建 SnowLuma `dist` 并校验 build-info commit；
7. 打包并计算 SHA-256；
8. SSH 预连接 `192.168.3.89`；
9. 上传候选与受审 helper；
10. 生产先做时间戳代码备份和 pending manifest；
11. 仅切换 `dist`，不覆盖配置、SQLite/data、日志、Token/密钥；
12. 重启 `groupguard-snowluma`；
13. readiness 健康检查；
14. 健康失败自动尝试恢复切换前代码；
15. 成功后保存 deployment manifest，并同步一份到 Windows `%LOCALAPPDATA%\GroupGuard\deployment-state`。

生产默认路径：

```text
host      192.168.3.89
user      root
app       /mnt/sda1/groupguard/app
backups   /mnt/sda1/groupguard/backups
container groupguard-snowluma
```

## 一键回滚

业务人工测试发现问题时运行：

```text
ROLLBACK-GROUPGUARD.cmd
```

回滚只恢复插件代码：

- 读取最近一次 deployment state；
- 回滚前再保存当前代码 preimage；
- 恢复对应 backup `dist`；
- 重启容器；
- 做健康检查；
- 如果“回滚后的版本”反而健康失败，再恢复回滚前 preimage。

配置、SQLite/data、日志和 secrets 不随代码回滚。

---

# 配置字段治理矩阵

| 类别 | 示例 | 目标语义 |
|---|---|---|
| 业务功能开关 | `qaEnabled`, `queryEnabled`, `dynamicCommandEnabled` | 允许分群覆盖 |
| 问答行为 | `qaCooldown*`, `qaLinkDelivery.*` | 允许字段继承/覆盖 |
| 群体验 | welcome、silent、active reply | 允许分群覆盖 |
| 内容风控 | `contentRisk.*` | 允许分群覆盖，必须深合并 |
| 自撤回 | `selfRecall.*` | 允许分群覆盖，必须深合并 |
| Feature Switch | `featureSwitches.*` | 允许分群覆盖，必须深合并 |
| 发送队列/总限流 | queue/global rate-limit | 当前仍属于 GroupGuardSettings；产品层默认按全局治理，不在常用批量 UI 暴露 |
| Token / Provider / 服务地址 | PluginConfig secrets/endpoints | 只属于插件全局，不进入 group override |
| Owner / License / 全局治理名单 | 独立插件数据 | 独立 SoT，不通过 group inheritance |

本轮没有为了“看起来更干净”而批量删除历史 SQLite 字段，也没有把历史管理员意图猜成默认值。

---

# 最终验收标准

合并前必须全部满足：

- TypeScript typecheck 通过；
- config inheritance regression 通过；
- 全仓 `npm test` 通过；
- SnowLuma build 通过；
- WebUI real Chromium acceptance 通过；
- Windows PowerShell 与远端 shell helper 静态门禁通过；
- PR final diff 审查无新的高风险问题；
- `ARCHITECTURE.md` / `DECISIONS.md` / `PROJECT_STATE.md` / `OPERATIONS.md` 与实现一致；
- PR 合并到 `main` 并验证 main 含最终提交。

用户人工验收只做一轮：合并完成后运行 `GROUPGUARD-UPDATE.cmd`，重点检查全局/分群/字段继承与真实机器人行为；如业务不正常，直接运行 `ROLLBACK-GROUPGUARD.cmd`。

## 当前状态

代码和文档仍在 Draft PR #42 进行最终工程门禁。当前任务尚未部署或重启 `192.168.3.89`，因此本文不提前填写任何“生产验证通过”结论。
