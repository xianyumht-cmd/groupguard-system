# GroupGuard 下一步交接

更新时间：2026-08-02 04:52 +08:00  
当前任务：`OB-NAPCAT-DECOUPLING-001`

## 已完成

分支 `refactor/remove-napcat-onebot-runtime-20260802` 已完成 NapCat 运行时剥离，核心实现提交为：

```text
fffb2db1da99a1f5a815c7b8e70c3a450fa1f849
```

受控回归 workflow `30717036168` / job `91414108890` 已通过：

```text
npm ci
npm test
npm run build:onebot
npm run build:snowluma
```

已实现：

```text
GroupGuard 自有纯 OneBot Runtime
OneBot 两参数动作客户端
项目自有事件类型与规范化
SnowLumaProfile
GenericOneBotProfile
SnowLuma 直接启动新 Runtime
群文件/消息历史 Host Profile 边界
NapCat 类型、shim、生命周期和构建入口删除
未知列表/删除响应 fail-closed
```

临时补丁工作流已删除。`GFM-DELETE-003` 未运行，未依据 NapCat 推断 SnowLuma 列表/删除合同。

## 当前生产

```text
Production commit: d0b79b6eab2514492196036bd79f14819b2d4102
Production changed: false
Container restart: not executed
Config/SQLite/group-file state: unchanged
```

## 下一步必须按顺序执行

1. 等待并核对本状态提交的常规 Build CI 与 `OB NapCat dependency audit snapshot`。
2. 下载审计归档，确认活动源码、依赖、tsconfig 和构建中无 NapCat 运行时绑定。
3. 删除临时 `.github/workflows/ob-napcat-audit-snapshot.yml`。
4. 再跑一次常规 Build CI。
5. 全部通过后才可把 PR #30 从 Draft 转为可合并并合并 `main`。
6. 生产部署只能使用可执行的安全 SSH/部署路径；部署前必须取得旧生产 `ready=true`、OneBot connected 和 bot identity 证据。
7. 当前环境若没有生产 SSH/部署能力，必须明确记录“部署未执行”，不能声称完成生产迁移。

## 禁止项

```text
禁止运行 GFM-DELETE-003
禁止从 NapCat 参数推断 SnowLuma 扩展动作
禁止未知响应判定成功/不存在
禁止在最终 CI 前合并
禁止在没有安全部署路径时修改生产
```
