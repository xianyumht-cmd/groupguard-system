# GroupGuard 当前任务交接

更新时间：2026-07-31 16:24 +08:00  
状态：`merged_and_deployment_package_v3_ready`

## 当前任务

```text
GFM-DELETE-002  群文件历史文件清理可靠性修复
```

PR #26 已通过 squash 合并到 `main`：

```text
5753808b10a653e8a7f7805ff7b16c6cc3161204
```

合并前 GroupGuard CI #320 和 Build #352 均通过。

## 部署尝试 1

完整 Windows worktree 因仓库中一个无关超长文件名失败。失败发生在构建和生产连接前，没有接触生产。

## 部署尝试 2

v2 sparse worktree 虽仍打印超长文件警告，但插件子目录成功检出，随后：

```text
npm ci                 passed
npm test               passed
build:snowluma         passed
node --check           passed
candidate manifest     passed
candidate SHA-256      f6bc5d602afbaf4a051a753ec323972e765bf6fa4359fb6ad09fc7a54c4a27fd
```

远程预检也实际完成，确认：

```text
container_status=running
container_restart_count=0
current_build_commit=600bf3ca678b76061733485efe6bc2b06ba648dd
target_commit=5753808b10a653e8a7f7805ff7b16c6cc3161204
current_node_check=passed
```

但 PowerShell 5.1 将 shell 脚本作为文本管道送入 ssh 时，在首行带入 UTF-8 BOM，并在末尾增加 CR。远程因此出现：

```text
bash: line 1: ﻿#!/usr/bin/env: No such file or directory
bash: line 46: $'\r': command not found
```

最终 preflight 以 127 退出。此时尚未上传候选、未提示 DEPLOY、未停止容器、未切换 dist。因此：

```text
production_stopped=false
production_dist_switched=false
production_modified=false
rollback_not_required=true
```

预检仅创建了独立空备份目录：

```text
/mnt/sda1/groupguard/backups/GFM-DELETE-002-20260731-161420-5753808b10a6
```

## 生产安全部署包 v3

```text
GroupGuard-GFM-DELETE-002-production-safe-deployment-kit-v3.zip
SHA-256: 062ee9eab4d55f2eb638df2ebf5a47df86fdafd5a22b3ef7590270ac52c724bb
入口: run-production-safe-deploy.cmd
目标提交: 5753808b10a653e8a7f7805ff7b16c6cc3161204
内置候选 SHA-256: f6bc5d602afbaf4a051a753ec323972e765bf6fa4359fb6ad09fc7a54c4a27fd
```

v3 不再执行 Git checkout 或 npm 重建，而是内置部署尝试 2 已完成完整测试和构建的不可变候选。运行时重新执行：

```text
候选归档 SHA-256
node --check
build-info commit/dirty/artifact
362 个 dist 文件的字节数与 SHA-256
```

远程脚本不再通过 PowerShell stdin 文本管道传输，改用 Base64 字节编码后由远端解码给 bash，规避 BOM 和 CRLF 污染。

生产安全边界不变：候选上传并核验后才提示 DEPLOY；只切换 dist；配置和 data 不覆盖；上线失败自动回滚；不会批量删除现有 5 个历史文件。

## Swap 与存储波动

用户报告设备运行数日后 Swap 使用约 2 GB、可用存储约 1.9 GB 并波动。目前不能仅凭总量认定 GroupGuard 内存泄漏。

值得注意的是，v2 预检显示 `/mnt/sda1/groupguard/app` 所在文件系统仍有约 42 GB 可用，而登录横幅显示约 1.9 GB 可用，二者很可能是不同文件系统。横幅更可能显示根分区；波动可能来自 Docker Root、容器日志、`/var/log` 或 `/tmp`，并不等同于 `/mnt/sda1` 应用目录耗尽。

v3 预检新增只读采集：

```text
主机 MemAvailable、SwapTotal/Used/Cached
GroupGuard 容器所有进程 RSS/Swap
根分区与 /mnt/sda1 应用分区容量
Docker Root 路径及总占用
GroupGuard 容器日志路径与大小
/app、backups、/var/log、/tmp 占用
```

不执行 `swapoff -a`、`drop_caches` 或任何系统清理。

## 当前状态

```text
main_merged=true
production_deployed=false
production_verified=false
production_container=running
current_production_commit=600bf3ca678b76061733485efe6bc2b06ba648dd
```

## 下一步

把 v3 解压到新目录，运行：

```text
run-production-safe-deploy.cmd
```

出现确认提示后输入：

```text
DEPLOY
```

完成后上传：

```text
reports\groupguard-gfm-delete-002-deployment-report-时间.zip
```

根据报告同时完成生产部署验收和第一份 Swap/磁盘来源基线判断。
