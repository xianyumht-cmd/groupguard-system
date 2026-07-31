# GroupGuard 全仓 Bug 审计与缺陷台账（2026-08-01）

## 0. 修复执行状态

- 修复分支：`fix/project-wide-bugs-20260801`
- 状态：代码修复已应用，等待 CI 与真实 SnowLuma/QQ 环境验收。
- 原则：源码可确认项必须有自动回归；环境依赖项在未实机验收前保持“待验证”，不得伪报已闭环。

> 审计基线：`main@98edb1fc2eef2ade4e1f771e8cf4479cdd6c6f70`  
> 审计对象：`xianyumht-cmd/groupguard-system`，重点覆盖 `onebot-plugin-groupguard` 的 SnowLuma 独立运行、OneBot 通信、消息/事件流水线、动作队列、配置与 SQLite 持久化、群文件搬运、查询协议、WebUI 与构建发布。  
> 结论口径：本文记录的是本轮静态审查已经定位到的全部缺陷，不宣称软件从此“绝对没有其他 Bug”。凡未经过真实 SnowLuma/NapCat/QQ 环境复现的条目均明确标记为“需实机验证”。

## 1. 审计结论

| 等级 | 数量 | 说明 |
|---|---:|---|
| P0 | 0 | 未发现可直接远程接管生产环境或立即破坏全部数据的已证实漏洞 |
| P1 | 20 | 可导致验证绕过、错误群管动作、配置/状态丢失、服务不可恢复或安全边界失效 |
| P2 | 20 | 可导致功能失真、错误重试、内存增长、跨群干扰、构建污染或难以排障 |
| P3 | 4 | 日志、文档、暴露面与历史残留问题 |
| **合计** | **44** | 其中 39 项可由源码直接确认，5 项需在真实运行环境完成最后复现 |

### 当前最先应修的 8 项

1. `GG-BUG-004`：普通发送默认被当作强制发送，绕过概率、熔断和正常队列语义。
2. `GG-BUG-009`：机器人管理员查询临时失败时，新成员会直接跳过黑名单处置和入群验证。
3. `GG-BUG-012`：删除群专属配置后 SQLite 旧记录不删除，重启会“复活”。
4. `GG-BUG-007`：动作超时不会取消底层请求，随后重试可能重复禁言、踢人或撤回。
5. `GG-BUG-011`：主 JSON 与群 SQLite 分步提交，失败时产生半保存状态。
6. `GG-BUG-014`：群文件规则的非法正则被静默改成空正则，实际会匹配全部文件。
7. `GG-BUG-018`：WebUI 先直接覆盖原始配置，再规范化和二次保存，失败可留下损坏配置。
8. `GG-BUG-019`：所谓“仅内网地址”校验允许任意单标签主机名，未校验 DNS 最终地址。

## 2. P1 高优先级缺陷

### GG-BUG-001：OneBot 事件可能在插件初始化完成前进入业务流水线

- **位置**：`src/standalone/snowluma_service.ts`，`start()`。
- **状态**：已确认。
- **证据**：代码先注册 `client.onEvent(...)`，随后 `await client.start()`，最后才 `await plugin_init(ctx)`。WebSocket 一旦连通，消息可以在配置、SQLite、授权、命令注册和后台服务尚未初始化时调用 `plugin_onmessage/plugin_onevent`。
- **影响**：启动瞬间随机报错、消息漏处理、数据库未初始化、错误配置判断，严重时形成不可重复的生产竞态。
- **修复**：先完成 `plugin_init`，再启用事件消费；或增加显式启动闸门和有界启动缓冲区。
- **回归测试**：模拟 WebSocket `open` 后立即发送消息，断言初始化完成前业务处理器不执行。

### GG-BUG-002：动态命令初始化未被 `plugin_init` 等待

- **位置**：`src/commands.ts` 的 `initCommandValidation()`；`src/index.ts` 的 `plugin_init()`。
- **状态**：已确认。
- **证据**：`initializeDynamicCommands()` 通过 `void ...then(...)` 后台启动，`plugin_init` 随即继续并输出“初始化完成”。
- **影响**：刚启动时命令注册表、插件注册表和指标表可能尚未可用，首批命令随机失效。
- **修复**：把初始化函数改为返回 `Promise<void>`，由 `plugin_init` 严格 `await`。

