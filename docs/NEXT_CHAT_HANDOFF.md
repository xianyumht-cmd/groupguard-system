# GroupGuard 下一步交接

更新时间：2026-08-05 04:14 +08:00  
已完成任务：`WEBUI-CONTROL-PANEL-003`  
当前状态：统一控制台第一阶段已开发、验收、合并并成功发布到生产，任务关闭。

## 最终结果

```text
PR: #35
merge commit: 6b30b6cf04822893189c931e2419a1f1d9251de2
production source commit: fa4f4a38f85962ba787c5bf9541426d9a5a57ad2
previous production commit: 7446e4f8225e5c3aff6f2e168acdad16d7b8e8d0
production container: groupguard-snowluma
production acceptance: passed
```

## 已完成内容

控制台不再继续向旧 `webui_theme.ts` 堆叠整套 CSS。主要实现拆分为：

```text
onebot-plugin-groupguard/src/standalone/admin/control_panel_design.ts
onebot-plugin-groupguard/src/standalone/admin/control_panel_browser_fixes.ts
onebot-plugin-groupguard/src/standalone/admin/webui_theme.ts
```

统一接入页面：

```text
/
/qa.html
/query.html
/group-file-mirror.html
/qun-guanjia.html
```

统一能力包括：

```text
侧边分组导航
功能搜索
顶部状态栏
面包屑
页面标题与说明
页面级操作区
区块标题、内容和底部操作区
真实运行仪表盘
未保存修改保护
危险操作确认
Toast 反馈
桌面/手机响应式布局
日间、系统、夜间主题
Microsoft YaHei UI / Microsoft YaHei 字体优先级
```

## 自动与浏览器验收

最终 PR 头：

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

## 生产发布

生产候选：

```text
candidate files: 362
candidate archive sha256: b66ab1ee97de3be0b87a123893ed49e73ae3350df1dd7dfb00e7829b72bed780
deployment bundle sha256: 62e5d85d1e09583dac8d27f2eae9ef4736d27d5ef12d033309ca30380df20e8a
```

生产备份：

```text
/mnt/sda1/groupguard/backups/webui-control-panel-003-20260804-200018-fa4f4a38f859
```

最终生产状态：

```text
running commit: fa4f4a38f85962ba787c5bf9541426d9a5a57ad2
ready: true
OneBot connected: true
bot id: 755396669
host profile: snowluma
control panel markers: passed
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

部署状态文件：

```text
/mnt/sda1/groupguard/app/deployment-state/WEBUI-CONTROL-PANEL-003-latest.json
```

手动回滚入口：

```text
ROLLBACK-GROUPGUARD.cmd
```

## 发布过程说明

- v2 因服务器宿主无 Node，在生产切换前停止。
- v3 完成候选验证、备份和切换，但 Windows PowerShell 5.1 将健康重试产生的 SSH stderr 视为终止错误，客户端会话提前断开。
- v4 使用 resume-safe 流程识别目标版本已健康运行，重新验证控制台并补齐生产状态和回滚入口，最终成功。

## 兼容边界

未改变：

```text
后端 API 路径
WebUI Token 行为
业务表单和按钮 ID
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

## 保留事项

- 不要删除上述生产备份和 `WEBUI-CONTROL-PANEL-003-latest.json`，至少保留到下一次稳定发布周期结束。
- 旧的 `36fc9ef...` 部署包以及 v2/v3 包均不得再次用于生产发布。
- 当前生产版本已经是目标提交，不需要重复运行部署包。

## 后续任务建议

后续工作必须使用新的任务 ID：

1. 将超长 `static_page.ts` 按功能页面进一步组件化。
2. 把表单、表格、空状态、加载状态和反馈消息抽成公共渲染组件。
3. 将内联浏览器脚本迁移为模块化客户端代码。
4. 单独处理 npm 依赖审计、Actions Node 运行时和 Vite 构建警告。

## 参考

- `docs/WEBUI_CONTROL_PANEL_003.md`
- `docs/WEBUI_CONTROL_PANEL_003_PRODUCTION_ACCEPTANCE.md`
- `docs/CURRENT_TASK_STATE.json`
- `CHANGELOG.md`
- `.github/workflows/webui-browser-acceptance.yml`
