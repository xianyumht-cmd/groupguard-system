# 定向文件推送：生产落库与仓库整理交接（2026-08-09 00:17 +08:00）

> 本文是当前“定向文件推送验收后 -> 生产 lineage 落库 -> GitHub 仓库整理”任务的**新聊天权威交接**。新聊天若用户说“继续仓库整理 / 继续 lolapisevers”，直接从本文最后一节开始，不要重新排查已经验收通过的业务链路。

---

## 0. 当前总状态

定向文件推送功能已经完成真实 QQ 群文件端到端验收，业务问题已经结束；当前任务已切换为**源码化、主线收口和仓库整理**。

真实成功链路：

`蓝奏目录变化 -> LOLDataSystem 5001 -> 具体文件 share_link -> /api/lanz -> direct_url -> GroupGuard 6108 -> ARM 下载 -> GroupGuard/SnowLuma 跨容器共享 -> SnowLuma upload_group_file -> QQ 群文件`

最终实机证据：

- 5001 输出：`TARGET FILE DELIVERY SUCCEEDED.`
- pending：`0`
- `last_delivery_at = 2026-08-08T15:30:28.431876+00:00`
- 北京时间：`2026-08-08 23:30:28 +08:00`
- QQ 群实际看到文件：约 `23:31`
- 成功文件：`lErAsHvU.7z`
- QQ 显示：`15.79 MB`
- 用户已人工确认目标 QQ 群文件中真实存在。

**功能状态：ACCEPTED / 已实机验收。**

当前不要再重新排查 resolver、SnowLuma 版本或蓝奏接口；不要 rebaseline。

---

## 1. LOLDataSystem 当前 canonical production

仓库：`xianyumht-cmd/lolapisevers`

Windows 实际生产 HEAD：

`70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`

已安全保存到远程：

- canonical production branch：`production/current-20260808`
- acceptance tag：`production-accepted-20260808-2331`
- 两者都指向 `70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`

保存过程确认：

- 保存前 remote `master`：`f5c9f14ec61095dd47550b0d55562170551f935f`
- 保存后 remote `master`：仍为 `f5c9f14ec61095dd47550b0d55562170551f935f`
- 没有 force push
- 没有 checkout/reset/rebase/merge 生产工作树
- 本地 tracked working tree 当时为 clean

真实生产 first-parent lineage：

`dda1c27453eb3b4cf0b79a53ff043369f7662736`
` -> 7696b96dd9dcb935805563a5e38a77a2ffecabf8`
` -> 5c1ebf552479bf5ccd75435e2472b5a861430146`
` -> 8e97598348984faac0bbebe8bf3bfb3d749c0967`
` -> 2fd03796a82bfe7e835f9d5cbe3f8b00ffb83034`
` -> 1d666edaf8ef5db88df9bdaf861bbc1434895799`
` -> 70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`

提交含义：

- `7696b96...`：integrate target file push onto current LOLDataSystem
- `5c1ebf5...`：add 6178 target file watch operations page
- `8e97598...`：delivery 使用具体文件 share link
- `2fd0379...`：普通蓝奏改用 `/api/lanz`
- `1d666ed...`：service 层 pin 普通蓝奏 endpoint
- `70a38f1...`：delivery resolver 第二处 endpoint 也正式 pin `/api/lanz`

V4.3 关键源码：

- `services/target_file_watch_directory.py`
- SHA-256：`1b50803a1cdda3901006ecbe8d2ede5e736c5f9d8f16c2b314c1b513560835ac`
- runtime manifest aggregate：`010cf93628cb38db69a1a07caa3a4dd2e0e776f96d08966bf0103f754583baef`

---

## 2. 业务故障最终根因（不要再重复排查）

### 2.1 5001 resolver 根因

普通蓝奏具体文件 share link：

- `/api/lanzpro`：返回文件不存在/过期
- `/api/lanz`：正常返回 direct URL

共享 6178 WER 配置继续保留 `/api/lanzpro`；定向文件自己的 resolver 单独固定 `/api/lanz`。

