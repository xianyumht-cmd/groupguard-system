# GroupGuard 配置成熟度审查与整改（2026-08-19）

状态：`implementation_in_progress`

任务分支：`audit/config-maturity-20260819`

目标：一次完成配置体系 1–6 阶段审查与整改，不把人工验收拆成多轮。生产环境不在本次开发过程自动变更；最终由 Windows 一键脚本在人工确认后执行部署，并保留一键回滚。

## 结论摘要

当前 GroupGuard 已经具备较完整的配置项、SQLite 分群持久化、WebUI 和运行时刷新能力，但原实现同时把 `GroupGuardSettings` 当成“全局完整配置”“分群存储配置”和“最终生效配置”使用，导致三种不同语义混在一起。最关键的后果有两个：一是运行时使用顶层浅合并，嵌套对象只要分群写了一个子字段，就可能遮住全局对象的其它子字段；二是启动加载 SQLite 分群配置后又调用完整配置 normalization，把本应代表“继承”的缺失字段补成默认值，使稀疏覆盖语义失真。

本轮整改把配置模型明确为：

```text
Global Full Config（完整全局默认值）
          +
Group Sparse Override（只保存本群明确覆盖的字段）
          ↓ deep merge
Effective Group Config（运行时最终生效配置）
```

其中：

- `useGlobal=true`：本群完全使用全局配置，本群已存覆盖值保持休眠，不参与本次 effective 计算。
- `useGlobal=false`：全局配置作为基底，本群只覆盖实际存储的字段。
- 对象递归深合并；数组视为原子值，分群数组存在时整体替换全局数组。
- `undefined` / 字段不存在代表继承；`false`、`0`、空字符串是合法显式覆盖。
- 旧 SQLite 已经存在的显式字段不进行猜测性删除，避免误把历史管理员意图当成自动补值。
- 新建或后续由大表单写入的值，如果只是重复全局且此前并不存在该覆盖路径，则自动压缩掉，逐步收敛为稀疏覆盖。

---

# 阶段 1：配置字段与继承语义审查

## FINDING CFG-001 — Critical — 分群运行时使用顶层浅合并

原 `PluginState.getGroupSettings()` 在 `useGlobal=false` 时执行：

```ts
return { ...this.config.global, ...this.config.groups[groupId] };
```

这只合并第一层。以 `qaLinkDelivery` 为例，如果全局为：

```json
{
  "enabled": false,
  "noticeText": "请稍等",
  "delayMinMs": 2000,
  "delayMaxMs": 4000,
  "wrapInCodeBlock": true
}
```

而本群只想覆盖：

```json
{
  "qaLinkDelivery": {
    "enabled": true
  }
}
```

浅合并会把整个全局 `qaLinkDelivery` 对象替换掉，而不是只覆盖 `enabled`。

### 整改

新增 `src/config_effective.ts`：

- `deepMergeConfig()`
- `normalizeGroupOverride()`
- `resolveEffectiveGroupSettings()`
- `getGroupConfigSourceMap()`
- 字段级 set/delete override helper

`configStateService.resolveGroupSettings()` 与 PluginState 内部读取统一走同一个 effective resolver。

状态：`fixed_in_branch`

## FINDING CFG-002 — Critical — SQLite 稀疏配置在启动时被完整 normalization 展开

原启动路径在 `storageAdapter.loadAllGroupConfigs()` 后对每条记录调用 `normalizeGroupSettings(groupSettings)`。该函数用于“完整 GroupGuardSettings”是合理的，但用于“稀疏覆盖”会自动填充缺失字段，导致本来应表示继承的路径变成显式本群值。

### 整改

启动与运行时配置写入改为 `normalizeGroupOverride()`，只校验/规范实际存在的路径，不补不存在的字段。

状态：`fixed_in_branch`

## FINDING CFG-003 — High — 一个 TypeScript 类型承担三种不同语义

当前 `GroupGuardSettings` 同时用于：

1. 全局完整配置；
2. SQLite 分群持久化值；
3. runtime effective config。

这会让编译器无法帮助区分“必需完整字段”和“可省略覆盖字段”。

### 整改

本轮新增：

