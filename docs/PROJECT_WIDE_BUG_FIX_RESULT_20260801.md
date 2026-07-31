# GroupGuard 全仓 Bug 修复结果（2026-08-01）

## 1. 执行结论

- 审计基线：`main@98edb1fc2eef2ade4e1f771e8cf4479cdd6c6f70`
- 修复分支：`fix/project-wide-bugs-20260801`
- 核心源码提交：`7f0909db589ae7b325faa80fc96a05b781a2dd6f`
- Pull Request：`#28 fix: resolve project-wide audited bugs`
- 审计缺陷：44 项
- 代码级处理：44/44
- 可由自动化直接验收：39/39 已通过
- 依赖真实 SnowLuma、OneBot、QQ、DNS 或最终发布包的项目：5 项，代码保护已完成，仍需生产前实机验收
- 本次未合并 `main`、未部署、未重启生产容器。

“代码级处理完成”表示缺陷对应的危险路径已修改并有静态或自动回归保护；不表示未经实机运行的行为已经在生产环境闭环。

## 2. 自动验证结果

验证工作区运行了完整 `npm test` 与干净 SnowLuma 构建，以下检查全部通过：

- TypeScript `tsc --noEmit`
- system-write 严格架构检查
- risk-policy 架构检查
- 动作队列回归
- 核心稳定性回归
- 查询协议与交付协议
- 全查询内网迁移、战绩、风险、动态命令
- 隐藏查询和视频功能退役检查
- WebUI iOS 玻璃主题与管理健康接口
- 查询客户端边界、发布安全、内容风控
- 群文件原生上传搬运
- 新增的全仓 Bug 修复回归
- `npm run build:snowluma`

验证日志中的最终结果包括：

- `core stability verification passed`
- `groupguard query delivery contract verification passed`
- `release safety verification passed`
- `group file native upload mirror verification passed`
- `project-wide bugfix regression passed`
- SnowLuma 构建成功

清理一次性补丁器和自修改工作流后，仓库原有 `GroupGuard CI` 与 `GroupGuard Build` 又在修复分支上通过。

## 3. 44 项缺陷处理对账