### GG-BUG-003：动态命令初始化失败后永久禁止重试

- **位置**：`src/commands.ts` 的 `commandValidationRan`。
- **状态**：已确认。
- **证据**：函数进入时先将 `commandValidationRan = true`，异步链没有 `.catch()`；任一步失败既会形成未处理拒绝，又不会把标记复位。
- **影响**：一次临时文件或数据库错误即可让动态命令在本次进程生命周期内永久处于半初始化状态，只能重启恢复。
- **修复**：使用单例初始化 Promise；失败时记录、复位并允许受控重试。

### GG-BUG-004：群消息默认 `force=true`，大面积绕过风控

- **位置**：`src/state.ts` 的 `sendGroupText()`、`sendGroupMsg()`、`processTask()`。
- **状态**：已确认。
- **证据**：`const force = options?.force !== false` 使未传参数时默认为强制发送；而发送概率和群熔断仅在 `!force` 时生效。
- **影响**：大多数正常回复绕过 `replyProbability` 和群熔断；高负载时也会走强制队列语义，和配置页面展示的风控策略不一致。
- **修复**：默认 `force=false`；只允许少数明确的管理通知显式强制发送。
- **回归测试**：默认发送必须受概率与熔断控制，显式 `force:true` 才绕过。

### GG-BUG-005：`delete_msg` 失败被静默当作已处理

- **位置**：`src/state.ts` 的 `callApi()`。
- **状态**：已确认。
- **证据**：`delete_msg` 的权限不足、网络错误、目标仍存在等失败最终均返回 `null`；重试失败也直接假定“已处理或失效”。
- **影响**：上层无法区分撤回成功和撤回失败，风控记录与真实群状态不一致，违规消息可能仍在群内。
- **修复**：返回结构化结果或抛出明确错误；仅对经过二次查询确认“消息不存在”的场景视为成功。

### GG-BUG-006：自身撤回定时器无法在卸载/热更新时取消

- **位置**：`src/state.ts` 的 `scheduleSelfRecall()`；`src/index.ts` 的 `plugin_cleanup()`。
- **状态**：已确认。
- **证据**：每条自身撤回直接创建裸 `setTimeout`，没有保存句柄；清理函数无法取消这些任务。
- **影响**：插件卸载或热更新后，旧实例仍可能执行撤回动作；重复加载时可能出现双重动作。
- **修复**：统一使用可停止调度器，或只依赖可恢复的持久化动作队列。

### GG-BUG-007：动作超时只结束等待，不取消真实动作

- **位置**：`src/services/action_queue_service.ts` 的 `executeWithTimeout()` 与重试逻辑。
- **状态**：已确认。
- **证据**：`Promise.race` 超时后底层 `safeRecall/safeBan/safeKick/callApi` 仍继续运行；队列随后可能重试同一动作。
- **影响**：同一用户可能被重复禁言/踢出，同一消息重复撤回；第一次请求晚到成功时，审计记录仍可能写成超时失败。
- **修复**：向通信层传递 `AbortSignal`；不能取消的动作应先查询最终状态再决定是否重试，并使用幂等键。

### GG-BUG-008：某群“退群拉黑”错误写入全局黑名单

- **位置**：`src/runtime/runtime_event_pipeline.ts` 的 `group_decrease/leave` 分支。
- **状态**：已确认。
- **证据**：无论启用的是全局 `leaveBlacklist` 还是群级 `settings.leaveBlacklist`，代码都写入 `config.blacklist`。
- **影响**：成员只退出一个群，却会在所有已授权群中被全局拉黑。
- **修复**：群级策略应写入该群的 `groupBlacklist`；仅全局策略写入 `config.blacklist`。

### GG-BUG-009：管理员状态查询失败会绕过入群验证与黑名单处置

