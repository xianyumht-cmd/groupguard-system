# GroupGuard 全查询内网客户端：发布验证检查点（2026-07-30）

## 结论

GroupGuard 全查询迁移已经完成最新真实 Runner 验证。最终客户端只承担平台适配职责，可以构建 SnowLuma dist，但该 dist 必须继续封存，直到 Windows 接口部署和直接协议验收通过。

## 当前生产基线

- 当前生产 dist 仅迁移并验收了“查合集”；
- 真人测试：`查合集 滑板鞋` 通过；
- Windows 服务生产提交：`8de85a855b8338c3a9a69cbb2a937cd0a6ef8b82`；
- 本检查点中的其他功能尚未部署。

## 最终验证

客户端代码提交：`8a9d3ccea7663282ca6a9be8a23662bc589bf356`。

- GroupGuard CI：`30470186595`，成功；
- GroupGuard Build：`30470186613`，成功；
- `npm ci`：成功；
- `npm test`：成功；
- 部署 PowerShell 语法：成功；
- `npm run build:snowluma`：成功；
- 跨仓协议模拟：成功；
- 全查询客户端架构门禁：成功；
- 独立构建：成功。

最终真实 CI 修复：

1. 保留历史稳定错误码 `delivery_protocol_unsupported`；
2. 内网判断支持 IPv6 ULA 与链路本地地址，例如 `fd00::1`、`fe80::1`。

没有放宽测试、删除断言或恢复公网 fallback。

## 正式客户端职责

允许：

- 命令匹配；
- 提取最小原始参数；
- 平台权限、功能开关与限流；
- 生成稳定 request ID；
- 一次内网 query/report 请求；
- 严格校验协议、feature、图片字节数和 SHA-256；
- OneBot 文本、图片和合并转发发送。

禁止：

- 访问业务公网 Provider；
- 保存 Provider URL、Token、Cookie 或 Key；
- 解析业务 HTML/JSON；
- 生成查询图片或决定业务降级；
- 合并 Provider、重试上游或维护服务端快照；
- 写入插件本地骗子/同行事实库；
- 内网失败后发起公网备用请求。

## 发布顺序

```text
Windows 接口部署
→ query/report 直接协议验收
→ 交付最终 dist-only ZIP
→ 停止 groupguard-snowluma
→ 备份并替换 dist 内容
→ 启动容器
→ 群内完整命令矩阵验收
```

在接口验收前，不向生产替换最终 dist，不合并 Draft PR #17。

## 视频功能取消后的重新验证

- “我要看”内网运行插件和注册已删除；
- 默认动态“视频 ”命令及 `video.info` 已删除；
- 所有 test/build 路径改为运行 `verify:video-retired`；
- 全查询边界门禁确认正式客户端不再存在 video 运行模块或触发器；
- 旧封存 dist `029118346adaa9232aeceeb283f5d243a407dc95` 已作废，禁止部署。

新无视频 dist 只能在 Windows 无视频 API 小版本部署并通过直接协议验收后重新构建。