```ts
type GroupSettingsOverride = DeepPartial<GroupGuardSettings> & { useGlobal?: boolean };
```

由于仓库现有接口和持久化层大量以 `GroupGuardSettings` 为契约，本轮采用兼容迁移：内部 resolver/normalizer 使用 `GroupSettingsOverride`，对旧 API 边界保留兼容 cast。后续可单独做类型层完全拆分，不把大范围类型重构与本次生产语义修复绑在一起。

状态：`mitigated`; residual debt tracked

## FINDING CFG-004 — High — `useGlobal` 粒度过粗，容易被误用成单字段同步

`useGlobal=true` 是整群继承，不是“这个字段使用全局”。如果为了关闭 `qaLinkDelivery.enabled` 而把全部群切换为 `useGlobal=true`，查询、问答、动态命令、概率、冷却等其它本群差异也会暂时失效。

### 整改

新增字段级批量操作：

```text
set-path(path, value, groupIds?)
```

允许仅把 `qaLinkDelivery.enabled` 等某一字段应用到全部群或指定群，同时保持其它分群覆盖不变。

状态：`fixed_in_branch`

---

# 阶段 2：数据所有权与持久化审查

## Source of Truth

| 数据 | Source of Truth | 说明 |
|---|---|---|
| 全局配置 | `config.json` / runtime `config.global` | 完整默认值 |
| 分群配置 | SQLite `group_config` | 稀疏覆盖值 |
| `config.json.groups` | 非 SoT | 正常持久化时保持 `{}`，避免双源 |
| 最终生效配置 | 运行时 resolver 计算结果 | 不直接持久化 |
| 分群字段来源 | 由 stored override + resolver 计算 | `global` 或 `group` |

## FINDING DATA-001 — High — config.json 与 SQLite 存在双源风险，但已有保护机制

仓库已经存在 `config_persistence_guard.ts`，并且 `saveConfigStrict()` 会：

1. 读取 SQLite 已持久化分群配置；
2. 通过 guard 阻止空 runtime map 误覆盖 SQLite；
3. 将主 `config.json` 持久化为 `groups: {}`；
4. 使用 `replaceAllGroupConfigs()` 与文件原子写结合；
5. 失败时恢复原主配置文件。

这是正确方向，应保留。

### 本轮补强

所有新增分群写入和批量写入先保存 runtime snapshot，调用 `saveConfigStrict()`，失败则恢复内存快照，避免“内存已改、磁盘失败”造成短时不一致。

状态：`fixed_in_branch`

## FINDING DATA-002 — Medium — 旧完整分群记录无法可靠推断哪些字段是人工覆盖

历史数据可能已经经过 normalization 被补全。仅凭“它恰好等于全局值”不能证明这是自动补值，也可能是管理员明确希望固定该值。

### 决策

不做破坏性批量稀疏化迁移。

策略：

- 历史已存在路径继续视为显式覆盖；
- 新写入时，只删除“此前不存在且与当前全局相等”的路径；
- 管理员可在 WebUI 对某字段点击“恢复继承”，明确删除该覆盖路径；
- `useGlobal=true` 不删除旧覆盖，只让其休眠。

状态：`accepted_safe_migration_strategy`

---

# 阶段 3：Runtime Effective Config 统一

## 统一规则

Effective Config 的唯一规则：

```text
if no group row:
    effective = normalized(global)
else if group.useGlobal == true:
    effective = normalized(global) + effective.useGlobal=true
else:
    effective = normalize(deepMerge(normalized(global), sparseGroupOverride))
```

深合并规则：

- Plain Object：递归合并；
- Array：整体替换；
- primitive：本群存在即覆盖；
- `undefined`：继承；
- 禁止 `__proto__` / `prototype` / `constructor` 路径进入动态 patch。

## FINDING RUNTIME-001 — High — State service 与 PluginState 可能形成两套 resolver

仓库迁移期间既有 `configStateService.resolveGroupSettings()`，也有 `PluginState.getGroupSettings()` 内部调用。只修前者会导致命令层和发送/风控内部路径结果不同。

### 整改

`plugin_state_config_adapter.ts` 在初始化时将 PluginState 的 group settings resolver 安装为统一的 `resolveEffectiveGroupSettings()`，并保持幂等。这样现有内部 `this.getGroupSettings()` 调用和 state service 路径使用相同规则。