- **位置**：`src/runtime/runtime_event_pipeline.ts` 的 `group_increase`；`src/state.ts`/通信适配器的错误吞并。
- **状态**：已确认。
- **证据**：`isBotAdmin()` 在任何 API 异常时返回 `false`；事件流水线随即 `return`，不创建验证会话、不处理黑名单，也没有重试或补偿任务。
- **影响**：OneBot 短暂断线或超时时，新成员可永久绕过本次验证，黑名单成员也可能留在群内。
- **修复**：将“不是管理员”和“查询失败”分开；查询失败时进入持久化补偿队列并告警。

### GG-BUG-010：普通 `saveConfig()` 吞掉所有持久化异常

- **位置**：`src/commands/common.ts` 的 `saveConfig()`。
- **状态**：已确认。
- **证据**：异常只写日志，函数返回 `void`；调用方无法获知失败。
- **影响**：命令或定时保存可向用户显示成功，但重启后配置丢失。
- **修复**：业务写入统一调用严格版本并传播错误；仅后台定时任务可以捕获后转为健康告警。

### GG-BUG-011：主配置与群配置不是一个原子事务

- **位置**：`src/commands/common.ts` 的 `saveConfigStrict()`；`src/storage_adapter.ts` 的 `saveGroupConfigs()`。
- **状态**：已确认。
- **证据**：先替换主 `config.json`，再逐群写 SQLite；SQLite 写入失败不会回滚已经替换的 JSON，多群写入也各自独立提交。
- **影响**：磁盘主配置、SQLite 群配置和内存配置可能分别处于不同版本，重启结果不可预测。
- **修复**：先在单一 SQLite 事务内写全部群配置，再原子替换 JSON；失败时恢复内存快照和文件备份。

### GG-BUG-012：删除群配置后旧 SQLite 记录会在重启时复活

- **位置**：`src/standalone/admin/group_api.ts` 的 `deleteGroupConfig()`；`src/storage_adapter.ts` 的 `saveGroupConfigs()`/`loadAllGroupConfigs()`。
- **状态**：已确认。
- **证据**：删除只移除内存对象；`saveGroupConfigs` 只 upsert 仍存在的群，从不删除数据库中缺失的群；启动时又加载全部数据库记录。
- **影响**：WebUI 显示删除成功，但服务重启后群专属配置重新出现。
- **修复**：提供 `deleteGroupConfig(groupId)` 数据库操作；全量保存时在同一事务删除不再存在的群。

### GG-BUG-013：非法数字配置会被规范化为 `NaN`，落盘变成 `null`

- **位置**：`src/config.ts` 的 `normalizePluginConfig()` 中审计保留、动作历史、骗子库等直接 `Number()` + `Math.min/max` 的字段。
- **状态**：已确认。
- **证据**：对非数字字符串，`Number()` 得到 `NaN`，`Math.min/max` 仍为 `NaN`；`JSON.stringify` 会把它写成 `null`。
- **影响**：一次错误输入可污染运行态和配置文件，后续比较、SQL 限制或 UI 展示异常。
- **修复**：所有数字字段统一走 `normalizeNumber()` 并提供有限默认值。

### GG-BUG-014：群文件名称正则非法时会“匹配全部文件”

- **位置**：`src/services/group_file_mirror_service.ts` 的 `normalizeGroupFileMirrorConfig()`。
- **状态**：已确认。
- **证据**：非法正则被改为 `''`；而空模式在 `fileEventMatchesRule()` 中表示不做文件名限制。
- **影响**：手工编辑配置时一个正则拼写错误，可能把来源群全部文件搬到目标群。
- **修复**：配置应 fail-closed：拒绝整份保存/禁用该规则并输出明确错误，不能扩大匹配范围。

### GG-BUG-015：群文件状态文件损坏时直接清空状态且不备份

- **位置**：`src/services/group_file_mirror_service.ts` 的 `ensureStateLoaded()`。
- **状态**：已确认。
- **证据**：JSON 解析失败后仅警告并从 `{rules:{}}` 继续；下一次保存会覆盖原文件。
- **影响**：丢失当前映射与 `pendingCleanup`，旧目标文件和消息成为无法自动清理的孤儿。
- **修复**：停止该功能、备份损坏文件、尝试最近快照；绝不能自动覆盖唯一证据。

