# OB-NAPCAT-DECOUPLING-001 生产验收

验收时间：2026-08-02 15:35 +08:00  
生产运行提交：`8c049a0b6bb5fab5ca65ce77050e021c468f1a84`

## 结论

NapCat 运行时解耦版本已经通过生产安全部署并正常运行。操作者完成机器人实机测试，确认生产环境正常，用户侧命令和交互没有发现异常或明显变化。

本次变更是运行时架构重构，不是业务功能改版；因此用户侧“没有感觉到变化”符合预期。

## 部署证据

```text
原生产提交: d0b79b6eab2514492196036bd79f14819b2d4102
目标提交: 8c049a0b6bb5fab5ca65ce77050e021c468f1a84
容器: groupguard-snowluma
机器人: 755396669
Host Profile: snowluma
ready: true
connected: true

CANDIDATE_VALIDATION_OK=true
BACKUP_CAPTURE_OK=true
SWITCH_OK=true
HEALTH_OK=true
DEPLOYMENT_OK=true
```

候选归档 SHA-256：

```text
bfa6957f985079d4500af0acde6eca27ee0c57a733c688153a630702b94b6b33
```

候选入口 SHA-256：

```text
97e5c12fa383f31bee491cea28b4e5e45728fb3be8087342a94b280b7492bbb5
```

生产备份：

```text
backups/ob-napcat-decoupling-001-20260802-153053-e20fde3d
```

部署状态文件：

```text
deployment-state/OB-NAPCAT-DECOUPLING-001-latest.json
```

容器重启后的首次健康探测曾返回 `ECONNREFUSED 127.0.0.1:6108`，随后自动重试成功；没有触发自动回滚。

## 生产验证

- 不可变候选 362 个文件校验通过。
- 生产切换后提交来源验证通过。
- WebUI/健康端点返回 `ready=true`。
- OneBot 返回 `connected=true`。
- 机器人身份为 `755396669`。
- Host Profile 为 `snowluma`。
- 操作者实机测试机器人，确认生产正常工作。

## 代码层变化

- GroupGuard 不再依赖 `napcat-types`、NapCat shim、NapCat Plugin Context 或 NapCat 生命周期。
- 运行时改为项目自有 OneBot 事件类型、两参数 Action Client 和 Runtime Context。
- 新增 `SnowLumaProfile` 与 `GenericOneBotProfile`，宿主扩展能力通过明确边界调用。
- SnowLuma 启动器直接创建 GroupGuard Runtime，不再伪造 NapCat 上下文。
- 群文件及消息历史扩展动作统一通过 Host Profile 路由。
- SnowLuma 群文件列表/删除语义没有可靠证据时返回 `indeterminate`，保留重试状态，不误报删除成功或文件不存在。
- 删除 `build:napcat`，保留纯 OneBot 与 SnowLuma 构建目标。

## 安全约束

```text
GFM-DELETE-003: 未运行
NapCat 参数推断 SnowLuma 扩展动作: 未使用
未知宿主响应: fail-closed，保留重试状态
生产回滚入口: 已保留
```

## 仓库收尾

生产验收完成后，PR #30 可以标记为 Ready 并合并到 `main`。合并时只允许在已部署代码提交之上追加本验收文档和状态更新，不再修改生产代码。
