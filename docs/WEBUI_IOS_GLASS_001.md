# WEBUI-IOS-001：插件控制台 iOS 玻璃主题与易用性改造

- 仓库：`xianyumht-cmd/groupguard-system`
- 分支：`codex/webui-ios-glass-20260730`
- 状态：**IMPLEMENTING**
- 开始时间：2026-07-30
- 目标：让 SnowLuma GroupGuard WebUI 通过日常表单完成插件端配置，统一所有管理页面的 iOS 玻璃视觉，并支持白天、夜间和跟随系统模式。

## 1. 当前链路审查

### 页面与路由链

`onebot-plugin-groupguard/src/standalone/admin/server.ts` 统一提供：

- `/`：主控制台 `static_page.ts`
- `/qa.html`：问答管理 `qa_page.ts`
- `/query.html`：查询管理 `query_page.ts`
- `/group-file-mirror.html`：群文件搬运
- `/qun-guanjia.html`：Q群管家通道

当前每个页面各自内联 CSS，颜色和控件样式重复，全部固定为深色，缺少统一主题状态。

### 配置读写链

- 全局配置：`/api/config/patch` → `config_api.ts` → `configStateService` → `saveConfigStrict`
- 原始配置：`/api/config`，作为高级兜底入口
- 分群配置：`/api/groups/:groupId` → `group_api.ts`
- 查询配置：`/api/query/overview`、`/api/query/patch`、`/api/query/test` → `query_api.ts`
- 问答、授权、备份、群文件搬运、Q群管家均已有独立表单和 API
- 认证：URL/localStorage 中的 WebUI token → `x-groupguard-token` → `auth.ts`

### 审查结论

1. 插件端已经能通过简单表单修改大多数日常配置，原始 JSON 只需作为高级兜底。
2. 主页面功能很多，但固定深色、视觉层级弱，多个独立页面风格不一致。
3. 查询管理页面仍保留已退役的“查隐藏”展示，并把查封号、查骗子、查同行固定显示为文字，与最新统一三模式链路不一致。
4. 查询实际发送格式应继续由插件表达偏好、接口端生成最终内容；WebUI 只负责保存偏好，不在插件端渲染结果。

## 2. 实施范围

### P1 统一主题基础设施

- 新增共享主题模块，由 `server.ts` 在所有 HTML 页面输出前统一注入。
- 使用 CSS 变量实现 iOS 玻璃面板、背景光晕、圆角、柔和阴影和半透明导航。
- 支持 `light`、`dark`、`system` 三种模式。
- 使用 `localStorage` 保存主题，所有插件页面共享同一主题状态。
- 跟随系统模式时监听系统主题变化。

### P2 日常配置体验

- 所有页面顶部自动加入统一主题切换控件。
- 优化按钮、开关、输入框、表格、状态标签、提示和移动端布局。
- 保留主页面的日常分类入口和原始 JSON 高级入口。
- 不改变配置字段、保存结构和运行时刷新机制。

### P3 查询配置链路修正

- 移除 WebUI 中已退役的“查隐藏”入口和开关。
- 查封号、查骗子、查同行、动态查询/命令配置支持 `text`、`forward`、`image`。
- 全局、分群、单命令优先级继续保持：单命令 > 分群 > 全局。
- 查询总览必须显示真实最终输出偏好，不再硬编码文字。

### P4 验证

- TypeScript 类型检查通过。
- GroupGuard 完整测试通过。
- SnowLuma release 构建通过。
- 新增主题与查询配置契约测试，覆盖所有页面、三模式、存储键和退役功能清理。

## 3. 进度

- [x] AUDIT：页面、认证、配置保存和查询链路审查
- [x] PLAN：范围、兼容和验收标准确定
- [ ] IMPLEMENT：共享主题、页面注入、查询配置修正
- [ ] VERIFY：完整测试和 SnowLuma 构建
- [ ] COMPLETE：合并并标记完成

## 4. 完成标准

1. 插件端全部 WebUI 页面可切换白天、夜间、跟随系统。
2. 主题刷新后保持，并在所有页面一致。
3. 常用配置可通过中文表单完成，原始 JSON 仍可用。
4. 查询配置与统一三模式实际链路一致，不再展示退役查询。
5. GroupGuard CI 与 SnowLuma Build 全部通过并合并到 `main`。
