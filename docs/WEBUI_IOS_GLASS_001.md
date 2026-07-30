# WEBUI-IOS-001：插件控制台 iOS 玻璃主题与易用性改造

- 仓库：`xianyumht-cmd/groupguard-system`
- 实现分支：`codex/webui-ios-glass-20260730`
- 合并提交：`cb4792a336e970b2683d5ab2ec9a82e0ecb63a68`
- 状态：**COMPLETED**
- 开始时间：2026-07-30
- 完成时间：2026-07-30
- 目标：让 SnowLuma GroupGuard WebUI 通过日常表单完成插件端配置，统一所有管理页面的 iOS 玻璃视觉，并支持白天、夜间和跟随系统模式。

## 1. 链路审查结论

### 页面与路由链

`onebot-plugin-groupguard/src/standalone/admin/server.ts` 统一提供：

- `/`：主控制台
- `/qa.html`：问答管理
- `/query.html`：查询管理
- `/group-file-mirror.html`：群文件搬运
- `/qun-guanjia.html`：Q群管家通道

原实现由各页面各自内联 CSS，全部固定为深色。最终方案在 `server.ts` 的 HTML 输出边界统一注入主题，所有页面共享同一主题状态。

### 配置读写链

- 全局配置：`/api/config/patch` → `config_api.ts` → `configStateService` → `saveConfigStrict`
- 原始配置：`/api/config`，作为高级兜底入口
- 分群配置：`/api/groups/:groupId` → `group_api.ts`
- 查询配置：`/api/query/overview`、`/api/query/patch`、`/api/query/test`
- 问答、授权、备份、群文件搬运、Q群管家均保留独立表单和 API
- 认证：WebUI token → `x-groupguard-token` → `auth.ts`

插件端原本已经能通过中文表单修改大多数日常配置。本任务不改变配置字段、保存结构、鉴权方式和机器人运行时刷新机制。

## 2. 已完成实现

### 统一主题基础设施

- 新增共享主题模块 `webui_theme.ts`。
- 主控制台、问答、查询、群文件搬运和 Q群管家页面统一套用 iOS 玻璃主题。
- 使用 CSS 变量实现半透明面板、背景光晕、圆角、柔和阴影和半透明导航。
- 支持 `light`、`dark`、`system` 三种模式。
- 使用 `localStorage` 保存主题，所有插件页面共享同一选择。
- 跟随系统模式时监听系统主题变化。
- 提供移动端布局、减少动画偏好和无 `backdrop-filter` 降级。

### 日常配置体验

- 所有页面顶部自动加入日间、跟随和夜间切换控件。
- 优化按钮、开关、输入框、表格、状态标签和提示层级。
- 保留中文日常配置入口和原始 JSON 高级兜底入口。

### 查询管理展示修正

- 新增 `query_webui_facade.ts`，只修正 WebUI 展示，不改变机器人查询运行时。
- 渲染结果中移除已退役的“查隐藏”入口和开关。
- 查封号、查骗子、查同行和动态查询按统一 `text`、`forward`、`image` 偏好展示。
- 保持优先级：单命令 > 分群 > 全局。
- 查询总览把骗子、同行和动态查询显示为统一内网接口来源，不再显示旧外部接口或本地数据库说明。

### 验证链

- 新增主题和查询展示契约测试。
- 验证全部管理页面、三种主题模式、存储键、系统模式监听和主题幂等注入。
- 验证退役查询清理和统一三模式展示。
- 验证器已加入 `npm test`、release、debug 和 SnowLuma 构建门禁。
- GroupGuard CI 通过。
- SnowLuma Build 通过。

## 3. 最终进度

- [x] AUDIT：页面、认证、配置保存和查询链路审查
- [x] PLAN：范围、兼容和验收标准确定
- [x] IMPLEMENT：共享主题、页面注入和查询展示修正
- [x] VERIFY：完整测试和 SnowLuma 构建
- [x] COMPLETE：合并并标记完成

## 4. 完成结果

1. 插件端全部 WebUI 页面可切换白天、夜间、跟随系统。
2. 主题刷新后保持，并在所有页面一致。
3. 常用配置可通过中文表单完成，原始 JSON 仍可用。
4. 查询管理展示与统一三模式链路一致，不再展示退役查询。
5. GroupGuard CI 与 SnowLuma Build 全部通过并已合并到 `main`。