V4.2 漏掉 `resolve_for_delivery()` 内第二处 provider config，因此 preflight PASS 但正式轮询仍失败；V4.3 修复后错误推进到 6108 callback，证明 5001 resolver 已修复。

### 2.2 GroupGuard / SnowLuma 根因

不是 SnowLuma v1.12.4 不支持群文件上传。

真实问题是两个 Docker 容器本地路径不共享：

- GroupGuard 在自己的 `/app/data/target-file-push-temp` 下载了 `.7z`
- SnowLuma 原来没有 `/app/data`
- `upload_group_file` 对该路径 `realpath()` 时直接 `ENOENT`

第二层权限问题：

- GroupGuard 下载文件原来最终仍为 `0600`
- SnowLuma 业务 UID 为 `1000`
- ARM runtime hotfix：下载 rename 成功后 `chmod(finalPath, 0o644)`

第三层：第一次 mount 设成 read-only，SnowLuma 启动会对挂载目录 `chown`，导致：

`Read-only file system -> SnowLuma restart loop -> onebot_ws_not_connected`

最终正确部署：

`/mnt/sda1/groupguard/app/data/target-file-push-temp`
` -> /app/data/target-file-push-temp`
` -> rw=true`

最终验证：SnowLuma `restart_count=0`、UID1000 可读、3001/5099 恢复，之后群文件成功上传。

---

## 3. SnowLuma / ARM 当前固定状态

SnowLuma：

- 版本：v1.12.4
- image ID：`sha256:51afea352a9d9332d4577b3d72268e1578dd82b9250512218c9e742c591f03d4`
- 不需要为本次问题升级
- target temp shared mount 必须 `rw=true`

当前保留回滚容器：

`snowluma-pre-target-share-20260808-224935`

关键 backup：

- `/mnt/sda1/groupguard/backups/target-file-shared-mount-rw-fix/20260808-232718`
- `/mnt/sda1/groupguard/backups/target-file-shared-path-fix/20260808-224935`

这些已经不是唯一源码备份，但在仓库主线完全收口前暂时不要删。

---

## 4. GroupGuard runtime hotfix 已正式源码化

仓库：`xianyumht-cmd/groupguard-system`

分支：`feat/target-file-push-20260807`

PR：`#37`，Draft / open

ARM runtime 的 `0644` 修复已经写回 TypeScript 源码：

- 文件：`onebot-plugin-groupguard/src/services/target_file_push_delivery.ts`
- 核心改动：download 完成 `rename(partPath, finalPath)` 后执行 `await fs.promises.chmod(finalPath, 0o644);`
- 源码化提交：`f983969a135ae553ac510ff7ab3efec542d6304f`

随后补充仓库整理交接文档后，该分支最新提交为：

`3b9f75581e8c96ecafeabc0713e0e1527f988ea2`

### GroupGuard Actions 最终结果

针对最新 head 的三套 GitHub Actions 已全部完成并成功：

- `GroupGuard Build` run #511：**success**
- `GroupGuard CI` run #479：**success**
- `WebUI Browser Acceptance` run #37：**success**

结论：

**GroupGuard 的 `0644` runtime hotfix 已完成源码化，并且 CI / Build / WebUI 验收均可重复通过。**

当前仍保持 PR #37 Draft，不急着直接 merge `main`；等 lolapisevers 主线收口方案确认后再一起决定。

---

## 5. lolapisevers 第一轮 PR 整理已完成

整理原则：

1. 已实机验收且只是 build/validation 的旧 PR 可以关闭；
2. 只关 PR，不删 head branch；
3. 仍有 unique commits 的 PR 暂不动；
4. 未完成任务继续放一边。

### 已关闭但分支保留

