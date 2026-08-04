# GroupGuard 下一步交接

更新时间：2026-08-05 03:39 +08:00  
当前任务：`WEBUI-CONTROL-PANEL-003`  
当前状态：统一控制台第一阶段代码、完整 CI、SnowLuma 构建和真实 Chromium 桌面/手机验收均已通过，PR #35 可合并；生产尚未发布。

## 当前结论

本任务不再继续给旧 `webui_theme.ts` 叠加整套 CSS。控制台实现已经拆到独立设计系统和浏览器交互加固模块，并统一了主页、问答管理、查询与接口、群文件搬运、Q群管家通道的信息架构。

```text
branch: codex/webui-control-panel-003-20260805
base: 36fc9ef74a413062bdb583134ab3446a7d8b24e7
PR: #35
validated head: 69f2ad9837c98890d15f99ca2a2605eb1d844f1e
production: unchanged
```

## 已完成结构

```text
统一侧边导航
导航搜索
顶部状态栏
面包屑
页面标题与说明
页面级操作区
区块标题、说明、内容和底部操作区
手机抽屉导航
日间、跟随系统、夜间主题
```

主要模块：

```text
onebot-plugin-groupguard/src/standalone/admin/control_panel_design.ts
onebot-plugin-groupguard/src/standalone/admin/control_panel_browser_fixes.ts
onebot-plugin-groupguard/src/standalone/admin/webui_theme.ts
```

`webui_theme.ts` 只保留兼容组合入口，不再承载完整控制台实现。

## 真实运行数据

状态页直接读取：

```text
GET /api/readyz
GET /api/status
GET /api/build-info
```

显示服务就绪、OneBot 连接、机器人账号、运行版本、提交摘要、配置文件状态和动态命令数量。原始 OneBot 和文件状态 JSON 已转换为面向操作者的可读文本和状态标签。

## 公共交互

- 未保存修改提醒和离开页面保护。
- 保存状态只在观察到成功反馈后清除，失败时继续保留提醒。
- 删除、取消授权和清除操作统一二次确认，同时避免与原页面确认重复弹窗。
- URL Hash 支持主页功能区直达。
- 手机端点击导航搜索不会误关闭抽屉。
- 手机主题按钮使用紧凑图标，不再竖排挤压顶部栏。
- 页面提示改为 Toast，不再占据整张内容卡片；手机 Toast 位于底部，不遮挡页面标题。
- 群文件搬运两个同名“设置”已改为“运行设置”和“搬运规则”。
- Windows 中文字体明确优先 `Microsoft YaHei UI`、`Microsoft YaHei`。

## 兼容边界

未修改：

```text
后端 API 路径
WebUI Token 行为
业务表单和按钮 ID
原业务事件监听器
配置保存
保存前自动备份
运行时配置刷新
分群配置
授权管理
问答管理
查询配置
群文件搬运
Q群管家通道
```

## 自动验证

最终代码提交 `69f2ad9837c98890d15f99ca2a2605eb1d844f1e`：

```text
GroupGuard CI run: 30943939285  success
GroupGuard Build run: 30943943936  success
WebUI Browser Acceptance run: 30943939249  success
```

已通过：

```text
npm test
tsc --noEmit
verify:webui-ios-glass
部署 PowerShell 语法检查
npm run build:snowluma
独立 GroupGuard Build
跨仓库只读 Mock 契约验证
真实 Chromium DOM 验收
桌面 1440px 视觉与交互验收
手机 390px 视觉与交互验收
```

Chromium 共执行 11 项测试，覆盖 5 个 WebUI 页面、主题切换、实时仪表盘、页签路由、未保存提醒、移动抽屉、危险操作确认、状态格式化和截图驱动修复。

截图证据：

```text
artifact id: 8906297134
artifact sha256: c52ea13d0463b8e26542a79a56084d8bbbe717de853f11755c5c50743c468422
```

已人工复核最终桌面和手机截图：手机标题不再被 Toast 遮挡，抽屉完全收起，顶部栏保持单行；桌面状态页不再展示原始 JSON。

## 非阻断警告

现有 CI 仍报告依赖审计、Actions Node 运行时、`node:sqlite` externalization、依赖 `eval` 和分块提示。这些没有导致本任务失败，也不是本次控制台重构新增的运行错误，应另立依赖治理任务处理。

## 当前未完成

```text
PR #35 尚未合并
main 尚未包含最终提交
生产不可变候选尚未生成
生产备份、切换、健康检查和自动回滚尚未执行
生产浏览器烟雾验收尚未执行
```

## 下一步

1. 将 PR #35 标记为 Ready 并合并到 `main`。
2. 记录最终 merge commit。
3. 从合并后的 `main` 构建新的不可变候选，不得复用锁定 `36fc9ef...` 的旧部署包。
4. 使用完整备份、原子切换、健康检查和自动回滚流程发布到 `groupguard-snowluma`。
5. 生产发布后检查桌面与手机 WebUI，并记录生产验收结果。

## 发布警告

此前生成的部署包目标提交为：

```text
36fc9ef74a413062bdb583134ab3446a7d8b24e7
```

它不包含 `WEBUI-CONTROL-PANEL-003`，禁止用于发布当前任务。

## 参考

- `docs/WEBUI_CONTROL_PANEL_003.md`
- `docs/CURRENT_TASK_STATE.json`
- `CHANGELOG.md`
- `.github/workflows/webui-browser-acceptance.yml`
