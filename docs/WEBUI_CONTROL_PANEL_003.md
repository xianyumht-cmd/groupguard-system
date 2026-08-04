# WEBUI-CONTROL-PANEL-003：统一控制台架构与页面重构

更新时间：2026-08-05 04:14 +08:00

## 最终状态

```text
PR: #35
final PR head: 6be8d143ba026ec43566c95645bebb98628b5ad3
merge commit: 6b30b6cf04822893189c931e2419a1f1d9251de2
production source commit: fa4f4a38f85962ba787c5bf9541426d9a5a57ad2
production previous commit: 7446e4f8225e5c3aff6f2e168acdad16d7b8e8d0
repository main: 已合并
production: 已部署并验收通过
status: complete
```

## 目标

停止继续在旧 WebUI 页面外层叠加 CSS 壳层，建立可维护的统一控制台设计系统、公共页面结构和信息架构，同时保持现有后端 API、配置结构、业务控件 ID、Token、保存前备份和运行时刷新行为不变。

## 架构

### 设计系统

```text
onebot-plugin-groupguard/src/standalone/admin/control_panel_design.ts
```

负责控制台视觉规范、侧边导航、顶部栏、面包屑、页面标题、内容工作区、区块结构、真实运行仪表盘、导航搜索、Hash 路由、未保存修改保护和危险操作确认。

### 浏览器交互加固

```text
onebot-plugin-groupguard/src/standalone/admin/control_panel_browser_fixes.ts
```

负责保存结果跟踪、确认去重、手机抽屉逻辑、紧凑顶部主题按钮、Toast 反馈、状态格式化和页面标题修正。

### 兼容入口

```text
onebot-plugin-groupguard/src/standalone/admin/webui_theme.ts
```

只组合调用设计系统和浏览器交互加固层，保留原 `applyWebUiTheme` 对外入口。

## 统一页面

以下页面接入同一控制台结构：

```text
/
/qa.html
/query.html
/group-file-mirror.html
/qun-guanjia.html
```

统一结构包括侧边分组导航、功能搜索、顶部状态栏、面包屑、页面标题与说明、页面级操作区、区块标题/内容/操作区、三种主题和桌面/手机响应式布局。

## 真实状态仪表盘

读取：

```text
GET /api/readyz
GET /api/status
GET /api/build-info
```

显示服务是否就绪、OneBot 是否连接、当前机器人账号、运行版本和提交摘要、配置文件状态及动态命令数量。

## 浏览器验收

新增：

```text
.github/workflows/webui-browser-acceptance.yml
onebot-plugin-groupguard/scripts/webui-browser-acceptance.spec.ts
onebot-plugin-groupguard/scripts/webui-visual-polish.spec.ts
```

Chromium 在真实 DOM 中打开五个页面，覆盖桌面 1440 × 960、手机 390 × 844、页面脚本、字体、水平溢出、主题、实时仪表盘、Hash 路由、未保存提醒、手机抽屉、危险操作确认、状态格式化和区块标题。

最终 PR 头门禁：

```text
GroupGuard CI: 30944435831 success
GroupGuard Build: 30944435324 success
WebUI Browser Acceptance: 30944435306 success
Chromium tests: 11 passed
```

截图证据：

```text
artifact id: 8906297134
sha256: c52ea13d0463b8e26542a79a56084d8bbbe717de853f11755c5c50743c468422
```

最终截图已人工复核：手机导航完全收起、顶部主题按钮保持单行、手机 Toast 不遮挡标题、桌面状态页不展示原始 JSON、群文件搬运显示“运行设置”和“搬运规则”。

## 兼容边界

未修改：

```text
后端 API 路径
WebUI Token 读取和传递
现有业务控件 ID
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

## 生产发布

生产候选从合并后的 `main` 精确锁定并在隔离 worktree 中构建。

```text
candidate files: 362
candidate archive sha256: b66ab1ee97de3be0b87a123893ed49e73ae3350df1dd7dfb00e7829b72bed780
deployment bundle sha256: 62e5d85d1e09583dac8d27f2eae9ef4736d27d5ef12d033309ca30380df20e8a
```

生产备份：

```text
/mnt/sda1/groupguard/backups/webui-control-panel-003-20260804-200018-fa4f4a38f859
```

最终生产验收：

```text
running commit: fa4f4a38f85962ba787c5bf9541426d9a5a57ad2
ready: true
OneBot connected: true
bot id: 755396669
host profile: snowluma
control-panel markers: passed
```

成功标记：

```text
PREFLIGHT_OK=true
CANDIDATE_VALIDATION_OK=true
BACKUP_CAPTURE_OK=true
SWITCH_OK=true
HEALTH_OK=true
WEBUI_CONTROL_PANEL_OK=true
DEPLOYMENT_OK=true
RESUME_FINALIZATION_OK=true
```

生产状态文件：

```text
/mnt/sda1/groupguard/app/deployment-state/WEBUI-CONTROL-PANEL-003-latest.json
```

手动回滚入口：

```text
ROLLBACK-GROUPGUARD.cmd
```

## 发布过程修正

- v2：服务器宿主无 Node，生产切换前停止。
- v3：候选验证、备份和切换完成，但 Windows PowerShell 5.1 将健康重试的 SSH stderr 视为终止错误，客户端提前断开。
- v4：使用 resume-safe 逻辑识别目标版本已健康运行，重新验证控制台并补齐状态和回滚入口，最终发布成功。

## 发布安全结论

- 生产源来自已合并 `main`。
- 候选逐文件 SHA-256 验证通过。
- 切换前完整备份已创建。
- 目标提交、readiness、OneBot、机器人账号和新版控制台标记均通过。
- 后端 API、Token、业务控件和保存契约未改变。
- 旧版本备份、生产状态和手动回滚入口均已保留。

## 后续

本任务关闭。进一步拆分 `static_page.ts`、提取公共表单/表格组件、模块化浏览器脚本及依赖治理，应使用新的任务 ID。
