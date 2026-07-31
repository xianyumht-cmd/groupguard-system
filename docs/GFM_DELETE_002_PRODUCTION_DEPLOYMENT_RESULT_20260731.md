# GFM-DELETE-002 生产部署结果

时间：2026-07-31 17:17-17:20 +08:00  
状态：`production_deployed_and_verified`

## 部署目标

```text
PR: #26
Target commit: 5753808b10a653e8a7f7805ff7b16c6cc3161204
Container: groupguard-snowluma
Remote app: /mnt/sda1/groupguard/app
```

## 候选校验

```text
Candidate SHA-256: f6bc5d602afbaf4a051a753ec323972e765bf6fa4359fb6ad09fc7a54c4a27fd
Candidate files: 362
node --check: passed
Embedded manifest: verified
```

候选产物来自已完成完整 `npm test` 与 `build:snowluma` 的构建结果。

## 生产切换

```text
Backup: /mnt/sda1/groupguard/backups/GFM-DELETE-002-20260731-171753-5753808b10a6
Container stopped once: true
Dist switched: true
Container started: true
Automatic rollback triggered: false
```

上线后：

```text
active_build_commit=5753808b10a653e8a7f7805ff7b16c6cc3161204
active_entry_sha256=f224225ec467ecf03133b66a1d2f1361d82936b6f1a942248bc735a04372293d
container_status=running
container_restart_count=0
DEPLOYMENT_RESULT=success
```

配置和数据未被覆盖，现有历史群文件未被批量删除。

## 资源快照

切换前：

```text
host_mem_available_kb=764148
host_swap_used_kb=552872
container_rss_kb=73056
container_swap_kb=11052
container_log_bytes=8394869
```

切换后：

```text
host_mem_available_kb_after=737356
host_swap_used_kb_after=578116
container_rss_kb_after=119936
container_swap_kb_after=0
```

该单次快照不支持“GroupGuard 插件导致高 Swap”这一判断。切换前容器 Swap 约 11 MB，切换后为 0；主机 Swap 使用约 540-565 MB，远低于总量约 2.5 GB。

## 结论

`GFM-DELETE-002` 的代码合并、生产部署与基础上线验证均已完成。

仍需单独处理：

1. 观察下一次自然文件搬运，确认旧文件删除后验证逻辑实际生效；
2. 当前 5 个存量历史文件需要单独、明确、可审计地处理；
3. Swap 与存储波动如需继续确认，应做多时间点只读趋势采集，而不是依据单次登录摘要判断。