这是兼容桥。长期应把 PluginState 的配置职责完全移入 config domain service。

状态：`fixed_in_branch_with_compatibility_bridge`

## 可解释性

`getGroupConfig()` 现在返回：

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

从而 WebUI 可以明确显示“最终值是什么”和“值来自哪里”。

---

# 阶段 4：WebUI 管理体验整改

## FINDING UI-001 — High — “全量配置”与“全局配置”概念混淆

原控制台没有独立“全局配置”入口；高级“全量配置”编辑器包含 `global.*`，用户很容易把“全量配置”等同于“全局配置”。

### 整改

新增“群首配置 → 全局配置”入口。为了不复制一套大型表单，它复用现有全量编辑器，但自动只筛选 `global.*`，并明确说明：

- 这里只改全局默认值；
- 分群显式覆盖不会被自动删除；
- 要把一个字段同步所有群，应使用字段级批量工具。

“高级设置 → 全量配置”仍保留，用于高级完整配置编辑。

状态：`fixed_in_branch`

## FINDING UI-002 — High — “使用全局配置”文案不能准确表达行为

改名为：

```text
继承全局配置
```

并在分群页展示：

```text
配置模式：完全继承全局
或
配置模式：全局默认 + 本群覆盖
```

状态：`fixed_in_branch`

## FINDING UI-003 — High — 缺少字段来源和恢复继承操作

新增：

```text
来源：全局
来源：本群  [恢复继承]
```

“恢复继承”实际删除这个 stored override path，而不是把当前全局值复制进本群，因此以后全局再次变化仍会跟随。

状态：`fixed_in_branch`

## FINDING UI-004 — High — 原始问题需要逐群修改 `qaLinkDelivery.enabled`

新增一键操作：

```text
同步全局链接提示开关到全部群
```

行为：读取 `global.qaLinkDelivery.enabled`，只把这一字段应用到全部已知群；不修改其它分群配置。

还新增常用字段批量应用：

- `qaEnabled`
- `queryEnabled`
- `dynamicCommandEnabled`
- `activeReplyEnabled`
- `qaLinkDelivery.enabled`

状态：`fixed_in_branch`

---

# 阶段 5：可靠性、安全与可观测性

## FINDING SAFE-001 — High — 动态 dotted path 过滤不完整

原 `object_patch.ts` 对 `__proto__` 有限制，但 `constructor.prototype.*` 等路径也应统一拒绝。

### 整改

所有动态 path segment 禁止：

```text
__proto__
prototype
constructor
```

新的 group override path helper 使用同样约束。

状态：`fixed_in_branch`

## FINDING SAFE-002 — Medium — 批量配置操作必须具备失败恢复

新增批量操作不直接逐条“写了算了”，而是：

```text
snapshot runtime groups
→ apply all mutations
→ saveConfigStrict / SQLite transaction path
→ success
or
→ restore runtime snapshot
```

状态：`fixed_in_branch`

## FINDING OBS-001 — Medium — 管理员无法判断最终值的来源

通过 `sources` map 和 WebUI badge 增加字段来源可观测性；列表同时增加 `overrideFieldCount`。

状态：`fixed_in_branch`

## FINDING SAFE-003 — Medium — `useGlobal=true` 的历史行可能带休眠旧覆盖

如果直接将这种历史行切换到 `useGlobal=false` 并同时应用一个字段，旧休眠覆盖可能全部突然生效。

### 整改

字段级 batch 对 `useGlobal=true` 的历史行从新的：

```json
{ "useGlobal": false }
```

开始，再仅写入目标 path，不激活未知旧覆盖。

状态：`fixed_in_branch`

---

# 阶段 6：兼容迁移、测试、发布与回滚

## 自动化验证

新增 `scripts/verify-config-inheritance.ts`，覆盖：

- 稀疏 nested override；
- 全局 nested sibling 后续变化可继续继承；
- `useGlobal=true` 忽略休眠覆盖；
- source map；
- broad form 新值压缩；
- 历史显式等于全局的路径保留；
- field set/delete；
- prototype path 拒绝；
- state service 与 PluginState resolver 一致。

