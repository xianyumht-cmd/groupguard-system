# GroupGuard 下一步交接

更新时间：2026-08-05 01:01 +08:00  
当前任务：`WEBUI-ADMIN-CONSOLE-001`

## 当前结论

WebUI 主页已完成专业后台控制台改版开发，不再把全部功能入口平铺在页面顶部。新版使用侧边分组导航、顶部管理栏、状态摘要卡片和独立内容工作区，并提供手机端抽屉菜单。

本次保持所有原业务节点、ID、事件监听器、Token、配置保存和接口路径不变，主要通过共享主题控制器重组现有 DOM，降低对核心功能的回归风险。

## 当前分支

```text
branch: codex/webui-admin-console-20260805
base: main@2ac2c2f662605ea34c5a2d5f2f1f71dc26340762
```

主要提交：

```text
a846cf656c749d93b35969d5ab5635cff9095668  feat(webui): add professional admin console shell
3cd3f4deb705bf09502a3a0d29ea15b8d67dac30  test(webui): cover professional console structure
8dd5f29e4a825a773e55fc99d9d0a319c60c2512  docs: add consolidated recent changelog
57f1200ac4e71eb18b4c0be7948ac330c3f9fdfc  docs: record WebUI admin console redesign
```

## 已完成内容

- 桌面端 248px 固定侧边栏和右侧主工作区。
- 菜单按概览、群管配置、服务与风控、扩展模块、高级设置分组。
- 顶部保留刷新和主题切换，新增管理端状态提示。
- 状态页新增四张摘要卡片。
- 手机和平板端新增抽屉菜单、遮罩和菜单自动关闭。
- 统一后台面板的卡片、表单、按钮、表格、状态和代码区样式。
- 保留日间、跟随系统、夜间三种主题。
- 扩展 WebUI 回归断言。
- 新增根目录 `CHANGELOG.md`，整理 2026-08-01 至 2026-08-05 的重要更新。
- 新增详细设计与发布说明 `docs/WEBUI_ADMIN_CONSOLE_20260805.md`。

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

原 `.tab`、`.tablink`、`data-tab`、表单节点和按钮节点被移动到新壳层，但没有被复制或替换，因此原事件监听器继续绑定在同一节点上。

## 已执行静态检查

```text
node --experimental-strip-types --check webui_theme.ts: passed
node --experimental-strip-types --check verify-webui-ios-glass.ts: passed
主题关键结构静态断言: passed
```

## 尚需完成

按顺序执行：

1. 运行 `npm --prefix onebot-plugin-groupguard run verify:webui-ios-glass`。
2. 运行 `npm --prefix onebot-plugin-groupguard test`。
3. 运行 `npm --prefix onebot-plugin-groupguard run build:snowluma`。
4. 创建 PR 并检查 CI。
5. 合并到 `main` 后记录真实 merge commit。
6. 按生产安全部署流程发布，并在浏览器强制刷新后进行桌面和手机端实机验收。

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

`OB-NAPCAT-DECOUPLING-001` 已完成并合并，merge commit 为：

```text
0838c546b186cb5d588397efdaf35053b0766b8b
```

生产曾验收运行提交：

```text
8c049a0b6bb5fab5ca65ce77050e021c468f1a84
```

该任务结论不得因本次 WebUI 改版被改写。

## 参考

- `CHANGELOG.md`
- `docs/WEBUI_ADMIN_CONSOLE_20260805.md`
- `docs/OB_NAPCAT_PRODUCTION_ACCEPTANCE_001.md`
- `docs/CURRENT_TASK_STATE.json`
