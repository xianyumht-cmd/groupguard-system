# GroupGuard 下一步交接

更新时间：2026-08-05 03:15 +08:00  
当前任务：`WEBUI-CONTROL-PANEL-003`  
当前状态：第一阶段代码已完成，等待完整测试、浏览器验收和 PR 合并。

## 当前结论

`WEBUI-ADMIN-CONSOLE-001` 只完成了控制台外壳，核心仍然是旧页面节点整体移入右侧工作区。用户确认下一阶段停止继续叠加 CSS，改为重构统一设计系统、页面结构和信息架构。

本次已在独立分支开始执行：

```text
branch: codex/webui-control-panel-003-20260805
base: 36fc9ef74a413062bdb583134ab3446a7d8b24e7
production: unchanged
```

## 第一阶段已完成

### 独立设计系统

新增：

```text
onebot-plugin-groupguard/src/standalone/admin/control_panel_design.ts
```

原文件：

```text
onebot-plugin-groupguard/src/standalone/admin/webui_theme.ts
```

现在只保留兼容入口并委托：

```text
applyWebUiTheme(page) -> applyControlPanelDesign(page)
```

控制台实现不再继续堆积在旧主题文件中。

### 统一页面结构

主页、问答管理、查询与接口、群文件搬运、Q群管家通道统一使用：

```text
侧边导航
顶部状态栏
面包屑
页面标题与说明
页面级操作区
结构化内容区
区块标题
区块内容
区块底部操作栏
```

主页菜单继续使用原按钮节点和原事件监听器，但页面区域不再以整张旧卡片直接塞进右侧区域，而是拆分为明确的标题、内容、操作区域。

### 真实运行仪表盘

状态页直接读取：

```text
/api/readyz
/api/status
/api/build-info
```

显示：

- 服务就绪状态
- OneBot 连接状态
- 机器人账号
- 运行版本与提交摘要
- 配置文件状态
- 动态命令数量

顶部状态会根据真实 readiness 和 OneBot 连接结果切换。

### 公共交互

新增：

- 导航搜索
- URL Hash 功能区定位
- 未保存修改提醒
- 离开页面保护
- 放弃修改并刷新
- 删除、取消授权、清除等高风险操作二次确认
- 手机端抽屉导航
- 日间、跟随系统、夜间主题

### 字体

Windows 中文字体明确优先：

```text
Microsoft YaHei UI
Microsoft YaHei
```

不再只依赖 `system-ui` 的中文字体回退。

## 兼容边界

未修改：

```text
后端 API 路径
WebUI Token
表单和按钮 ID
业务事件监听器
配置保存
保存前备份
运行时配置刷新
分群配置
授权管理
问答管理
查询配置
群文件搬运
Q群管家通道
```

## 回归检查变化

`onebot-plugin-groupguard/scripts/verify-webui-ios-glass.ts` 已升级为统一控制台架构验证，新增检查：

```text
control_panel_design.ts 独立模块
兼容入口委托
统一控制台根节点
统一侧栏
页面标题区
区块内容区
区块操作区
实时状态 API
未保存提醒
危险操作确认
微软雅黑字体栈
五个 WebUI 页面接入
重复注入幂等性
```

测试命令名称暂时不改，避免破坏现有 CI 和发布脚本。

## 当前分支提交

```text
201cb7ff149a5cdf1334355b0d269ebb23ddcd96  feat(webui): add unified control panel design system
4d37f1b0587e750417da87669b174af571d2f545  refactor(webui): route legacy theme entry through control panel design system
9ea59838028df51fb728793036a49083fe50eaff  test(webui): verify unified control panel architecture
e933a230ca88850c1a8c0d8787b0138867ec78a1  docs: record unified control panel architecture
d3e90760ab5b156e52c541ce2bf00750234ee1f9  docs: add control panel architecture changelog
62ed999cf170577ce855d5d8bc934835e554b6e8  docs: mark WEBUI-CONTROL-PANEL-003 active state
```

## 尚未完成和不得声称完成的内容

当前没有完整仓库执行环境的测试结果，因此以下项目仍为待办：

```text
npm run verify:webui-ios-glass
npm test
npm run build:snowluma
真实浏览器 DOM 验收
桌面端视觉验收
手机端视觉验收
生产不可变候选
生产备份和部署
生产健康检查
生产自动回滚入口
```

不得把当前分支标记为已经生产验收。

## 下一步执行顺序

1. 在完整仓库环境运行 WebUI 专项验证。
2. 运行完整 `npm test`。
3. 运行 `build:snowluma`。
4. 使用浏览器检查主页和四个独立页面的 DOM、导航、表单、主题和响应式布局。
5. 重点检查旧页面本地 CSS 是否与统一侧栏和结构组件冲突。
6. 修复发现的问题并补回归断言。
7. 创建 PR，记录验证证据。
8. 验证通过后合并 `main`。
9. 重新生成不可变候选和安全部署包。
10. 按备份、原子切换、健康检查和自动回滚流程发布到 `groupguard-snowluma`。

## 发布警告

此前生成的部署包锁定：

```text
36fc9ef74a413062bdb583134ab3446a7d8b24e7
```

它不包含 `WEBUI-CONTROL-PANEL-003`，不得用于发布本任务。合并后必须重新生成部署包。

## 参考文档

- `docs/WEBUI_CONTROL_PANEL_003.md`
- `docs/CURRENT_TASK_STATE.json`
- `CHANGELOG.md`
- `docs/WEBUI_ADMIN_CONSOLE_20260805.md`
- `docs/OB_NAPCAT_PRODUCTION_ACCEPTANCE_001.md`
