# 定向文件推送任务交接（2026-08-08 23:34 +08:00）

> 本文是当前任务的权威交接基线。此前“首次新增文件真实投递测试尚未执行”的状态已过时。2026-08-08 23:31 已完成真实 QQ 群文件投递并实机验收。

## 0. 当前结论 / 验收状态

本任务已经完成真实端到端验收：

`蓝奏目录变化 -> LOLDataSystem 5001 检测 -> 具体文件 share_link -> /api/lanz 解析 direct_url -> GroupGuard 6108 callback -> ARM 下载文件 -> GroupGuard/SnowLuma 跨容器共享 -> SnowLuma upload_group_file -> QQ 群文件成功`

最终实机证据：

- 5001 最终输出：`TARGET FILE DELIVERY SUCCEEDED.`
- 5001 pending：`0`
- `last_delivery_at = 2026-08-08T15:30:28.431876+00:00`
- 对应北京时间：`2026-08-08 23:30:28 +08:00`
- QQ 群中实际看到文件时间：约 `23:31`
- 实际成功文件：`lErAsHvU.7z`
- QQ 客户端显示大小：`15.79 MB`
- 用户已人工确认文件真实出现在目标 QQ 群文件中。

**功能状态：已完成、已实机验收。**

当前不要 rebaseline，不要再修改 resolver，不要升级 SnowLuma。

下一阶段已经切换为：

1. 把真实生产 lineage 安全保存到 GitHub；
2. 把 GroupGuard 运行时 hotfix 还原为可追踪源码提交；
3. 再整理 `lolapisevers` 的分支 / PR / 旧代码；
4. 未确认有唯一工作的分支不得删除。

---

## 1. 固定业务目标与语义

目标链路：

`指定蓝奏目录 -> LOLDataSystem 5001 检测目录变化 -> 解析具体文件直链 -> callback GroupGuard 6108 -> ARM 临时下载 -> SnowLuma QQ 原生群文件上传`

固定业务目标：

- 蓝奏目录：`https://wwbvf.lanzn.com/b016kzvvmd`
- QQ 群：`960957757`
- GroupGuard WebUI / callback：`192.168.3.89:6108`
- LOLDataSystem 5001：Windows `192.168.3.100:5001`，本机 `127.0.0.1:5001`
- LOLDataSystem 管理 WebUI：Windows 本机 `127.0.0.1:6178`
- 正常检查间隔：`300` 秒

必须保持：

1. 第一次启用只建立 baseline，不上传历史文件。
2. 后续新增文件逐个上传。
3. 同名替换也必须识别新版本。
4. 仅删除蓝奏文件时不往 QQ 群发内容。
5. callback / 上传失败不能推进 baseline。
6. 空上游快照不能覆盖正常非空 baseline。
7. 先成功上传新群文件，再处理旧群文件删除。
8. 旧群文件删除失败不得让新上传失败；进入 `pendingCleanup` 后续补删。
9. 本地临时文件只在确认上传成功后清理；失败必须保留取证。
10. completed eventId 持久化去重。

---

## 2. 组件职责

### LOLDataSystem 5001

负责：

- 蓝奏目录检测
- baseline / pending / eventId
- 找到变化后的具体文件 `share_link`
- 为具体文件解析 fresh `direct_url`
- callback GroupGuard 6108
- callback 成功后才推进 baseline / 清 pending / 更新 last_delivery_at

### LOLDataSystem 6178

职责是监控与诊断，不是第二套业务配置中心。

页面：`http://127.0.0.1:6178/target-file-watch`

负责展示：

- enabled / loop 状态
- baseline / pending
- source URL / interval
- callback 是否配置
- 最近检查 / 成功 / 投递 / event
- 运维动作：立即检查 / rebaseline

**生产已稳定后不要随意点 rebaseline。**

### GroupGuard 6108

唯一业务配置中心，并负责：

- 接收 5001 callback
- 下载具体 direct_url 到 `/app/data/target-file-push-temp`
- 调用 `HostProfile.uploadGroupFile()`
- 成功后保存最新 QQ 群文件 fileId
- 再清理上一份 QQ 群文件
- 维护 `target-file-push-state.json` / `target-file-push-target-state.json`

### SnowLuma

