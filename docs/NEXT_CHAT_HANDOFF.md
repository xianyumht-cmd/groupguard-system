# GroupGuard 下一步交接

更新时间：2026-08-05 03:45 +08:00  
当前任务：`WEBUI-CONTROL-PANEL-003`  
当前状态：统一控制台第一阶段已完成开发、完整 CI、SnowLuma 构建、真实 Chromium 桌面/手机验收并合并到 `main`；生产尚未发布。

## 合并结果

```text
PR: #35
branch: codex/webui-control-panel-003-20260805
final PR head: 6be8d143ba026ec43566c95645bebb98628b5ad3
merge commit: 6b30b6cf04822893189c931e2419a1f1d9251de2
status: merged to main
production: unchanged
```

## 当前结论

本任务停止继续给旧 `webui_theme.ts` 叠加整套 CSS。控制台实现已经拆到独立设计系统和浏览器交互加固模块，并统一主页、问答管理、查询与接口、群文件搬运、Q群管家通道的信息架构。

主要模块：

```text
onebot-plugin-groupguard/src/standalone/admin/control_panel_design.ts
onebot-plugin-groupguard/src/standalone/admin/control_panel_browser_fixes.ts
onebot-plugin-groupguard/src/standalone/admin/webui_theme.ts
```

`webui_theme.ts` 只保留兼容组合入口。

## 已完成结构

```text
统一侧边分组导航
导航搜索
顶部状态栏
面包屑
页面标题与说明
页面级操作区
区块标题、说明、内容和底部操作区
手机抽屉导航
日间、跟随系统、夜间主题
```

## 真实运行数据

状态页直接读取：

```text
GET /api/readyz
GET /api/status
GET /api/build-info
```

显示服务就绪、OneBot 连接、机器人账号、运行版本、提交摘要、配置文件状态和动态命令数量。原始 OneBot 和文件状态 JSON 已转换为操作者可读文本和状态标签。

## 公共交互

- 未保存修改提醒和离开页面保护。
- 仅在观察到保存成功反馈后清除未保存状态，失败时继续提醒。
- 删除、取消授权和清除操作二次确认，同时避免旧页面重复确认。
- URL Hash 支持主页功能区直达。
- 手机导航搜索不会误关闭抽屉。
- 手机主题按钮使用紧凑图标，顶部栏保持单行。
- 页面反馈使用 Toast；手机 Toast 位于底部，不遮挡页面标题。
- 群文件搬运区域区分为“运行设置”和“搬运规则”。
- Windows 中文字体优先 `Microsoft YaHei UI`、`Microsoft YaHei`。

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

## 验证结果

最终 PR 头提交 `6be8d143ba026ec43566c95645bebb98628b5ad3`：

```text
GroupGuard CI run: 30944435831  success
GroupGuard Build run: 30944435324  success
WebUI Browser Acceptance run: 30944435306  success
```

最终代码提交 `69f2ad9837c98890d15f99ca2a2605eb1d844f1e` 的真实浏览器验收：

```text
Chromium tests: 11 passed
browser artifact id: 8906297134
artifact sha256: c52ea13d0463b8e26542a79a56084d8bbbe717de853f11755c5c50743c468422
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

最终桌面和手机截图已人工复核：手机抽屉完全收起、顶部栏保持单行、Toast 不遮挡标题；桌面状态页不显示原始 JSON。

## 非阻断警告

现有 CI 仍报告依赖审计、Actions Node 运行时、`node:sqlite` externalization、依赖 `eval` 和分块提示。这些未导致本任务失败，也不是本次控制台重构新增的运行错误，应另立依赖治理任务处理。

## 当前未完成

```text
生产不可变候选尚未生成
生产备份、切换、健康检查和自动回滚尚未执行
生产桌面和手机烟雾验收尚未执行
```

## 下一步

1. 从合并后的 `main` 精确锁定目标提交，不得复用旧部署包。
2. 在隔离 worktree 执行完整测试和 `build:snowluma`。
3. 生成逐文件 SHA-256 清单和不可变候选。
4. 对生产 `groupguard-snowluma` 做不停机只读预检。
5. 备份当前完整 `dist`、配置、数据、容器信息和健康状态。
6. 原子切换并执行提交、readiness、OneBot、机器人账号和 WebUI 标记检查。
7. 任一切换后失败立即自动恢复旧版本。
8. 发布成功后进行真实生产桌面与手机烟雾验收，并记录备份和回滚状态。

## 发布警告

此前锁定目标提交的部署包：

```text
36fc9ef74a413062bdb583134ab3446a7d8b24e7
```

它不包含 `WEBUI-CONTROL-PANEL-003`，禁止继续使用。新的发布候选应从包含合并提交 `6b30b6cf04822893189c931e2419a1f1d9251de2` 的最新 `main` 构建。

## 参考

- `docs/WEBUI_CONTROL_PANEL_003.md`
- `docs/CURRENT_TASK_STATE.json`
- `CHANGELOG.md`
- `.github/workflows/webui-browser-acceptance.yml`
