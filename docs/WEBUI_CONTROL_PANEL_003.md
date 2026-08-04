# WEBUI-CONTROL-PANEL-003：统一控制台架构与页面重构

更新时间：2026-08-05 03:40 +08:00

## 目标

停止继续在旧 WebUI 页面外层叠加 CSS 壳层，建立可维护的统一控制台设计系统、公共页面结构和信息架构，同时保持现有后端 API、配置结构、业务控件 ID、Token、保存前备份和运行时刷新行为不变。

## 架构

### 设计系统

```text
onebot-plugin-groupguard/src/standalone/admin/control_panel_design.ts
```

负责：

- 控制台颜色、字体、间距、表单、按钮、表格、状态和响应式规则。
- 侧边导航、顶部栏、面包屑、页面标题、内容工作区。
- 区块标题、说明、内容和底部操作区。
- 真实运行仪表盘。
- 导航搜索、Hash 路由、未保存修改保护和危险操作确认。

### 浏览器交互加固

```text
onebot-plugin-groupguard/src/standalone/admin/control_panel_browser_fixes.ts
```

负责：

- 保存成功后再清除未保存状态。
- 避免新旧危险操作确认重复弹窗。
- 手机抽屉搜索和关闭逻辑。
- 紧凑手机顶部主题按钮。
- 页面 Toast 反馈和自动收起。
- OneBot、配置文件状态的人类可读格式。
- 独立页面标题和群文件搬运区域标题修正。

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

统一结构包括：

```text
侧边分组导航
功能搜索
顶部状态栏
面包屑
页面标题和说明
页面级操作区
区块标题、内容和操作区
日间、跟随系统、夜间主题
桌面与手机响应式布局
```

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

Chromium 在真实 DOM 中打开五个页面，覆盖：

- 桌面 1440 × 960。
- 手机 390 × 844。
- 页面脚本无异常。
- 控制台结构完整。
- 字体栈包含 Microsoft YaHei。
- 页面无水平溢出。
- 日间、系统、夜间主题。
- 实时状态仪表盘。
- 主页 Hash 路由。
- 未保存修改提醒。
- 手机抽屉搜索、遮罩关闭和完全收起。
- 危险操作确认不重复。
- 状态详情不显示原始 JSON。
- 手机顶部栏保持单行。
- 群文件搬运区块标题明确。

最终代码提交：

```text
69f2ad9837c98890d15f99ca2a2605eb1d844f1e
```

最终代码门禁：

```text
GroupGuard CI: 30943939285 success
GroupGuard Build: 30943943936 success
WebUI Browser Acceptance: 30943939249 success
Chromium tests: 11 passed
```

截图证据：

```text
artifact id: 8906297134
sha256: c52ea13d0463b8e26542a79a56084d8bbbe717de853f11755c5c50743c468422
```

最终截图已人工复核：

- 手机导航关闭后完全离开屏幕。
- 手机顶部主题按钮不再竖排。
- 手机 Toast 位于底部，不遮挡页面标题。
- 桌面状态页不再展示原始 OneBot 和文件状态 JSON。
- 群文件搬运区块显示“运行设置”和“搬运规则”。

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
PR: #35
代码、CI、构建和浏览器验收: passed
main: 尚未合并
production: 尚未部署
```

此前锁定提交 `36fc9ef74a413062bdb583134ab3446a7d8b24e7` 的部署包不包含本任务，不得用于发布。

## 合并后发布要求

1. 从合并后的 `main` 精确锁定最终提交。
2. 在隔离 worktree 完整测试和构建。
3. 生成逐文件 SHA-256 清单及不可变候选。
4. 生产不停机预检。
5. 备份当前完整 `dist`、配置、数据、容器信息和健康状态。
6. 原子切换并重启 `groupguard-snowluma`。
7. 验证目标提交、`ready=true`、OneBot 连接、机器人账号和新版控制台标记。
8. 失败时自动恢复旧 `dist`。
9. 发布后进行真实生产桌面和手机烟雾验收。