负责 OneBot / QQ 原生群文件动作 `upload_group_file`。

当前继续使用 **v1.12.4**；本次故障不是 SnowLuma v1.12.4 不支持群文件上传。

---

## 3. LOLDataSystem 生产 lineage

远程原基线：

- Branch：`baseline/production-dda1c-20260808`
- Commit：`dda1c27453eb3b4cf0b79a53ff043369f7662736`

本机真实生产提交链：

`dda1c27453eb3b4cf0b79a53ff043369f7662736`
` -> 7696b96dd9dcb935805563a5e38a77a2ffecabf8`
` -> 5c1ebf552479bf5ccd75435e2472b5a861430146`
` -> 8e97598348984faac0bbebe8bf3bfb3d749c0967`
` -> 2fd03796a82bfe7e835f9d5cbe3f8b00ffb83034`
` -> 1d666edaf8ef5db88df9bdaf861bbc1434895799`
` -> 70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`

提交含义：

- `7696b96...`：`deploy: integrate target file push onto current LOLDataSystem`
- `5c1ebf5...`：`deploy: add 6178 target file watch operations page`
- `8e97598...`：`fix(target-file): resolve concrete share link for delivery`
- `2fd0379...`：`fix(target-file): use ordinary Lanzou WER endpoint`
- `1d666ed...`：`fix(target-file): pin ordinary Lanzou endpoint in service`
- `70a38f1...`：`fix(target-file): pin Lanzou endpoint in delivery resolver`

当前生产 HEAD：

`70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`

V4.3 关键生产源码：

- `services/target_file_watch_directory.py`
- V4.3 源码 SHA-256：`1b50803a1cdda3901006ecbe8d2ede5e736c5f9d8f16c2b314c1b513560835ac`
- V4.3 后 runtime manifest aggregate：`010cf93628cb38db69a1a07caa3a4dd2e0e776f96d08966bf0103f754583baef`

**截至验收时这些 post-dda1c 生产提交尚未安全推到远程 canonical production ref。下一步必须先保存这条真实 lineage，禁止 force push master。**

---

## 4. 5001 直链问题完整根因

### 4.1 原始问题

定向文件目录检测能发现变化，但 delivery 阶段没有为“具体 pending 文件”解析直链。

最初修复让 `resolve_for_delivery()` 使用 `metadata.share_link`，而不是目录 `source_url`。

### 4.2 WER endpoint 区别

只读实测同一个普通蓝奏文件 share_link：

- `https://api2.wer.plus/api/lanzpro` -> `code=201`，提示文件不存在/过期
- `https://api2.wer.plus/api/lanz` -> `code=200`，返回真实 `data.url`
- 真实 direct host：`zip1.webgetstore.com`

因此：

- 共享 6178 WER 配置仍保持 `/api/lanzpro`
- **定向文件 delivery 单独固定使用 `/api/lanz`**
- 不要为了定向文件去改共享 6178 WER 配置

### 4.3 V4.2 为什么预检通过、正式轮询仍失败

V4.2 的 `resolve_snapshot()` 已 pin `/api/lanz`，但漏掉了 `resolve_for_delivery()` 内第二处 `load_lanzou_provider_config()`。

导致：

- 手工 preflight 用 `/api/lanz`：PASS
- 正式 delivery 仍继承共享 `/api/lanzpro`：失败

V4.3 在 `resolve_for_delivery()` 也加入：

`replace(load_lanzou_provider_config(), wer_api_endpoint=TARGET_FILE_DIRECT_WER_ENDPOINT)`

V4.3 live preflight 使用真正 candidate `DirectoryLanzouResolver.resolve_for_delivery()`，并故意把环境变量污染成 `/api/lanzpro`，候选仍正确使用 `/api/lanz`，direct host 为 `zip1.webgetstore.com`。

V4.3 安装后错误成功从“未取得可下载直链”推进到：

`GroupGuard 回调失败 HTTP 502`

这证明 5001 resolver 已修复。

---

## 5. GroupGuard / SnowLuma 跨容器问题完整根因

### 5.1 第一层：路径只存在于 GroupGuard 容器

最早 6108/SnowLuma 日志：

`upload_group_file failed: ENOENT: no such file or directory, realpath '/app/data/target-file-push-temp/...7z'`

