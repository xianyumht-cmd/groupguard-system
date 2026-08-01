# GroupGuard 下一步交接

更新时间：2026-08-02 05:02 +08:00  
当前任务：`OB-NAPCAT-DECOUPLING-001`

## 当前结论

分支 `refactor/remove-napcat-onebot-runtime-20260802` 已完成 NapCat 运行时剥离，核心实现提交：

```text
fffb2db1da99a1f5a815c7b8e70c3a450fa1f849
```

代码层门槛全部通过，但 PR #30 继续保持 Draft，未合并；生产没有部署通道，因此生产阶段仍被阻断。

## 已通过验证

受控原子回归：

```text
workflow 30717036168
job 91414108890
npm ci: passed
npm test: passed
npm run build:onebot: passed
npm run build:snowluma: passed
```

最终普通分支验证：

```text
CI 30717204473: success
Build 30717204475: success
Audit 30717204512: success
```

最终审计结果：

```text
活动 napcat-types 导入: 0
活动四参数动作调用: 0
NapCatPluginContext / PluginModule / NapCatConfig: 0
活动 NapCat shim: 0
build:napcat: 0
剩余 napcat 文本: 历史记录/注释，以及上游 LAPI 的 compat=napcat 线协议选择器
```

临时补丁工作流与临时审计工作流均已删除。

## 已实现

```text
GroupGuard 自有纯 OneBot Runtime
OneBot 两参数动作客户端
项目自有事件类型与规范化
SnowLumaProfile
GenericOneBotProfile
SnowLuma 直接启动新 Runtime
群文件/消息历史 Host Profile 边界
NapCat 类型、shim、生命周期和构建入口删除
未知列表/删除响应 fail-closed 并保留重试状态
```

## 安全状态

```text
GFM-DELETE-003: 未运行
NapCat 参数推断 SnowLuma 扩展动作: 未使用
Production commit: d0b79b6eab2514492196036bd79f14819b2d4102
Production changed: false
Container restart: not executed
Config/SQLite/group-file state: unchanged
Merge: not executed
Deployment: not executed
```

## 下一步必须按顺序执行

1. 核对本次清理后状态提交的最终普通 CI 与 Build。
2. 保持 PR #30 为 Draft，直到具备可执行的安全 SSH/部署路径和明确部署窗口。
3. 合并前确认生产旧版 `ready=true`、OneBot connected=true、bot identity known=true。
4. 合并后生成来源可验证的不可变候选，先在生产运行期间完成候选验证。
5. 完整备份配置、SQLite、运行状态和当前程序后再原子切换。
6. 切换后验证健康、OneBot、身份、WebUI 和来源；任一步失败自动回滚。
7. 当前环境没有生产 SSH/部署能力，必须继续记录“部署未执行”，不能声称生产迁移完成。

## 禁止项

```text
禁止运行 GFM-DELETE-003
禁止从 NapCat 参数推断 SnowLuma 扩展动作
禁止未知响应判定成功/不存在
禁止在没有安全部署路径时修改生产
```