### GG-BUG-016：未配置 WebUI Token 时生成了无法获得的临时令牌

- **位置**：`src/standalone/admin/server.ts` 的 `resolveServerConfig()` 与启动日志。
- **状态**：已确认。
- **证据**：服务随机生成 token，但明确“不记录”；调用方也没有把 `runtime.token` 显示或持久化给管理员。
- **影响**：WebUI 页面可以打开，所有 API 永久返回 401，只能重启并配置环境变量后恢复。
- **修复**：生产环境缺少 token 时拒绝启动；开发模式可一次性打印到受保护终端或写入权限 0600 文件。

### GG-BUG-017：请求体超限后仍持续接收，存在内存消耗风险

- **位置**：`src/standalone/admin/http.ts` 的 `readBody()`。
- **状态**：已确认。
- **证据**：超过 5 MB 时只调用 `reject()`，没有停止拼接、移除监听或销毁请求流。
- **影响**：持有合法 token 的错误客户端或攻击者可持续发送大请求占用内存和事件循环。
- **修复**：达到上限立即 `req.destroy()` 或停止读取，并返回 413；按字节而不是 JS 字符数计数。

### GG-BUG-018：WebUI 保存配置先覆盖原文件，校验与规范化发生在后面

- **位置**：`src/standalone/admin/config_api.ts`、`json_file.ts`。
- **状态**：已确认。
- **证据**：`saveRawConfig()` 先用非原子 `writeFileSync` 写入用户原始对象，随后才 `normalizePluginConfig`、更新内存并调用第二套保存流程。
- **影响**：规范化或 SQLite 保存中途失败时，磁盘可能已经留下未规范化或截断配置，内存和数据库仍是另一版本。
- **修复**：先在内存完成验证和规范化，再通过单一事务式保存入口提交；删除重复写入。

### GG-BUG-019：“仅内网查询地址”校验可被单标签 DNS 主机名绕过

- **位置**：`src/services/groupguard_query_delivery_client.ts` 的 `isIntranetHostname()`。
- **状态**：已确认校验缺陷；最终可利用性需按生产 DNS 实机验证。
- **证据**：任意 `/^[a-z0-9-]+$/` 单标签主机名都被视为内网，不解析并验证最终 A/AAAA 地址，也不防 DNS rebinding。
- **影响**：配置被污染时，插件可能向公网或敏感内部管理地址发送查询请求，破坏“插件只访问固定内网接口”的架构边界。
- **修复**：解析全部地址并逐个验证私网网段；连接后复核实际远端地址；最好使用固定 allowlist。

### GG-BUG-020：捕获 `uncaughtException` 后继续运行损坏进程

- **位置**：`src/standalone/snowluma_service.ts` 的进程级异常处理。
- **状态**：已确认。
- **证据**：处理器只记录日志，不关闭服务或退出。
- **影响**：出现未知同步异常后，进程可能带着部分修改、失效锁或损坏状态继续处理群消息。
- **修复**：记录后执行有界清理并非零退出，由 Docker 重启；不可把未知异常当作可恢复错误。

## 3. P2 中优先级缺陷

### GG-BUG-021：固定随机延迟配置完全不生效

- **位置**：`src/state.ts` 的 `randomSleep()`。
- **状态**：已确认。
- **证据**：仅当 `max > min` 时睡眠；配置 `min === max > 0` 时直接返回 0。
- **影响**：管理员设置固定发送间隔后，实际没有延迟，增加风控风险。

### GG-BUG-022：默认强制任务在队列满时会淘汰更早任务

- **位置**：`src/state.ts` 的 `enqueueGroupTask()`。
- **状态**：已确认。
- **证据**：强制任务满队列时 `shift()` 最旧任务；结合 `GG-BUG-004`，普通消息也默认走该路径。
- **影响**：高峰期较早排队的回复被无提示丢弃，后来的消息反而先保留。

### GG-BUG-023：SnowLuma 超时错误名称与撤回重试判断不匹配

