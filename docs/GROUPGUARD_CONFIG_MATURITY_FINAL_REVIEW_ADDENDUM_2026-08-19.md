# GroupGuard 配置成熟化最终复审补充（2026-08-19）

状态：`merged_awaiting_owner_production_acceptance`

关联：`docs/GROUPGUARD_CONFIG_MATURITY_AUDIT_2026-08-19.md`、已合并 PR #42、merge commit `9427c6577439acf8987a208909fa8ae3e9c09e2d`。

本文件记录 1–6 阶段主体整改完成后，最终 diff / CI 复审继续发现的系统性问题。它们不是为了凑 Bug 数量，而是为了证明最终交付链本身也接受同一套成熟度标准。

## FINAL-SAFE-001 — High — 部署状态文件曾以 shell 代码方式加载

### 问题

早期一键部署/回滚 helper 为了恢复上次部署状态，使用 shell dot/source 直接加载 `pending-code-deploy.env` / `latest-code-deploy.env`。状态文件一旦被篡改既可能执行 shell，也可能覆盖已经通过 CLI 校验的 `APP_DIR`、`CONTAINER`、`TARGET_COMMIT` 等变量。

### 整改

- deploy / rollback helper 禁止 `source`、`.`、`eval` 读取持久化状态；
- 统一通过 `state_value()` 把 `KEY='value'` 当数据解析；
- 重新校验 commit、backup path、app/container 一致性；
- CLI 参数始终是本次操作的权威值；
- 状态/manifest 尽可能设置为 `0600`；
- CI 静态门禁禁止可执行式状态加载。

状态：`fixed_and_verified`

## FINAL-DATA-001 — High — 通用“空 groups 防误删”保护会阻止最后一个 override 的明确删除

### 问题

历史防护会阻止 `config.json.groups={}` 被误解释成清空 SQLite；但当管理员明确执行“恢复继承”，且刚好删除最后一条 group override 时，空 runtime snapshot 本身就是预期结果，不能再被通用 guard 恢复成旧 SQLite 行。

### 整改

- `selectGroupsForPersistence()` 增加显式 `allowEmptyRuntime` 策略，默认仍防误删；
- `saveConfigStrict()` 增加仅供明确 group mutation 使用的 `allowEmptyGroupPersistence`；
- `persistGroupMutation()` 只在“此前非空、明确 mutation 后变空”时启用；
- 回归同时证明普通空 runtime 不会删 SQLite，而明确 mutation 可以持久化真正的空 snapshot。

状态：`fixed_and_verified`

## FINAL-UI-001 — High — “全局配置”最初只是视觉过滤，保存仍可能提交非 global 字段

### 问题

只把高级全量页过滤到 `global.` 并不能保证保存请求只修改 global 域。

### 整改

- global mode 自己接管高级页保存按钮；
- `collectGlobalPatch()` 只收集 `data-config-key` 以 `global.` 开头的字段；
- `/api/config/patch` 只接收 scoped patch；
- Playwright 动态注入非 global 探针字段，点击保存后断言 payload 中所有 key 都以 `global.` 开头且探针绝不出现。

状态：`fixed_and_verified`

## FINAL-OPS-001 — Medium — Windows 一键构建缺少 Node 基线预检

### 整改

- 一键更新脚本显式要求 `node`；
- 在仓库更新、SSH、上传生产候选之前要求 Node major >= 22；
- 不满足时 fail fast 并给出明确版本提示。

状态：`fixed_and_verified`

## FINAL-OPS-002 — High — 一键部署最初用未认证 `/api/readyz` 判断健康

### 问题

Admin Server 的 `/api/readyz`、`/api/health`、`/api/build-info` 都在 `requireAuth()` 之后。未携带 WebUI token 的探针会得到 401；而且单看 ready 也不能证明刚切换的就是目标 commit。

### 整改

- deploy / rollback helper 在容器内优先读取 `GROUPGUARD_WEBUI_TOKEN`；未显式配置时按 standalone server 同一约定读取 `GROUPGUARD_DATA_DIR/.groupguard-webui-token`；
- 使用 `x-groupguard-token` 请求 `/api/build-info` 与 `/api/health`；
- 成功条件同时要求 HTTP 200、`health.ready === true`、运行 build commit 与预期 commit 一致、build 非 dirty；
- 新部署、reconcile、自动恢复、人工 rollback、rollback preimage 恢复都走同一 authenticated exact-build contract；
- CI 锁定 token、build-info、health 与 data-dir fallback 契约。

状态：`fixed_and_verified`

## FINAL-OPS-003 — High — “目标版本已经在运行”时不能丢失一键回滚保证

### 问题

resume/reconcile 场景中，如果目标 commit 已经在运行，但找不到匹配 backup，不能写入 `BACKUP_PATH=''` 的最新 manifest 并返回成功，否则会破坏用户承诺的一键回滚能力。

### 整改

- reconcile 只有在受限 backup root 下找到真实 `dist` 备份时才允许成功；
- 必须存在 `snowluma-service.mjs`；
- backup `build-info.json` 必须包含合法 40 位 commit；
- 状态中的 `PREVIOUS_COMMIT` 若已知必须与 backup commit 一致；未知时由受验证 backup commit 补全；
- 找不到真实回滚点时 fail closed，不覆盖 latest rollback pointer；
- CI 锁定 `RECONCILE_ROLLBACK_STATE_MISSING` 与 backup commit mismatch 防线。

状态：`fixed_and_verified`

## FINAL-CI-001 — Medium — 浏览器验收门禁依赖系统 apt 安装导致环境型超时

### 问题

原工作流使用 `npx playwright install --with-deps chromium`，GitHub Hosted `ubuntu-24.04` 在 apt 镜像更新阶段卡满 20 分钟，真正的 Playwright 验收没有开始。

### 整改

- Node 保持固定 22；
- `@playwright/test` 固定 1.55.0；
- 改为 `npx playwright install chromium`，只获取 Playwright 对应浏览器 binary，不在每个 PR 门禁重新跑 apt；
- 修复后真实 Chromium 已成功执行 desktop/mobile/config-maturity 验收。

状态：`fixed_and_verified`

## 最终工程门禁结果

最终 PR head `35e069cf6e590480cfc57f58b2f8a5cfbc9f3136` 全部通过：

- GroupGuard CI `32279570278`: **success**；
- GroupGuard Build `32279570228`: **success**；
- WebUI Browser Acceptance `32279570212`: **success**。

最终 diff 复审未留下未处理 High/Critical finding。PR #42 随后以 merge commit `9427c6577439acf8987a208909fa8ae3e9c09e2d` 合并到 `main`。该 merge commit 与最终 PR head 具有相同 tree `bf6f5f2b8fc0ffc1c6cdaa8ad1a6f50dcff7e317`，因此合并没有改变已验证的代码/文档树。

## 发布边界

- 工程任务没有部署或重启 `192.168.3.89`；
- `main` 已包含本轮成熟化结果和一键更新/回滚工具；
- 剩余工作只有一轮人工生产验收：在 Windows 仓库根目录运行 `GROUPGUARD-UPDATE.cmd`；
- 如真实业务行为异常，运行 `ROLLBACK-GROUPGUARD.cmd`，只恢复插件代码，不替换 `config.json`、SQLite/data、日志或 secrets。