- PR #58：6178 target-file-watch UI 验证 PR；实际生产 integration commit `5c1ebf5...` 已验收。
- PR #59：`[DO NOT MERGE]` 生产基线验证 PR。
- PR #60：`[DO NOT MERGE]` build-only V3 artifact PR。
- PR #61：`[DO NOT MERGE]` current-history direct URL 验证 PR。
- PR #62：`[DO NOT MERGE]` current-history build-only PR。
- PR #39：head `d1500c17c08dad287c76b9e1763037860eccc567` 已确认是 current production 的真实祖先，compare 为 `ahead_by=163 / behind_by=0`，没有 production 缺失的 branch-only commit，因此按“已被生产线吸收”关闭。

这些 PR 的 head branch **目前都没有删除**。

### 仍保留 / 暂不动

- PR #57：定向文件正式功能 PR，与 canonical production 历史分叉，暂保留。
- PR #41：相对 production 仍有 `15` 个 branch-only commits。
- PR #34：仍有 `4` 个 branch-only commits。
- PR #32：仍有 `2` 个 branch-only commits。
- PR #26：仍有 `1` 个 branch-only commit。

这些不能在没有明确去向前删除。

---

## 6. master 分叉已经查明：4 个独有提交净内容为 0

`master = f5c9f14ec61095dd47550b0d55562170551f935f`

`production/current-20260808 = 70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`

两者 merge-base：

`aaeeae4b33f54b1e4b0f6c163088a9ff67114e07`

最初 compare：

- production 相对 master：ahead `216`
- production 相对 master：behind `4`

已继续审计 master-only 4 commits：

- `d8ac6d13854bdb573af0a60bc27c13a916151fa4`
- `fc54e6270914273799135821b4728240e0f42e64`
- `2171797b6517532fa7959828f5242159ed528a66`
- `f5c9f14ec61095dd47550b0d55562170551f935f`

它们本质是两次误创建空 handoff 文件，然后又分别删除。

进一步 compare：

`aaeeae4... -> master`

结果：

- ahead_by = 4
- **files = []**
- 即净文件树变化为 0

因此：

**master 与 production 的主要分叉是 Git 历史噪音，不是 4 个独立业务改动。**

这为“不 force、不重写历史”的正规收口提供了条件。

---

## 7. 已建立 master 正规收口入口：PR #63

已从验收 production head 创建：

`integration/reconcile-production-master-20260809`

该 branch 当前指向：

`70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`

已创建 Draft PR：

**PR #63：`chore: reconcile accepted production history back into master`**

- base：`master`
- head：`integration/reconcile-production-master-20260809`
- head SHA：`70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`
- GitHub 重新计算后 `mergeable=true`
- 当前保持 Draft
- 尚未 merge
- master 尚未改动

PR #63 的目的：

- 用普通 Git merge 保留 master 那 4 个历史提交；
- 把已验收 production 的真实历史正规接回 master；
- 不 force push、不 reset master、不改 production ref。

---

## 8. PR #63 GitHub Actions 已全部跑完：3 成功、1 失败

用户已说明 Actions 跑完，现已通过 GitHub 再次核对真实结果。

### 成功

- `tests` run #584：**success**
- `LAPI Parser Center CI` run #282：**success**
- `Build production safe deployment package V3` run #111：**success**

说明：

- 当前 production 代码基础测试通过；
- Parser Center CI 通过；
- 当前 V3 生产安全打包链通过。

### 失败

旧 workflow：

`Build production safe deployment package` run #124：**failure**

失败 job：

`build-package`

失败 step：

`Validate deployment safety invariants`

准确错误：

`Expected four deployment scripts.`

对应 workflow 逻辑：

- 它执行 `Get-ChildItem ops -Filter "*FullBugRepair*.ps1" -File`
- 然后硬编码要求 `$scripts.Count -eq 4`
- 当前仓库已经出现更多同类部署脚本，因此旧门禁因为“脚本数量不再恰好 4”而主动失败
- 后续 immutable worktree / dependency / candidate tests / package steps全部因此被 skip

另外，该旧 workflow 的日志里 `TARGET_COMMIT` 仍显示旧值：

`a28483eadb25986031d11ca40e0d26aa6f9e6dfa`

