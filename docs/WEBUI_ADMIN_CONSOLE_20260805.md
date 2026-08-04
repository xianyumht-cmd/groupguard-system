# GroupGuard WebUI 专业控制台改版

更新时间：2026-08-05 01:01 +08:00  
任务编号：`WEBUI-ADMIN-CONSOLE-001`

## 改版目标

解决旧主页功能入口全部平铺、视觉层级弱、模块难以定位、桌面与手机端排版不统一的问题。目标是将 WebUI 调整为接近正式服务器面板和后台管理系统的操作结构，同时不重写业务页面和接口。

## 实现范围

### 管理壳层

- 桌面端固定左侧导航和右侧内容工作区。
- 顶部保留页面标题、刷新按钮和主题切换，新增管理端在线状态提示。
- 运行状态页增加服务状态、运行宿主、配置保护和控制台安全四个摘要卡片。
- 手机和平板宽度下，侧边栏切换为抽屉菜单，支持菜单按钮、遮罩点击和选择菜单后自动关闭。

### 菜单分组

```text
概览
  - 状态

群管配置
  - 全局开关
  - 分群配置
  - 授权管理
  - 备份

服务与风控
  - 问答管理
  - 查询配置
  - 发送与风控
  - 推荐档位
  - 日志分析
  - 健康监控

扩展模块
  - SUB玩法
  - 内容风险
  - ELE构建

高级设置
  - 全量配置
  - config.json
  - 动态命令
```

### 视觉规范

- 使用稳定的后台面板色彩和间距，不再依赖大面积渐变背景。
- 统一按钮、输入框、卡片、表格、状态标签和代码结果区样式。
- 保留日间、跟随系统和夜间三种主题。
- 桌面侧边栏在日间和夜间模式下都保持清晰的深色导航层级。

## 兼容策略

本次没有重写 `static_page.ts` 中的业务 HTML，也没有替换原控件。主题控制器在页面脚本运行后移动现有 DOM 节点，原节点、ID、`data-tab`、事件监听器和接口调用全部保留。

未改变：

- WebUI Token 获取和保存方式。
- 配置读取、保存、自动备份与运行时刷新。
- 分群配置、授权、备份、查询、风控、SUB、内容风险、ELE 和动态命令接口。
- 问答页、查询页、群管家页和群文件搬运页的主题注入入口。

## 回归保护

`onebot-plugin-groupguard/scripts/verify-webui-ios-glass.ts` 新增以下检查：

- 专业控制台挂载函数存在。
- `gg-admin-shell` 主壳层存在。
- `gg-sidebar` 侧边栏存在。
- `gg-overview` 摘要区存在。
- 群管配置与服务风控菜单分组存在。
- 原主题注入幂等性继续保持。
- 原查询页面隐藏项和输出格式约束继续保持。

## 变更文件

```text
onebot-plugin-groupguard/src/standalone/admin/webui_theme.ts
onebot-plugin-groupguard/scripts/verify-webui-ios-glass.ts
CHANGELOG.md
docs/WEBUI_ADMIN_CONSOLE_20260805.md
docs/NEXT_CHAT_HANDOFF.md
```

## 发布前检查

```text
node --experimental-strip-types --check webui_theme.ts
node --experimental-strip-types --check verify-webui-ios-glass.ts
npm --prefix onebot-plugin-groupguard run verify:webui-ios-glass
npm --prefix onebot-plugin-groupguard test
npm --prefix onebot-plugin-groupguard run build:snowluma
```

## 部署说明

该改版只影响 WebUI 页面注入代码。合并并构建 SnowLuma 发布包后，需要按现有生产安全部署流程替换候选并重启服务，随后在浏览器强制刷新页面，验证桌面和手机宽度下的导航、表单保存、刷新按钮和主题切换。
