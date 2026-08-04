# GroupGuard 下一步交接

更新时间：2026-08-05 01:15 +08:00  
已完成开发任务：`WEBUI-ADMIN-CONSOLE-001`

## 当前结论

GroupGuard WebUI 专业后台控制台改版已完成并合并到 `main`。旧主页顶部十多个平铺入口已重构为侧边分组导航、顶部管理栏、状态摘要卡片和独立内容工作区；手机与平板宽度使用抽屉式菜单。

本次没有重写业务页面和接口。原业务节点、ID、`data-tab`、事件监听器、WebUI Token、配置保存、自动备份和运行时刷新逻辑均保留，主题控制器只移动原 DOM 节点并增加管理壳层。

## 合并结果

```text
PR: #34
branch: codex/webui-admin-console-20260805
merge commit: 763ff93c7fd5425c17ea371dd9846fe04131e8ce
base before merge: 2ac2c2f662605ea34c5a2d5f2f1f71dc26340762
status: merged to main
```

主要实现提交：

```text
a846cf656c749d93b35969d5ab5635cff9095668  feat(webui): add professional admin console shell
3cd3f4deb705bf09502a3a0d29ea15b8d67dac30  test(webui): cover professional console structure
8dd5f29e4a825a773e55fc99d9d0a319c60c2512  docs: add consolidated recent changelog
57f1200ac4e71eb18b4c0be7948ac330c3f9fdfc  docs: record WebUI admin console redesign
74286ffe375edd1f0935437f7378f8409775ce31  docs: update handoff for WebUI console redesign
```

## 已完成内容

- 桌面端 248px 固定侧边栏和右侧主工作区。
- 菜单按“概览、群管配置、服务与风控、扩展模块、高级设置”分组。
- 顶部保留刷新和主题切换，新增管理端在线提示。
- 状态页新增服务状态、运行宿主、配置保护、控制台安全四张摘要卡片。
- 手机和平板端新增抽屉菜单、遮罩关闭和选择菜单后自动收起。
- 统一卡片、表单、按钮、表格、状态标签和代码结果区样式。
- 保留日间、跟随系统、夜间三种主题及原主题存储键。
- 扩展 `verify:webui-ios-glass`，增加管理壳层、侧边栏、摘要区和菜单分组断言。
- 新增根目录 `CHANGELOG.md`，整理 2026-08-01 至 2026-08-05 的重要更新。
- 新增专项文档 `docs/WEBUI_ADMIN_CONSOLE_20260805.md`。

## 兼容边界

未修改以下行为：

```text
WebUI Token 读取和 localStorage 键
配置读取与保存接口
保存前自动备份
运行时配置刷新
分群配置
授权管理
备份管理
问答管理
查询配置
发送与风控
SUB玩法
内容风险
ELE构建
config.json 编辑
commands.json 编辑
```

原 `.tab`、`.tablink`、表单和按钮节点没有被复制或替换，因此原事件监听器继续绑定在同一节点上。问答管理和查询配置链接仍由原页面脚本附加 Token。

## 已执行检查

```text
node --experimental-strip-types --check webui_theme.ts: passed
node --experimental-strip-types --check verify-webui-ios-glass.ts: passed
主题关键结构静态断言: passed
branch compare: ahead 5, behind 0
PR mergeability: true
PR #34 merge: passed
```

GitHub 未为 PR 头提交或 merge commit 返回自动 workflow/status 项，因此不能把完整 `npm test`、SnowLuma 构建或生产实机验收标记为已通过。

## 当前发布状态

```text
repository main: 已包含新版 WebUI
production container: 尚未部署本次改版
production verification: 尚未执行
```

下一步应按现有生产安全部署流程：

1. 在完整仓库环境运行 `npm --prefix onebot-plugin-groupguard run verify:webui-ios-glass`。
2. 运行 `npm --prefix onebot-plugin-groupguard test`。
3. 运行 `npm --prefix onebot-plugin-groupguard run build:snowluma`。
4. 构建不可变候选、备份生产、切换并执行健康检查。
5. 浏览器强制刷新后进行桌面与手机端实机验收。
6. 若失败，按现有自动回滚入口恢复，不得直接覆盖生产目录后手工试错。

## 实机验收重点

```text
左侧菜单分组和滚动正常
所有页签仍能切换
问答管理和查询配置链接携带原 Token
刷新按钮正常
配置保存正常并产生备份
分群配置读取/保存/删除正常
日间/跟随/夜间主题正常
820px 以下菜单可打开、遮罩可关闭、选项点击后自动收起
运行状态载入后摘要卡片由“检查中”更新为“运行正常”或“需要检查”
```

## 既有已关闭任务

`OB-NAPCAT-DECOUPLING-001` 已完成并合并：

```text
merge commit: 0838c546b186cb5d588397efdaf35053b0766b8b
production accepted commit: 8c049a0b6bb5fab5ca65ce77050e021c468f1a84
```

该任务结论不得因本次 WebUI 改版被改写。

## 参考

- `CHANGELOG.md`
- `docs/WEBUI_ADMIN_CONSOLE_20260805.md`
- `docs/OB_NAPCAT_PRODUCTION_ACCEPTANCE_001.md`
- `docs/CURRENT_TASK_STATE.json`
