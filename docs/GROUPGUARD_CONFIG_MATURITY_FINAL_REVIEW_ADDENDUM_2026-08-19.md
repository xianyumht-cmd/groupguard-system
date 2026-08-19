# GroupGuard 配置成熟化最终复审补充（2026-08-19）

状态：`final_engineering_gate`

关联：`docs/GROUPGUARD_CONFIG_MATURITY_AUDIT_2026-08-19.md`、PR #42。

本文件只记录在 1–6 阶段主体整改完成后，最终 diff / CI 复审继续发现的系统性问题。它们不是为了凑 Bug 数量，而是为了证明最终交付链本身也接受同一套成熟度标准。

## FINAL-SAFE-001 — High — 部署状态文件曾以 shell 代码方式加载

### 问题

早期一键部署/回滚 helper 为了恢复上次部署状态，使用 shell dot/source 直接加载 `pending-code-deploy.env` / `latest-code-deploy.env`。

即使状态文件由本工具生成，这仍有两个不应存在的能力：

1. 状态文件一旦被篡改，可以执行 shell；
2. 状态文件可以覆盖已经通过 CLI 校验的 `APP_DIR`、`CONTAINER`、`TARGET_COMMIT` 等变量，使“入口参数校验”失去权威性。

### 整改

- 远端 deploy / rollback helper 禁止 `source`、`.`、`eval` 读取持久化状态；
- 统一通过 `state_value()` 把 `KEY='value'` 当数据解析；
- 重新校验 commit、backup path、app/container 一致性；
- CLI 参数始终是本次操作的权威值；
- 状态/manifest 尽可能设置为 `0600`；
- CI 新增静态门禁：deployment helper 中出现可执行式状态加载或 `eval` 直接失败。

状态：`fixed_in_branch`

## FINAL-DATA-001 — High — 通用“空 groups 防误删”保护会阻止最后一个 override 的明确删除

### 问题

历史上为了防止 `config.json.groups = {}` 被误解释成“清空 SQLite 所有分群配置”，`saveConfigStrict()` 会在 runtime groups 为空、SQLite 非空时保留 SQLite 数据。

这个保护对普通配置保存是正确的，但对本轮新增的明确操作：

```text
恢复某字段继承
→ 删除该字段 override
→ 如果恰好删掉最后一条 group override
→ runtime groups 变成 {}
```

会产生反效果：管理员明确要求删除，通用 guard 却把旧 SQLite 行保留下来，导致“恢复继承”表面成功、持久化后又回来。

### 整改

- `selectGroupsForPersistence()` 增加显式 `allowEmptyRuntime` 策略；默认仍保持防误删；
- `saveConfigStrict()` 增加仅供明确 group mutation 使用的 `allowEmptyGroupPersistence`；
- `group_api.persistGroupMutation()` 只有在“此前非空、明确 mutation 后变空”时启用该策略；
- 自动回归同时证明：
  - 普通空 runtime 仍不会删除 SQLite；
  - 明确 mutation 产生的空 snapshot 可以真正持久化为空。

状态：`fixed_in_branch`

## FINAL-UI-001 — High — “全局配置”最初只是视觉过滤，保存仍可能提交非 global 字段

### 问题

最初实现把高级全量页的过滤器切换成 `global.` 并改标题为“全局配置”，但原高级保存按钮仍使用原来的表单收集逻辑。也就是说“只显示 global.*”不等于“只保存 global.*”。

这违反本轮最重要的产品契约：页面叫“全局配置”时，保存动作不能偷偷修改其它配置域。

### 整改

- global mode 自己接管高级页保存按钮；
- `collectGlobalPatch()` 只收集 `data-config-key` 以 `global.` 开头的字段；
- 通过 `/api/config/patch` 只提交该 scoped patch；
- global mode 保存按钮明确显示“保存全局配置”；
- Playwright 验收动态向表单插入一个非 global 探针字段，再点击保存，断言请求 payload 中所有 key 都以 `global.` 开头且探针绝不出现。

状态：`fixed_in_branch`

## FINAL-OPS-001 — Medium — Windows 一键构建缺少 Node 基线预检

### 问题

仓库当前依赖和自动化基线运行在 Node 22/24，而一键 Windows 脚本早期只检查 `npm` 命令存在。旧 Node 环境可能拖到 `npm ci` 或 build 才失败，错误不够可解释。

### 整改

- 一键更新脚本显式要求 `node`；
- 在改仓库、SSH、上传生产候选之前检查 Node major >= 22；
- 不满足时直接停止并给出明确版本提示。

状态：`fixed_in_branch`

## FINAL-OPS-002 — High — 一键部署最初用未认证 `/api/readyz` 判断健康，生产会得到 401

### 问题

最终部署脚本最初在容器内直接请求：

