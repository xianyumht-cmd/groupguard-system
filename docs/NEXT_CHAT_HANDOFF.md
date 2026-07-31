# GroupGuard 当前任务交接

更新时间：2026-07-31 16:04 +08:00  
状态：`merged_and_deployment_package_v2_ready`

当前任务：

```text
GFM-DELETE-002  群文件历史文件清理可靠性修复
```

## 已完成

PR #26 已通过 squash 合并到 `main`：

```text
5753808b10a653e8a7f7805ff7b16c6cc3161204
fix(gfm): verify old file deletion before clearing pending cleanup (#26)
```

合并前验证：

```text
GroupGuard CI #320    success
GroupGuard Build #352 success
```

修复行为：始终执行旧文件删除；随后在 0ms、1500ms、5000ms 读取文件列表；只有最后连续两次均为 `absent` 才清除 pending。`present`、`unknown` 或列表不稳定时继续保留待清理记录并写入错误状态。

## 首次部署尝试结果

首次部署包在本地第 1/7 步失败：

```text
Create detached build worktree
Filename too long
```

原因是完整 Windows worktree 尝试检出仓库中一个与 GroupGuard 构建无关的超长路径。失败发生在候选依赖安装、SSH、上传和生产停止之前，因此：

```text
production_contacted=false
production_stopped=false
production_modified=false
```

不需要执行回滚。

## 修复后的生产安全部署包 v2

```text
GroupGuard-GFM-DELETE-002-production-safe-deployment-kit-v2.zip
SHA-256: d27a530e5fee8484e8f877c65353bc1cf90d5a312264078aff07e6c0f13d141f
入口: run-production-safe-deploy.cmd
目标提交: 5753808b10a653e8a7f7805ff7b16c6cc3161204
```

v2 改为：

1. 创建 `--no-checkout` detached worktree；
2. 启用 cone sparse checkout；
3. 仅检出 `onebot-plugin-groupguard`；
4. 清理本部署临时路径可能遗留的失效 worktree 元数据；
5. 不修改用户当前工作区。

其余安全流程保持不变：停止生产前完成依赖安装、完整测试和 SnowLuma 构建；候选上传并校验后才进入切换；上线检查失败自动恢复旧 `dist`。

## 资源占用新增关注项

用户观察到设备运行数日后：

```text
可用内存约 699 MB
swap 使用约 2034 MB / 79.5%
可用存储约 1968 MB 且存在波动
```

单次摘要不能证明 GroupGuard 内存泄漏。Linux 可能把长期不活跃页面留在 swap，即使后来已有可用内存；存储波动也可能来自 Docker 日志、overlay、缓存、备份或临时文件。后续需要只读采集：

```text
容器与进程 RSS/PSS/Swap
/proc/*/smaps_rollup
Docker 日志大小和增长率
/app、Docker root、备份与临时目录占用趋势
内存和 swap 的时间序列
```

在未取证前不要执行 `swapoff -a`，避免低内存设备发生 OOM。

## 当前状态

```text
main_merged=true
production_deployed=false
production_verified=false
```

## 下一步

把 v2 解压到新目录，运行：

```text
run-production-safe-deploy.cmd
```

脚本要求确认时输入：

```text
DEPLOY
```

部署结束后上传：

```text
reports\groupguard-gfm-delete-002-deployment-report-时间.zip
```

生产验收完成后，再进入内存、交换区和存储的只读趋势诊断。存量 5 个历史文件继续作为单独任务处理。
