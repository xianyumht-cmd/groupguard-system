# GroupGuard 全查询迁移下一对话交接（2026-07-30 03:38 +08:00）

## 主交接

接口仓主交接：

```text
xianyumht-cmd/lolapisevers
branch: feat/all-query-delivery-hub-20260729
docs/checkpoints/ALL_QUERY_NEXT_CHAT_HANDOFF_20260730.md
```

新对话必须先读取主交接，再读取本文件。

## 当前目标

GroupGuard/SnowLuma 只作为平台传输适配器：

- 匹配命令；
- 执行群权限、功能开关和限流；
- 提取最小参数；
- 请求 Windows 内网 `query/report`；
- 验证 `groupguard-query-delivery.v1`；
- 发送最终文本、图片或合并转发。

SnowLuma 禁止：

- 访问公网业务 Provider；
- 保存 Provider URL、Token、Cookie 或 Key；
- 解析业务 HTML/JSON；
- 维护共享风险事实库；
- 决定业务缓存、重试、降级或公网 fallback。

## 当前生产状态

ARM：

```text
IP: 192.168.3.89
container: groupguard-snowluma
host path: /mnt/sda1/groupguard/app
container path: /app
runtime: node dist/snowluma-service.mjs
```

生产 dist 仍是此前仅迁移并真人验收“查合集”的版本。

本轮操作没有修改 ARM 配置，也没有替换 dist。

## Windows 接口状态

Windows 接口已部署：

```text
commit: ba54d83d7dd8cdbbb213b7bf38264655d671f134
service: LOLDataSystem
port: 5001
```

`查合集 滑板鞋` 已通过直接协议验收：

```text
protocol=groupguard-query-delivery.v1
ok=true
feature=shard
source=live
```

## Provider 迁移状态

ARM 实际存在：

- 3 个视频 Provider：搞笑、热门、跳舞；
- 1 个风险查询 Provider；
- 1 个自定义动态 HTTP 命令：`custom.lolban.query.lolmap.template`。

Windows Provider V2 迁移已成功：

- 风险 Provider 冒烟测试通过；
- 自定义动态命令已进入 Windows Provider 目录；
- 动态 Provider 总数为 4；
- Windows `/livez`、`/health` 通过；
- ARM 仍未修改。

三个旧视频 Provider 诊断结果：

- 搞笑：HTTP 502；
- 热门：HTTP 502；
- 跳舞：SSL 网络错误；
- 可用数量：0。

## 用户最终决定

用户明确取消整个视频分类查询功能：

```text
“搞笑、热门、跳舞”三个 Provider 无关紧要，这个功能不要了。
```

因此：

- 删除 `我要看` 正式命令；
- 删除 `video` feature 客户端插件和注册；
- 不再修旧视频 Provider；
- 不再要求迁移 `videoApiTemplates`；
- 最终部署后清理 ARM 旧视频配置；
- 不允许视频公网 fallback。

## 旧 dist 作废

此前封存：

```text
groupguard-all-query-dist-SEALED-029118346ada.zip
commit: 029118346adaa9232aeceeb283f5d243a407dc95
```

该版本包含 `我要看/video`，现在禁止部署，必须视为作废产物。

## 当前分支和 PR

```text
repository: xianyumht-cmd/groupguard-system
branch: feat/all-query-intranet-client-20260729
head before video removal: 48b7a0491b5dfac541e01789f2da9d25bd343e25
PR: #17
state: Draft / Open / Unmerged
```

生产验收前禁止合并。

## 下一步代码修改

重点审查并修改：

- `onebot-plugin-groupguard/src/commands.ts`
- 视频命令插件/运行插件文件
- `onebot-plugin-groupguard/scripts/verify-intranet-video-command.ts`
- `onebot-plugin-groupguard/scripts/verify-all-query-client-boundary.ts`
- `onebot-plugin-groupguard/package.json`
- 全查询计划、检查点、PR 描述

要求：

1. 正式命令注册中不再存在 `我要看`；
2. 不再注册 video 内网插件；
3. 测试应确认视频命令已删除，而不是跳过相关门禁；
4. 其他查询迁移不受影响；
5. 旧 `interaction_service.ts` 中视频残留只可暂时作为不可达代码，最终群内验收后再清理；
6. 不得恢复客户端公网请求。

## 继续保留的命令

- 查合集；
- 海符榜；
- 查封号；
- 查战绩；
- 查隐藏；
- 查骗子；
- 查同行；
- 举报骗子；
- 举报同行；
- 自定义动态命令 `custom.lolban.query.lolmap.template`；
- 其他确认有实际用途的动态内网命令。

## 验证要求

修改完成后运行真实 GitHub Actions：

```text
npm ci
npm test
npm run build:snowluma
跨仓协议模拟
全查询客户端边界门禁
```

不得弱化断言、删除失败门禁或使用旧构建产物。

## 最终发布顺序

```text
API 删除 video 并部署小版本
→ Windows 协议验收
→ GroupGuard 删除“我要看”后重新构建最终 dist
→ ARM 只替换一次最终 dist
→ 群内完整查询矩阵验收
→ 清理 ARM 旧 videoApiTemplates
→ 清理不可达旧查询代码
→ 再决定合并 PR #17 和 API PR #19
```

## 禁止事项

- 禁止部署旧封存 dist；
- 禁止继续修“搞笑/热门/跳舞” Provider；
- 禁止让 SnowLuma 直接访问视频或其他业务公网源；
- 禁止在接口视频删除之前先替换 dist；
- 禁止合并 Draft PR；
- 禁止删除现有 ARM/Windows 回滚备份。

## 2026-07-30 GroupGuard 视频移除代码阶段完成

已完成并由一次性工作流全量验证后提交：

- 删除 `registerIntranetVideoCommandPlugins`；
- 删除 `intranet_video_runtime_plugin.ts`；
- 删除“我要看”及默认动态“视频 ”正式入口；
- 原视频正向门禁改为 `verify:video-retired`；
- npm test、SnowLuma build 和全查询边界门禁均要求视频入口不存在；
- 旧含视频 dist 继续保持作废。

下一步必须先完成 Windows 无视频 API 部署与验收，再封存新的无视频 dist。