```text
http://127.0.0.1:6108/api/readyz
```

但当前 Admin Server 在 `/api/readyz`、`/api/health`、`/api/build-info` 之前统一执行 `requireAuth()`。也就是说，未携带 GroupGuard WebUI token 的探针并不能证明新版本健康，在真实生产契约下会收到 401，并把一次本可成功的部署错误判定成失败/自动回滚。

此外，单看 `ready=true` 仍不足以证明刚刚切换的就是目标 commit；部署门禁必须同时验证运行中的 build identity。

### 整改

- deploy / rollback helper 改为在容器内读取 `GROUPGUARD_WEBUI_TOKEN`；若未显式配置，则按 standalone server 同一约定读取 `GROUPGUARD_DATA_DIR/.groupguard-webui-token`；
- 使用 `x-groupguard-token` 请求 `/api/build-info` 与 `/api/health`；
- 健康通过必须同时满足：HTTP 200、`health.ready === true`、运行 build commit 与预期 commit 一致、build 不是 dirty；
- 新部署、目标已存在的 reconcile、部署失败后的自动恢复、人工 rollback、rollback 失败后的 preimage 恢复，都使用同一 authenticated exact-build 检查；
- CI 增加静态契约门禁，要求两个远端 helper 同时包含 token、build-info、health 与 data-dir fallback 逻辑。

状态：`fixed_in_branch_pending_gate`

## FINAL-OPS-003 — High — “目标版本已经在运行”时不能丢失一键回滚保证

### 问题

部署 helper 支持 resume/reconcile：如果生产 `dist/build-info.json` 已经等于目标 commit，就不再次切换代码。这对 SSH 中断后的续跑很重要。

早期实现存在一个边界：如果目标代码已经在运行，但匹配的 pending/latest 状态中没有可用 backup，helper 仍可能写入一个 `BACKUP_PATH=''` 的最新 manifest 并返回成功。这样后续 `ROLLBACK-GROUPGUARD.cmd` 会因为没有真实备份而无法兑现“一键回滚”。更糟的是，这次 reconcile 还可能覆盖原来的 latest rollback pointer。

### 整改

- reconcile 只有在能恢复出位于受限 backup root 下的真实 `dist` 备份时才允许成功；
- 必须存在 backup entry `snowluma-service.mjs`；
- backup 自身 `build-info.json` 的 commit 必须是合法 40 位 SHA；
- 若状态里的 `PREVIOUS_COMMIT` 已知，则必须和 backup build commit 一致；若状态里是 `unknown`，用受验证的 backup commit 补全；
- 找不到真实回滚点时 fail closed，不写新的 latest manifest，也不覆盖之前的回滚指针；
- CI 锁定 `RECONCILE_ROLLBACK_STATE_MISSING` 与 backup commit mismatch 防线。

状态：`fixed_in_branch_pending_gate`

## FINAL-CI-001 — Medium — 浏览器验收门禁依赖系统 apt 安装导致环境型超时

### 问题

`WebUI Browser Acceptance` 原先使用：

```text
npx playwright install --with-deps chromium
```

在 GitHub Hosted `ubuntu-24.04` 上，这一步会主动进入 apt 镜像更新/系统依赖安装。2026-08-19 的最终门禁实际发生 Ubuntu/Azure 镜像源长时间无响应，20 分钟 job timeout 到期后被取消，真正的 Playwright 验收一条都没有执行。

这不是产品代码失败，但属于发布门禁可靠性问题：外部系统包源不应成为 WebUI 自动验收的单点阻塞。

### 整改

- hosted runner 保留固定 Node 22；
- 继续固定 `@playwright/test@1.55.0`；
- 浏览器安装改为 `npx playwright install chromium`，只获取 Playwright 对应 Chromium binary，不在每次 PR 门禁重新跑 apt；
- runner 镜像本身负责基础共享库；如果未来镜像变化导致真实缺库，验收应快速失败并给出具体 browser launch 错误，而不是长时间卡在系统源；
- 原失败 run 保留作为环境故障证据；修复后的 Chromium 门禁已经成功执行完整 desktop/mobile/config-maturity Playwright 验收。

状态：`fixed_and_verified`

## 最终门禁补充

PR #42 在转 Ready/合并前还必须满足：

- `GroupGuard CI` 成功；
- `GroupGuard Build` 成功；
- `WebUI Browser Acceptance` 成功；
- 上述 final finding 对应的回归门禁均存在；
- 最终 diff 不再发现未处理 High/Critical；
- 不自动连接、部署或重启 `192.168.3.89`；
- 合并后才由用户在 Windows 端运行 `GROUPGUARD-UPDATE.cmd` 做唯一一轮人工业务验收；业务异常时运行 `ROLLBACK-GROUPGUARD.cmd`。
