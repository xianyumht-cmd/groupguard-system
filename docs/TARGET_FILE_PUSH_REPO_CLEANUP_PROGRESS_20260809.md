# 定向文件推送：生产落库与仓库整理进度（2026-08-09）

> 本文是 `TARGET_FILE_PUSH_HANDOFF_20260808.md` 的后续补充，记录功能验收之后的生产 lineage 落库、GroupGuard runtime 修复源码化，以及第一轮 GitHub PR 整理结果。

## 1. 功能验收状态

定向文件推送已完成真实端到端实机验收：

`蓝奏目录 -> LOLDataSystem 5001 -> /api/lanz direct_url -> GroupGuard 6108 -> ARM 临时下载 -> SnowLuma upload_group_file -> QQ 群文件`

最终成功证据：

- 5001：`TARGET FILE DELIVERY SUCCEEDED.`
- pending：`0`
- `last_delivery_at = 2026-08-08T15:30:28.431876+00:00`
- QQ 群实际收到时间：约 `2026-08-08 23:31 +08:00`
- 成功文件：`lErAsHvU.7z`
- QQ 显示大小：`15.79 MB`

功能状态：**ACCEPTED / 已实机验收**。

## 2. LOLDataSystem canonical production 已保存

仓库：`xianyumht-cmd/lolapisevers`

真实生产 HEAD：

`70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`

已创建远程 canonical production branch：

`production/current-20260808`

已创建验收 tag：

`production-accepted-20260808-2331`

两者均指向：

`70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`

保存过程确认：

- `master` 保存前：`f5c9f14ec61095dd47550b0d55562170551f935f`
- `master` 保存后：仍为 `f5c9f14ec61095dd47550b0d55562170551f935f`
- 未 force push
- 未 checkout/reset/rebase/merge
- 本地 production working tree 未改动

生产 first-parent chain：

`dda1c27453eb3b4cf0b79a53ff043369f7662736`
` -> 7696b96dd9dcb935805563a5e38a77a2ffecabf8`
` -> 5c1ebf552479bf5ccd75435e2472b5a861430146`
` -> 8e97598348984faac0bbebe8bf3bfb3d749c0967`
` -> 2fd03796a82bfe7e835f9d5cbe3f8b00ffb83034`
` -> 1d666edaf8ef5db88df9bdaf861bbc1434895799`
` -> 70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`

## 3. production 与 master 的关系

GitHub compare：

`master -> production/current-20260808`

结果：

- status：`diverged`
- production `ahead_by = 216`
- production `behind_by = 4`
- merge base：`aaeeae4b33f54b1e4b0f6c163088a9ff67114e07`

因此：

**禁止直接把 production merge 到 master，也禁止把 master 强制移动到 production。**

后续需要单独做“生产线与 master 正规归并/重建”任务，逐项审计 master 独有 4 个提交及 production 大量生产提交。

## 4. 第一轮 lolapisevers PR 整理

整理原则：

1. 已实机验收且 PR 原本仅用于 build/validation 的，关闭 PR；
2. 只关闭 PR，不删除分支；
3. 仍有 unique commits 的 PR 保留；
4. 未完成项目继续放一边。

### 已关闭

- PR #58：6178 target file watch UI 验证 PR；真实生产 integration commit 为 `5c1ebf552479bf5ccd75435e2472b5a861430146`，已随完整链路实机验收。
- PR #59：`[DO NOT MERGE]` 生产基线验证 PR。
- PR #60：`[DO NOT MERGE]` build-only V3 artifact PR。
- PR #61：`[DO NOT MERGE]` current-history direct URL 验证 PR。
- PR #62：`[DO NOT MERGE]` current-history build-only PR。
- PR #39：head `d1500c17c08dad287c76b9e1763037860eccc567` 已确认是当前 production 的真实祖先；compare 结果 `ahead_by=163, behind_by=0`，无 PR 独有而 production 缺失的提交，因此按“已被生产线完整吸收”关闭。

上述 head 分支目前全部保留，未删除。

### 保留 / 暂不动

- PR #57：定向文件正式功能 PR。与 canonical production 历史分叉，保留作为后续 production/master 正规归并入口。
- PR #41：compare 到 production 仍有 `15` 个 branch-only commits，不能关闭/删除。
- PR #34：仍有 `4` 个 branch-only commits，保留。
- PR #32：仍有 `2` 个 branch-only commits，保留。
- PR #26：仍有 `1` 个 branch-only commit，保留。

当前开放 PR 已由 11 个减少到 5 个，且剩余 5 个均有明确保留原因。

## 5. GroupGuard runtime hotfix 已源码化

仓库：`xianyumht-cmd/groupguard-system`

分支：`feat/target-file-push-20260807`

PR：`#37` Draft/open

ARM 生产现场为了跨容器上传，曾对 runtime 增加：

`await fs.promises.chmod(finalPath, 0o644);`

原因：GroupGuard 下载文件最初为 `0600`，SnowLuma 业务 UID `1000` 无法读取。

该修复现已正式写回 TypeScript 源码：

- 文件：`onebot-plugin-groupguard/src/services/target_file_push_delivery.ts`
- commit：`f983969a135ae553ac510ff7ab3efec542d6304f`
- commit message：`fix(target-file): make downloaded files readable across containers`

因此以后重新 build GroupGuard 时不会再退回仅 root 可读的最终下载文件。

## 6. SnowLuma Docker 部署固定要求

当前 SnowLuma：v1.12.4，不升级。

GroupGuard 宿主目录：

`/mnt/sda1/groupguard/app/data/target-file-push-temp`

SnowLuma 内必须挂载到：

`/app/data/target-file-push-temp`

并且必须：

`rw=true`

不能使用 read-only。原因：SnowLuma 启动脚本会对挂载目录执行 `chown`；RO bind 会产生：

`chown: ... Read-only file system`

并导致 SnowLuma restart loop，继而 GroupGuard 报：

`onebot_ws_not_connected:upload_group_file`

最终已验证 RW mount：

- SnowLuma `running=true`
- `restart_count=0`
- UID1000 可读取 `.7z`
- 3001 / 5099 恢复
- QQ 群文件上传成功

## 7. 当前回滚资产

保留的 SnowLuma 原始回滚容器：

`snowluma-pre-target-share-20260808-224935`

关键 backup：

- `/mnt/sda1/groupguard/backups/target-file-shared-mount-rw-fix/20260808-232718`
- `/mnt/sda1/groupguard/backups/target-file-shared-path-fix/20260808-224935`

生产 lineage 已经安全落库，因此这些资产不再是“唯一源码备份”，但在完成 GroupGuard 新源码 build 验证之前仍建议保留。

## 8. 下一步

当前应该继续的顺序：

1. 对 GroupGuard commit `f983969...` 跑对应测试/build，确认源码化 hotfix 可重复构建；
2. 保持 PR #37 Draft，暂不直接 merge main；
3. lolapisevers 进入剩余 5 个开放 PR 的分类整理；
4. 优先处理 `production/current-20260808` 与 `master` 的 4 个 master-only commits，决定正规 canonical 主线策略；
5. 在未确认 unique commits 去向前，不删除任何 branch；
6. 不 rebaseline，不改 5001 当前生产运行态。
