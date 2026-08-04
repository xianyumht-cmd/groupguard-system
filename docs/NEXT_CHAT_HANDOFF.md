# GroupGuard 下一步交接

更新时间：2026-08-05 03:25 +08:00  
当前任务：`WEBUI-CONTROL-PANEL-003`  
当前状态：第一阶段代码与完整 CI/构建已通过，等待浏览器桌面/手机实机验收。

## 当前结论

`WEBUI-ADMIN-CONSOLE-001` 只完成了控制台外壳，核心仍然是旧页面节点整体移入右侧工作区。本任务已经停止继续向旧 `webui_theme.ts` 叠加整套样式，开始建立独立设计系统、统一页面结构和公共交互。

```text
branch: codex/webui-control-panel-003-20260805
base: 36fc9ef74a413062bdb583134ab3446a7d8b24e7
PR: #35
validated head: a127d6ef4dd956b9e0eb7d4291f3a9ecdbda84d4
production: unchanged
```

## 第一阶段已完成

### 独立设计系统

新增：

```text
onebot-plugin-groupguard/src/standalone/admin/control_panel_design.ts
```

原 `webui_theme.ts` 已缩减为兼容入口：

```text
applyWebUiTheme(page) -> applyControlPanelDesign(page)
```

控制台实现不再继续堆积在旧主题文件中。

### 统一页面结构

主页、问答管理、查询与接口、群文件搬运、Q群管家通道统一使用：

```text
侧边导航
功能搜索
顶部状态栏
面包屑
页面标题与说明
页面级操作区
结构化内容区
区块标题
区块内容
区块底部操作栏
```

主页继续复用原按钮、表单和事件监听器，但业务区块会被整理为明确的标题、内容和操作区域，而不是把旧卡片整体塞入右侧工作区。

### 真实运行仪表盘

状态页直接读取：

```text
GET /api/readyz
GET /api/status
GET /api/build-info
```

显示服务就绪、OneBot 连接、机器人账号、运行版本、提交摘要、配置状态和动态命令数量。顶部状态会根据 readiness 和 OneBot 连接结果切换。

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

不再只依赖 `system-ui` 的中文回退。

## 已通过验证

PR #35 合并引用上的完整自动检查已经通过：

```text
GroupGuard CI run: 30941625296
CI job: 92101162704
result: success

GroupGuard Build run: 30941620829
Build job: 92101146780
result: success
```

CI 已执行并通过：

```text
npm ci
npm test
tsc --noEmit
verify:webui-ios-glass
部署 PowerShell 语法检查
npm run build:snowluma
跨仓库只读 Mock 契约验证
独立 GroupGuard Build
```

关键输出：

```text
webui unified control panel verification passed
✓ 539 modules transformed
✓ built in 5.71s
```

跨仓库契约验证为 9 项通过、0 项失败，1 项需要真实群发送授权的变更性用例未运行，符合只读 CI 约束。

## 非阻断警告

CI 同时报告以下既有依赖或构建警告，但未导致失败：

```text
npm audit: 19 moderate, 4 high
GitHub Actions Node 运行时弃用提示
undici 的 node:sqlite externalization 提示
file-type 依赖 eval 提示
现有动态/静态 import 分块提示
```

这些警告不是本次 WebUI 重构引入的编译失败，但后续应另立依赖治理任务处理。

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

## 当前仍未完成

下面项目仍然不能标记为通过：

```text
真实浏览器 DOM 验收
桌面端视觉验收
手机端视觉验收
旧页面局部 CSS 冲突检查
生产不可变候选
生产备份和部署
生产健康检查
生产自动回滚入口
```

代码和构建通过不等于界面视觉实机验收通过，也不得把当前分支标记为生产已发布。

## 下一步执行顺序

1. 在真实浏览器检查主页和四个独立页面。
2. 检查左侧导航、顶部栏、页面标题、区块操作栏和表单布局。
3. 检查日间、夜间、跟随系统主题。
4. 检查 860px 和 620px 以下手机布局。
5. 重点检查旧页面 `.tabs`、`.top`、`.card` 等局部样式是否干扰统一结构。
6. 修复视觉或交互缺陷并重新运行 CI。
7. 记录浏览器验收证据后将 PR #35 转为可合并状态。
8. 合并 `main` 后重新生成不可变候选和安全部署包。
9. 按备份、原子切换、健康检查和自动回滚流程发布到 `groupguard-snowluma`。

## 发布警告

此前生成的部署包锁定：

```text
36fc9ef74a413062bdb583134ab3446a7d8b24e7
```

它不包含 `WEBUI-CONTROL-PANEL-003`，不得用于发布本任务。合并后必须重新生成部署包。

## 参考

- `docs/WEBUI_CONTROL_PANEL_003.md`
- `docs/CURRENT_TASK_STATE.json`
- `CHANGELOG.md`
- `docs/WEBUI_ADMIN_CONSOLE_20260805.md`
- `docs/OB_NAPCAT_PRODUCTION_ACCEPTANCE_001.md`