- **位置**：`src/state.ts` 的 `callApi()`；`src/standalone/onebot_ws_client.ts`。
- **状态**：已确认。
- **证据**：撤回逻辑搜索大小写敏感的 `Timeout`，而客户端抛出 `onebot_action_timeout`。
- **影响**：本来设计的撤回超时重试在 SnowLuma 主路径不会触发。

### GG-BUG-024：动作队列并发数由当前队首所属群决定

- **位置**：`src/services/action_queue_service.ts` 的 `kickWorkers()`。
- **状态**：已确认。
- **证据**：并发上限取 `getConcurrency(queue[0]?.groupId)`，不是全局策略，也不是每群独立上限。
- **影响**：一个群的配置会临时改变所有群的动作并发；队首变化时已有 worker 也不会收缩。

### GG-BUG-025：禁言/踢人入队失败被错误标成“限流”

- **位置**：`src/services/action_queue_service.ts` 的 `enqueueBanAction()`、`enqueueKickAction()`。
- **状态**：已确认。
- **证据**：除 `backpressure_reject` 外，`queue_overflow`、`skip_duplicate`、`bot_role_blocked` 等均返回 `skip_rate_limited`。
- **影响**：WebUI、审计和上层策略无法判断真实失败原因，错误重试和排障困难。

### GG-BUG-026：StorageAdapter 热更新后仍绑定旧数据库

- **位置**：`src/storage_adapter.ts` 的 `init()`。
- **状态**：已确认。
- **证据**：`inited` 后无条件返回，没有 `close/reset/rebind`；插件清理也未关闭数据库。
- **影响**：热更新或修改 `GROUPGUARD_DATA_DIR` 后仍读写旧路径，并可能长期占用文件锁。

### GG-BUG-027：非法 `configVersion` 会跳过全部迁移

- **位置**：`src/config.ts` 的 `normalizePluginConfig()`。
- **状态**：已确认。
- **证据**：`Number(configVersion)` 得到 `NaN` 后，所有 `inputVersion < N` 判断均为 false。
- **影响**：损坏或手工填写的版本号会让旧配置跳过必要默认字段迁移。

### GG-BUG-028：群文件状态保存失败只记日志，业务仍报告成功

- **位置**：`src/services/group_file_mirror_service.ts` 的 `saveState()` 与 `mirrorUpload()`。
- **状态**：已确认。
- **证据**：状态写入异常被内部吞掉；搬运流程继续清理并输出“已搬运”。
- **影响**：本次运行看似成功，进程重启后却失去映射和待清理任务。

### GG-BUG-029：目标文件消息回查可能命中同名同大小的无关消息

- **位置**：`src/services/group_file_mirror_service.ts` 的 `findMessageIdInHistory()`。
- **状态**：算法缺陷已确认；需实机制造同名文件完成最终复现。
- **证据**：历史消息文件段不含目标 `file_id` 时，代码退化为只比对文件名和大小。
- **影响**：后续“撤回旧文件消息”可能撤回另一位成员上传的同名文件消息。
- **修复**：无法用强标识确认时禁止自动撤回，只保留文件删除或人工处理。

### GG-BUG-030：自产上传去重表在宿主不发 `group_upload` 时持续增长

- **位置**：`src/standalone/snowluma_service.ts` 的 `generatedFileUploads`。
- **状态**：已确认。
- **证据**：过期项只在消费下一条 `group_upload` 时清理；已知 SnowLuma 环境可能不产生该 notice。
- **影响**：长期搬运大量不同文件名时 Map 持续增长。
- **修复**：独立定时清理或每次写入前清理，并设置硬容量。

### GG-BUG-031：自产上传去重键过弱，会误吞同名他人上传事件

- **位置**：`src/standalone/snowluma_service.ts` 的 `generatedUploadKey()`。
- **状态**：已确认。
- **证据**：键只有 `groupId + fileName`，没有文件 ID、上传者、大小或关联 ID。
- **影响**：两分钟窗口内他人上传同名文件，其 `group_upload` 可能被误认为镜像自产事件并跳过观察。

### GG-BUG-032：已连接 WebSocket 发生 `error` 但不 `close` 时不会重连