取证发现：

#### `groupguard-snowluma`

- image：`node:22-bookworm-slim`
- network：host
- bind：`/mnt/sda1/groupguard/app -> /app`
- `/app/data/target-file-push-temp` 存在
- 失败的 `.7z` 实际都已下载完成

#### `snowluma`

- v1.12.4
- image ID：`sha256:51afea352a9d9332d4577b3d72268e1578dd82b9250512218c9e742c591f03d4`
- 原本没有 `/app/data`
- 只有：
  - `snowluma-data:/app/snowluma-data`
  - `snowluma-qq-config:/app/.config`
  - `snowluma-qq-data:/app/.local/share`

所以 GroupGuard 把自己的容器路径传给 SnowLuma 后，SnowLuma 根本看不到该文件。

### 5.2 第二层：文件权限

GroupGuard 源码 `downloadTargetFile()` 原先：

`fs.promises.open(partPath, 'w', 0o600)`

rename 后最终 `.7z` 仍是 `0600`，而 SnowLuma 业务 UID 为 `1000`。

生产 runtime hotfix 在 rename 完成后增加：

`chmod(finalPath, 0o644)`

并把已有失败 `.7z` 改成 `0644`。

**注意：这是目前 ARM runtime 的生产 hotfix。GroupGuard GitHub 源码必须在下一阶段同步这个修改，否则以后 rebuild 会丢失。**

### 5.3 第三层：只读共享挂载导致 SnowLuma 重启循环

第一次共享修复把：

`/mnt/sda1/groupguard/app/data/target-file-push-temp`

挂到 SnowLuma：

`/app/data/target-file-push-temp`

并设为只读。

UID1000 读取测试当时通过，但 SnowLuma 启动脚本会递归 `chown` 新挂载路径，因此日志持续出现：

`chown: changing ownership of '/app/data/target-file-push-temp/...': Read-only file system`

随后 SnowLuma 进入 restart loop。

GroupGuard 对应错误变为：

`snowluma_upload_group_file_failed:onebot_ws_not_connected:upload_group_file`

说明此时请求甚至没有进入 QQ OIDB / Highway 上传层。

### 5.4 最终修复

V4 把同一共享目录从只读改为可写：

`/mnt/sda1/groupguard/app/data/target-file-push-temp`
` -> /app/data/target-file-push-temp`
` -> rw=true`

保持：

- SnowLuma v1.12.4 不升级
- exact image ID 不变
- 不执行 docker pull
- 3 个原 named volume 不变
- 3000 / 3001 / 5099 / 5900 / 6081 端口不变
- `SYS_PTRACE`、`seccomp=unconfined`、1G shm 等参数不变

验证结果：

- SnowLuma `running=true`
- `restart_count=0`
- shared mount `rw=true`
- UID1000 能读取当前 `.7z`
- 3001 / 5099 恢复
- GroupGuard 6108 能重新连接 OneBot
- 之后正常 pending 自动重试最终成功上传 QQ 群文件

因此最终故障归类：

**GroupGuard ↔ SnowLuma 双容器部署集成层的本地路径共享 / 权限设计问题，不是 SnowLuma v1.12.4 群文件功能缺陷。**

---

## 6. SnowLuma 版本结论

已核对 SnowLuma 官方 GitHub release / commit 历史。

结论：

- v1.12.4 已实现 `upload_group_file`
- SnowLuma 历史上确实修过“群文件上传成功但群里看不到”等问题，但关键修复早于 v1.12.4
- 本次现场错误发生在本地路径 realpath / 容器启动 chown / OneBot WS 连接层，并非新版 changelog 所描述的群文件协议修复
- 当前不应为了本问题升级 SnowLuma

生产保持 v1.12.4。

---

## 7. 当前 ARM / 回滚状态

当前 SnowLuma：

- 容器：`snowluma`
- v1.12.4
- image ID：`sha256:51afea352a9d9332d4577b3d72268e1578dd82b9250512218c9e742c591f03d4`
- shared target temp：`rw=true`

当前 GroupGuard：

- 容器：`groupguard-snowluma`
- `/app` bind：`/mnt/sda1/groupguard/app`
- 下载完成文件 runtime 已补 `0644`

保留的 SnowLuma 回滚容器：