| 编号 | 处理状态 | 主要修复 |
|---|---|---|
| GG-BUG-001 | 已修复 | SnowLuma 增加启动闸门与有界事件缓冲，初始化完成后才消费 OneBot 事件。 |
| GG-BUG-002 | 已修复 | 动态命令初始化改为可等待 Promise，`plugin_init` 严格等待。 |
| GG-BUG-003 | 已修复 | 初始化失败会复位状态并允许后续重试，不再永久卡死。 |
| GG-BUG-004 | 已修复 | 群消息和私聊发送默认 `force=false`，仅显式强制场景绕过普通策略。 |
| GG-BUG-005 | 已修复 | `delete_msg` 失败不再静默伪装成功，错误向上层传播。 |
| GG-BUG-006 | 已修复 | 自身撤回定时器纳入注册表，插件清理时统一取消。 |
| GG-BUG-007 | 已处理 | 超时后的底层 Promise 被持续观察，模糊超时不进入同一队列即时重试；仍需实机确认 OneBot 晚到响应行为。 |
| GG-BUG-008 | 已修复 | 群级退群拉黑写入该群 `groupBlacklist`，只有全局策略写全局黑名单。 |
| GG-BUG-009 | 已修复 | “确认不是管理员”和“管理员状态查询失败”分离；查询失败时不再直接跳过保护流程。 |
| GG-BUG-010 | 已修复 | 业务配置保存失败会抛错；仅后台定时任务捕获并记录健康错误。 |
| GG-BUG-011 | 已修复 | 全量群配置在单一 SQLite 事务中替换，并协调主 JSON 原子写入和文件回滚。 |
| GG-BUG-012 | 已修复 | 全量保存会删除数据库中已不存在的群，删除配置后不再重启复活。 |
| GG-BUG-013 | 已修复 | 审计保留、动作历史、骗子库等数值统一使用有限值规范化。 |
| GG-BUG-014 | 已修复 | 非法群文件正则保留原值供排障，但对应规则自动禁用，严格 fail-closed。 |
| GG-BUG-015 | 已修复 | 群文件状态损坏时备份证据、停用功能并禁止覆盖损坏状态。 |
| GG-BUG-016 | 已修复 | 未配置令牌时生成持久化 0600 token 文件，不再产生管理员无法取得的令牌。 |
| GG-BUG-017 | 已修复 | 请求体按字节限流，超限停止继续接收并返回 HTTP 413。 |
| GG-BUG-018 | 已修复 | WebUI 先规范化，再通过唯一严格保存入口提交；删除原始对象预写和双写。 |
| GG-BUG-019 | 代码已加固，待实机 | 查询端点只接受 localhost、明确私网 IPv4 和本地 IPv6，不再信任单标签或 `.local` DNS 名。 |
| GG-BUG-020 | 已修复 | `uncaughtException` 执行有界清理并以非零状态退出，交由 Docker 拉起新进程。 |
| GG-BUG-021 | 已修复 | `min === max > 0` 时固定延迟正常生效。 |
| GG-BUG-022 | 已修复 | 队列满时拒绝新强制任务，不再淘汰已经排队的旧任务。 |
| GG-BUG-023 | 已修复 | 移除依赖错误字符串大小写的撤回成功猜测，撤回失败统一显式传播。 |
| GG-BUG-024 | 已修复 | 动作 worker 并发不再随当前队首群配置漂移，使用稳定全局策略。 |
| GG-BUG-025 | 已修复 | 入队失败保留 `queue_overflow`、`skip_duplicate`、`bot_role_blocked` 等真实原因。 |
| GG-BUG-026 | 已修复 | StorageAdapter 支持关闭、重新绑定数据目录，插件清理时释放 SQLite。 |
| GG-BUG-027 | 已修复 | 非法 `configVersion` 回退为版本 1 并执行完整迁移。 |
| GG-BUG-028 | 已修复 | 群文件状态保存失败会中断业务并向上抛错，不再报告虚假成功。 |
| GG-BUG-029 | 代码已加固，待实机 | 历史回查只接受目标 `file_id` 强匹配，不再按同名同大小自动撤回。 |
| GG-BUG-030 | 已修复 | 自产上传 Map 每次写入前清理并设置 2000 项硬容量。 |
| GG-BUG-031 | 已修复 | 仅上传者明确等于机器人自身时才消费自产上传去重记录。 |
| GG-BUG-032 | 代码已加固，待实机 | 已连接 socket 的 `error` 会清空连接、拒绝 pending call、关闭 socket 并安排重连。 |
| GG-BUG-033 | 已修复 | connected handlers 串行等待完成，身份刷新结束后连接才被视为准备完成。 |
| GG-BUG-034 | 已修复 | 查询响应流式按字节累计，超过上限立即取消读取。 |
| GG-BUG-035 | 已修复 | 所有 Vite 构建清空输出目录；双产物构建使用独立干净 staging 再合并。 |
| GG-BUG-036 | 代码已修复，待发布包验收 | 运行时版本统一读取编译期 build info，不再寻找 `dist/package.json` 或回退 `1.0.0`。 |
| GG-BUG-037 | 已修复 | 合并转发兜底纳入群发送历史、熔断统计和自身撤回调度。 |
| GG-BUG-038 | 已修复 | 转发包装保留真实 scene，查询和问答使用各自的风控策略。 |
| GG-BUG-039 | 已修复 | 迁移 JSON 损坏时立即中止，不会跳过后仍写“迁移完成”。 |
| GG-BUG-040 | 已修复 | SQLite 群配置损坏时显式报错，不再静默替换为空配置并覆盖证据。 |
| GG-BUG-041 | 已修复 | Standalone debug 日志只调用一次，不再 debug 后又 info。 |
| GG-BUG-042 | 已修复 | README 版本徽章同步为 `1.3.0`。 |
| GG-BUG-043 | 已修复 | 管理主页及所有功能页面在渲染前统一要求 token 鉴权。 |
| GG-BUG-044 | 代码已清理，待最终可达性验收 | 移除退役 video 类型/scene 和公网分片默认值，保留退役功能专项验证。 |

## 4. 生产前必须完成的实机验收

以下验收不应由静态测试代替：

1. SnowLuma 启动后立即注入消息，确认启动缓冲顺序和 bot identity 正确。
2. 制造 OneBot `error` 不立即 `close` 的连接序列，确认自动重连。
3. 上传两个同名同大小文件，确认群文件搬运不会撤回错误消息。
4. 验证 WebUI token 文件权限、登录流程、超大请求 HTTP 413 和页面未授权访问。
5. 在最终发布包检查 build-info、dist 纯净度、退役功能不可达和全部内网查询地址。
6. 模拟动作 API 超时后晚到成功，确认不会执行第二次禁言、踢人或撤回。
7. 模拟管理员查询临时失败，确认黑名单和入群验证保护不会被永久绕过。

## 5. 新发现但不属于原 44 项的依赖告警

CI 的 `npm ci` 输出显示当前完整依赖树存在 `19 moderate / 3 high` 的 npm audit 告警。该数字包含构建、类型和测试依赖，日志没有给出 production-only 明细，因此本次没有使用高风险的 `npm audit fix --force` 自动进行破坏性大版本升级。

这项应单独执行：

- `npm audit --omit=dev --json` 区分生产依赖。
- 对可在现有 semver 范围内修复的项目升级 lockfile 并重新跑全部测试。
- 需要 major upgrade 的项目逐项评估 Jimp/Vite/NapCat 兼容性。

依赖告警不能作为本次 44 项源码缺陷“未修复”的替代解释，也不能在没有 advisory 明细时盲目升级生产依赖。

## 6. 当前发布判断

- **代码审查与自动验证：通过。**
- **PR 合并：暂缓，等待实机验收。**
- **生产部署：未执行。**
- **建议顺序：实机验收 → 审阅 PR #28 → 合并 main → 生成不可变发布包 → 生产安全部署与回滚演练。**