- **位置**：`src/standalone/onebot_ws_client.ts` 的 `bindSocket()`。
- **状态**：需实机验证具体 Undici/WebSocket 事件序列。
- **证据**：连接后的 `error` 监听器只记录；清空连接和安排重连只在 `close` 事件中执行。
- **影响**：若底层只发 error 或 close 延迟，客户端可能长期保持假连接状态。

### GG-BUG-033：连接成功回调不等待，身份刷新与消息处理存在竞态

- **位置**：`src/standalone/onebot_ws_client.ts` 的 connected handlers；`snowluma_service.ts` 的 `refreshBotIdentity()`。
- **状态**：已确认。
- **证据**：回调通过 `void Promise.resolve(handler())` 并发启动，消息监听已启用。
- **影响**：首批自身消息可能在 bot ID 为空时被当作普通成员消息，转发节点也可能使用用户 ID `0`。

### GG-BUG-034：查询响应上限在完整读取后才按字符检查

- **位置**：`src/services/groupguard_query_delivery_client.ts` 的 `requestGroupGuardQueryDelivery()`。
- **状态**：已确认。
- **证据**：无可靠 `Content-Length` 时先 `response.text()` 全量载入内存，再检查 `text.length`；字符数也不等于 UTF-8 字节数。
- **影响**：异常上游可制造远超 16 MB 实际字节的响应，造成峰值内存压力。
- **修复**：流式累计字节并达到上限立即取消。

### GG-BUG-035：SnowLuma 构建不清空 `dist`，残留旧 chunk

- **位置**：`vite.config.ts` 的 `emptyDirBeforeWrite: !isSnowLuma`。
- **状态**：已确认。
- **影响**：连续构建会积累旧 chunk/资产；不严谨的打包或部署脚本可能把过期代码一起发布，难以证明产物纯净。
- **修复**：每次构建使用干净 staging 目录，再原子生成发布包。

### GG-BUG-036：运行时版本可能永久回退为 `1.0.0`

- **位置**：`src/state.ts` 的 `getPluginVersion()`；`vite.config.ts`。
- **状态**：构建配置已确认，需按最终发布包检查是否额外复制 `dist/package.json`。
- **证据**：运行时代码从入口同目录读取 `package.json`，Vite 构建插件未复制该文件，失败后固定返回 `1.0.0`。
- **影响**：WebUI/日志版本与真实构建不一致，影响事故定位。
- **修复**：直接使用编译期 `buildInfo.version`，不要运行时猜路径。

### GG-BUG-037：合并转发兜底发送不进入熔断历史，也不安排自身撤回

- **位置**：`src/state.ts` 的 `sendGroupForwardFallback()`。
- **状态**：已确认。
- **影响**：大量兜底发送不会增加 `groupSendHistory`，可能持续绕过群熔断；开启自身撤回时，兜底消息长期留在群内。

### GG-BUG-038：发送包装器把所有转发消息风险场景硬编码为 `raw_text`

- **位置**：`src/core/state-infra/plugin_state_context_adapter.ts` 的 `sanitizeSendParams()`。
- **状态**：已确认。
- **影响**：查询、问答等场景的独立 URL/风控策略在 `send_group_forward_msg` 上失效或套用错误策略。

### GG-BUG-039：JSON 迁移可静默跳过损坏文件后仍标记“迁移完成”

- **位置**：`src/storage_adapter.ts` 的 `readJsonFile()` 与 `migrateFromJson()`。
- **状态**：已确认。
- **证据**：解析失败返回 `null`，迁移流程继续，末尾无条件 `markMigrated()`。
- **影响**：损坏的群配置、签到、邀请等旧数据被永久跳过，后续启动不再尝试迁移。
- **修复**：任一输入损坏都应中止并输出文件清单；只在全部成功后写迁移标记。

### GG-BUG-040：SQLite 中损坏的群配置被静默替换为空对象

- **位置**：`src/storage_adapter.ts` 的 `loadAllGroupConfigs()`。
- **状态**：已确认。
- **证据**：`config_json` 解析异常时直接 `cfg = {}`，没有备份、隔离或错误状态。
- **影响**：损坏证据被隐藏，群配置会以默认值继续运行并可能被后续保存覆盖。