`snowluma-pre-target-share-20260808-224935`

当前 V4 safety backup：

`/mnt/sda1/groupguard/backups/target-file-shared-mount-rw-fix/20260808-232718`

更早共享修复 backup：

`/mnt/sda1/groupguard/backups/target-file-shared-path-fix/20260808-224935`

**在 GitHub 生产基线落库前，不要删除回滚容器和这些 backup。**

---

## 8. GroupGuard GitHub 状态

Repo：`xianyumht-cmd/groupguard-system`

Branch：`feat/target-file-push-20260807`

PR：`#37` Draft/open/unmerged

此前生产功能提交基线：

`6d9e6fc3f95db3dc1c1e5fff2ae28b7e47e71d2d`

当前 PR head 在此之后仍有文档/后续提交；生产 ARM dist 并不等同于“直接 checkout PR head”，因为本次又对 runtime 加了 `chmod 0644` hotfix，并单独调整了 SnowLuma Docker mount。

下一阶段必须：

1. 把 `target_file_push_delivery.ts` 的成功下载后 `chmod(finalPath, 0o644)` 正式提交到 GitHub feature branch；
2. 在部署/交接文档里固定 SnowLuma target temp mount 必须为 RW，不能 RO；
3. 通过测试 / build 后，才能认为 GroupGuard 生产 runtime hotfix 已完全源码化。

---

## 9. 验收结果

最终自动观察输出：

- `TARGET FILE DELIVERY SUCCEEDED.`
- `Pending: 0`
- `Last delivery at: 2026-08-08T15:30:28.431876+00:00`
- `FIX COMPLETED AND DELIVERY STATE ADVANCED.`
- Exit code：`0`

用户 QQ 客户端实机：

- 约 `23:31` 出现 `lErAsHvU.7z`
- 大小 `15.79 MB`
- 确认属于目标群文件上传

因此本功能可以正式标记：

**ACCEPTED / 已验收。**

---

## 10. 下一步：保存真实生产 lineage，然后整理仓库

### 10.1 LOLDataSystem

当前最优先动作：

- 从 Windows 本地真实 production HEAD `70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`
- 创建新的 canonical production branch，例如：`production/current-20260808`
- 直接 push 当前真实 commit chain 到该新 branch
- **禁止 force push**
- **禁止直接覆盖 remote master**
- push 后用 GitHub compare 验证 `baseline/production-dda1c-20260808 -> production/current-20260808`

只有 production ref 保存成功以后，才开始清理旧 branch / PR。

### 10.2 GroupGuard

把 runtime 的 `0644` 修复写回源码，并把 RW mount 要求写进可追踪部署说明。

### 10.3 仓库整理

之后再做：

- 比较 remote master / canonical production / active PRs
- 标记已完成 / 未完成 / 仅审计 / 实验分支
- 不删除含 unique commits 的分支
- 先整理已经验收的仓库，未完成项目放一边

---

## 11. 当前禁止事项

- 不要 rebaseline
- 不要回滚 V4.3 resolver
- 不要再改共享 6178 WER endpoint
- 不要把定向文件 endpoint 改回 `/api/lanzpro`
- 不要更新 SnowLuma 来“修复”本次问题
- 不要把 target temp mount 再改成 read-only
- 不要删除 `snowluma-pre-target-share-20260808-224935`
- 不要删除 safety backups
- 不要 force push GitHub master
- 不要在真实生产 lineage 保存前做大范围 reset/rebase/branch cleanup
- 不要在聊天中回显任何 Token / 密码

---

## 12. 新聊天继续时直接理解为

用户如果说“继续定向文件推送 / 继续仓库整理”，直接理解为：

- 定向文件功能已经真实 QQ 群上传成功并验收
- LOLDataSystem 当前生产 HEAD 是 `70a38f1634c9cd07ee95c41b8fb5d35f1531af1c`
- SnowLuma v1.12.4 保持不变
- GroupGuard 与 SnowLuma target temp 必须 RW 共享
- GroupGuard runtime 已有 `chmod 0644` hotfix，但源码还需要正式同步
- 当前第一优先级不是继续调业务，而是保存真实 production lineage 到 GitHub
- production ref 保存后，再开始仓库结构 / 分支 / PR 清理