该验证已经接入：

- `npm test`
- `build:debug`
- `build:snowluma`
- `build:onebot`

最终合并前还必须通过仓库现有 TypeScript、架构、OneBot、SnowLuma、WebUI 浏览器验收等 GitHub Actions 门禁。

## 发布原则

本任务开发阶段不直接变更 `192.168.3.89`。

最终 Windows 脚本必须：

1. 更新 `D:\project2\groupguard-system` 到已确认的 `main`；
2. 本地运行测试和 SnowLuma 构建；
3. 记录 source commit；
4. SSH 到 `192.168.3.89` 做生产预检；
5. 在 `/mnt/sda1/groupguard/backups` 创建时间戳备份；
6. 仅切换插件代码，不覆盖 `config.json`、SQLite/data、日志、密钥；
7. 重启 `groupguard-snowluma`；
8. 做 readiness/服务健康检查；
9. 记录 deployment manifest；
10. 若切换后验证失败，脚本自动尝试恢复本次备份；
11. 单独保留一键手动 rollback launcher。

### 已知生产脚本历史坑

必须延续 2026-08-05 已验证经验：

- ARM 宿主不保证有 Node，因此构建与 JS/TS 检查应在 Windows 本地完成；
- PowerShell 5.1 不能把 SSH 的普通 stderr 输出直接等同于命令失败，必须以 native process exit code 为准；
- 部署脚本必须 resume-safe，客户端中断后再次执行不能盲目覆盖一个未知已经切换的版本；
- 备份和 rollback manifest 必须先于代码切换完成。

---

# 配置字段分类矩阵

不是所有 `global.*` 都应允许分群覆盖。当前原则如下：

| 类别 | 典型字段 | 推荐语义 |
|---|---|---|
| 业务功能开关 | `qaEnabled`, `queryEnabled`, `dynamicCommandEnabled` | 允许分群覆盖 |
| 问答行为 | `qaCooldown*`, `qaLinkDelivery.*` | 允许分群覆盖 |
| 群体验 | 欢迎词、silent、active reply | 允许分群覆盖 |
| 内容风控规则 | `contentRisk.*` | 可分群覆盖，必须深合并 |
| 自撤回策略 | `selfRecall.*` | 可分群覆盖，必须深合并 |
| feature switches | `featureSwitches.*` | 可分群覆盖，必须深合并 |
| 全局发送队列/总限流 | queue/global rate-limit 类 | 默认保持全局统一 |
| 外部凭据/Token/服务地址 | secrets/provider endpoints | 只允许全局，不应下沉到群 |
| owner/license/global blacklist | 插件级治理数据 | 独立 SoT，不通过群 override 继承 |

字段级白名单治理可在后续独立维护任务继续收紧；本轮优先修复现有行为不一致和用户可操作性。

---

# 迁移兼容保证

本轮明确不做以下危险动作：

- 不批量删除历史 SQLite 分群字段；
- 不因为值等于全局就推断它一定不是人工覆盖；
- 不把 `useGlobal=true` 当作单字段同步工具；
- 不把完整 effective config 重新写回 SQLite；
- 不让“保存全局配置”隐式覆盖全部分群配置；
- 不在开发阶段直接重启生产服务。

因此升级后，旧分群显式值继续保留；新配置写入逐步进入稀疏覆盖模型。

---

# 最终验收标准

合并前：

- TypeScript typecheck 通过；
- 新 inheritance regression 通过；
- 全仓库 `npm test` 通过；
- SnowLuma build 通过；
- WebUI browser acceptance 通过；
- PR diff 完整审查；
- 文档、部署脚本、rollback 脚本与实现一致。

用户最终只需要做一次人工验收：运行 Windows 一键更新/部署脚本后，重点验证控制台全局/分群配置与实际机器人行为。若有问题直接运行一键回滚，不需要按 1–6 阶段逐项部署测试。

## 当前状态

截至本文首次写入，代码整改正在 draft PR 中执行 GitHub Actions；生产环境尚未由本任务修改。最终测试结果、PR 合并 SHA、脚本文件名和生产验证结果应在任务结束时补录，不能提前填写为通过。