## 4. P3 低优先级缺陷

### GG-BUG-041：Standalone 调试日志会重复输出

- **位置**：`src/standalone/standalone_context.ts` 的 `createLoggerShim()`。
- **状态**：已确认。
- **证据**：`logger.debug?.(message) ?? logger.info(message)`；`console.debug()` 返回 `undefined`，因此随后又执行 `console.info()`。

### GG-BUG-042：README 版本徽章与实际包版本不一致

- **位置**：根 `README.md` 与 `onebot-plugin-groupguard/package.json`。
- **状态**：已确认。
- **现状**：README 显示 `1.2.14`，包版本为 `1.3.0`。

### GG-BUG-043：管理页面 HTML 无鉴权即可访问并暴露产品指纹

- **位置**：`src/standalone/admin/server.ts`。
- **状态**：已确认。
- **说明**：API 有 token 保护，但主页、QA、查询、Q群管家、群文件搬运页面在鉴权前返回。
- **影响**：对外绑定时可被未授权用户识别服务类型、功能和接口路径。

### GG-BUG-044：已退役功能和公网配置字段仍残留在类型、默认配置和场景判断中

- **位置**：`src/config.ts`、`src/services/groupguard_query_delivery_client.ts`、`src/core/state-infra/plugin_state_context_adapter.ts` 等。
- **状态**：已确认残留；当前主链是否可重新触发需继续做可达性测试。
- **示例**：`video`/`video_query`、旧 `shardDataUrl` 公网默认值、旧骗子查询 URL 字段。
- **影响**：增加维护歧义，未来重构时可能误把已禁止的外部请求路径重新接回生产。

## 5. 当前测试覆盖缺口

现有测试数量很多，但本轮缺陷说明以下场景没有被有效锁住：

1. SnowLuma 启动顺序与“连接后立即来消息”的竞态测试。
2. 动态命令初始化失败、重试和部分初始化回滚测试。
3. 持久化故障注入：磁盘只读、SQLite 中途失败、rename 失败、多群半保存。
4. 删除群配置后重启不得复活的端到端测试。
5. OneBot 管理员查询超时后，入群验证必须补偿执行的测试。
6. 动作超时后底层晚到成功、禁止重复执行的幂等测试。
7. 群文件非法正则、损坏状态、同名同大小文件、无 `group_upload` notice 的长期测试。
8. WebUI 超大请求体必须立即断流并返回 413 的测试。
9. 查询服务 DNS 解析后仍必须为私网地址的安全测试。
10. 纯净目录构建与发布包版本一致性测试。

## 6. 建议修复批次

### 批次 A：生产安全止血

`GG-BUG-004/005/007/008/009/012/014/016/019/020`

完成标准：所有项目测试通过，并新增对应故障注入或端到端回归；未完成前不建议继续扩大群数量。

### 批次 B：配置与状态一致性

`GG-BUG-010/011/013/015/018/026/027/028/039/040`

完成标准：配置保存具备单一事务入口、失败可回滚、损坏文件有备份、群配置删除不会复活。

### 批次 C：并发与通信可靠性

`GG-BUG-001/002/003/006/021/022/023/024/025/030/031/032/033/034/037/038`

完成标准：启动有闸门，所有后台初始化可等待/重试，超时动作可取消或幂等，缓存和队列均有硬边界。

### 批次 D：构建与清理

`GG-BUG-035/036/041/042/043/044`

完成标准：发布包来自空目录，版本信息单一来源，退役功能从生产类型与配置中移除。

## 7. 审计边界与后续验证

- 本轮通过 GitHub 仓库接口逐文件只读审查，未修改生产服务器，也未执行部署。
- 当前执行环境没有该私有仓库的本地工作树，因此没有在本机运行完整 `npm test`；文档中的“已确认”表示代码路径本身足以证明缺陷。
- `GG-BUG-019/029/032/036/044` 需要结合生产 DNS、SnowLuma 事件序列、最终发布包和真实群消息进一步确认影响范围。
- 建议后续每修一个编号，就在本文件追加：修复提交、测试名称、实机证据、部署时间和回滚点；不要删除历史条目。