因此这条 workflow 明显属于旧 production-safe packaging 链的一部分，需要单独审计其“固定脚本数量”和 target commit 策略。

重要结论：

**这不是当前已验收 production 功能测试失败，也不是 PR #63 merge 冲突；是旧打包 workflow 自己的陈旧 safety invariant 失败。**

但是在该检查未处理前，**不要直接 merge PR #63**。

---

## 9. 当前明确禁止事项

- 不要 rebaseline。
- 不要再改 V4.3 resolver。
- 不要把定向文件 endpoint 改回 `/api/lanzpro`。
- 不要为了本任务升级 SnowLuma。
- 不要把 target temp mount 改回 read-only。
- 不要 force push `master`。
- 不要 reset/rebase `production/current-20260808`。
- 不要删除 `production/current-20260808` 或 acceptance tag。
- 不要删除仍有 unique commits 的 PR / branch。
- 不要因为 #63 只有一个旧 workflow 失败就直接忽略检查并 merge。
- 暂时不要删除 SnowLuma 回滚容器和关键 ARM backup。

---

## 10. 新聊天继续时的第一优先级

用户新聊天如果说：

`继续仓库整理`

直接执行以下顺序，不需要重新询问上下文：

### 第一步：处理 PR #63 唯一失败的旧 workflow

目标：

`Build production safe deployment package` run #124

先审计 workflow / builder 为什么仍要求：

`Expected four deployment scripts.`

以及为什么该 workflow 使用：

`TARGET_COMMIT=a28483eadb25986031d11ca40e0d26aa6f9e6dfa`

处理原则：

1. 先区分它是仍需要维护的旧安全部署链，还是已经被 V3 workflow 取代的 legacy gate；
2. 如果仍需要：修成按明确允许脚本名单/必要 marker 验证，而不是脆弱地要求 `Count == 4`；同时修正 target commit 语义；
3. 如果已被 V3 完整取代：不要草率删除，先确认 branch protection / required checks / 历史用途，再正式退休或改为兼容 wrapper；
4. 修改只应发生在 integration/reconciliation 相关安全分支，不动已验收 `production/current-20260808`；
5. 重新跑 #63 checks，要求该 PR 的预期 required checks 全部通过。

### 第二步：#63 全部预期检查通过后再决定 merge

如果最终检查全部可接受：

- 再审查 PR #63 diff / merge commit；
- 保持普通 merge，不 squash production 历史；
- 不 force；
- merge 后确认 master 同时包含原 master 历史和 `70a38f...` production lineage；
- 再比较 master / production 是否收口。

### 第三步：主线收口后再处理剩余旧 PR

优先重新判断：

- #57 是否已被新 master 完整吸收，若是则关闭但先不删 branch；
- #41 / #34 / #32 / #26 的 unique commits 分别属于“未完成工作”“仅构建器”“可归档”还是需要迁移；
- 只有证明无 unique work 或 unique work 已被保存后才删 branch。

### 第四步：最后再做 branch 大清理

目前远程还有大量：

- `build/*`
- `tmp-*`
- `*-ignore`
- 历史 release / automation / codex 分支

不要按名字直接批量删。应先用 ancestry/compare 分类：

- canonical / production / active
- 已完全包含
- 有 unique commits
- build-only / disposable
- accidental / empty-history

确认后分批删除。

---

## 11. 新聊天一句话上下文

**定向文件推送已在 2026-08-08 23:31 实机成功；LOLDataSystem canonical production 已保存为 `production/current-20260808@70a38f1` 和 tag `production-accepted-20260808-2331`；GroupGuard `chmod 0644` 已源码化且 Build/CI/WebUI 三套 Actions 全绿；lolapisevers 已关闭 #58-#62/#39，剩余 unique-work PR 暂留；已建 Draft PR #63 把 production 正规接回 master，#63 当前 tests/Parser/V3 build 成功，唯独旧 `Build production safe deployment package` 因硬编码 `Expected four deployment scripts.` 失败；下一步先修/退休这个旧 workflow gate，PR #63 暂不 merge。**
