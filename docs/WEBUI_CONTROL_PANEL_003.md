# WEBUI-CONTROL-PANEL-003：统一控制台架构与页面重构

更新时间：2026-08-05 03:46 +08:00

## 目标

停止继续在旧 WebUI 页面外层叠加 CSS 壳层，建立可维护的统一控制台设计系统、公共页面结构和信息架构，同时保持现有后端 API、配置结构、业务控件 ID、Token、保存前备份和运行时刷新行为不变。

## 合并结果

```text
PR: #35
final PR head: 6be8d143ba026ec43566c95645bebb98628b5ad3
merge commit: 6b30b6cf04822893189c931e2419a1f1d9251de2
repository main: 已合并
production: 尚未部署
```

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

最终代码提交：

```text
69f2ad9837c98890d15f99ca2a2605eb1d844f1e
```

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

## 当前发布状态

```text
代码、CI、构建和浏览器验收: passed
main: 已包含合并提交 6b30b6cf04822893189c931e2419a1f1d9251de2
production: 尚未部署
```

此前锁定提交 `36fc9ef74a413062bdb583134ab3446a7d8b24e7` 的部署包不包含本任务，不得用于发布。

## 生产发布要求

1. 从包含合并提交的最新 `main` 精确锁定目标提交。
2. 在隔离 worktree 完整测试和构建。
3. 生成逐文件 SHA-256 清单及不可变候选。
4. 生产不停机预检。
5. 备份当前完整 `dist`、配置、数据、容器信息和健康状态。
6. 原子切换并重启 `groupguard-snowluma`。
7. 验证目标提交、`ready=true`、OneBot 连接、机器人账号和新版控制台标记。
8. 失败时自动恢复旧 `dist`。
9. 发布后进行真实生产桌面和手机烟雾验收。
