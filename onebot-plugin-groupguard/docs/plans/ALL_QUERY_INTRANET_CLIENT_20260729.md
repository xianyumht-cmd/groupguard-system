# GroupGuard 全查询内网客户端迁移计划（2026-07-29）

> 计划 ID：`GGK-ALL-QUERY-HUB-20260729`  
> 仓库：`xianyumht-cmd/groupguard-system`  
> 对接服务：`xianyumht-cmd/lolapisevers`  
> 当前状态：`executing`  
> 目标：SnowLuma GroupGuard 只负责命令入口、权限、限流、内网请求、协议校验和 OneBot 发送；所有内置业务查询由 Windows 接口完成。

## 1. 当前生产状态

- `查合集` 已迁移到 `POST /api/v1/groupguard/query`；
- Windows 接口运行提交 `8de85a855b8338c3a9a69cbb2a937cd0a6ef8b82`；
- ARM 已替换最新 `dist`；
- `查合集 滑板鞋` 真人验收通过；
- 当前生产版本继续保留，不因后续批次回滚。

## 2. 全查询清单

| 群命令 | feature | 当前实现 | 目标 |
|---|---|---|---|
| 查合集 | shard | 已调用内网最终交付 | 保持 |
| 海符榜 | aram | 插件请求图片/JSON并决定降级 | 改为一次内网最终交付请求 |
| 查封号 | lolban | 插件维护 Provider 列表、解析状态和生成文案 | 改为一次内网最终交付请求 |
| 查战绩 | battle | 插件读取 `/cross_query` pretty、分页、图片探测与降级 | 服务返回最终交付 |
| 查隐藏 | hidden | 插件持有 Key/Token、访问公网、解析与格式化 | 全部迁入服务 |
| 我要看 | video | 插件持有公网模板、请求并解析直链 | 全部迁入服务 |
| 查骗子 | scammer | 插件合并本地库与第三方 Provider | 共享风险服务返回最终交付 |
| 查同行 | peer | 插件本地库为唯一事实源 | 共享风险服务返回最终交付 |
| 举报骗子 | scammer_report | 插件本地写入及可选公网同步 | 写入共享风险服务 |
| 举报同行 | peer_report | 插件本地写入 | 写入共享风险服务 |

纯群管控制和 QQ 会话本地功能（签到、积分、邀请统计、管理员权限、实时群成员信息）不属于本计划。

## 3. 插件允许职责

- 匹配命令；
- 提取最小原始参数和 @ 目标 QQ；
- 执行群开关、许可、权限和限流；
- 生成 `request_id`；
- 调用内网接口；
- 严格校验交付协议；
- 将最终文本、图片或转发节点转换为 OneBot 发送动作；
- 记录传输耗时和安全错误标签。

## 4. 插件禁止职责

- 保存公网 Provider Token、Cookie、Key 或业务 URL；
- 访问 GitHub Raw、腾讯静态资源、OP.GG、lolso1 或视频/骗子公网 Provider；
- 解析业务 JSON/HTML；
- 维护英雄别名、状态判断、排序、分页、推荐、风控合并等业务规则；
- 决定图片失败后的业务降级；
- 维护需要被未来官方机器人共享的业务数据库；
- 内网失败后直连公网兜底。

## 5. 执行步骤

### GG-AQ-DOC-001

状态：`completed`

交付本文档与 JSON 状态文件，并同步接口仓全查询计划。

### GG-AQ-FAST-001：海符榜与查封号

状态：`in_progress`

- 扩展统一内网运行插件，注册 `海符榜` 和 `查封号`；
- `海符榜` 只上传原始英雄文本；
- `查封号` 只上传解析后的 QQ；
- 两项均只请求一次内网接口；
- 移除旧互动模块对这两个命令的触发声明；
- 旧业务代码暂保留为不可达迁移代码，禁止重新注册；
- 增加 CI 门禁验证无公网回退。

### GG-AQ-BATTLE-001

状态：`blocked_by_service_feature`

等待接口提供 `battle` 最终交付，然后删除插件端 pretty 解析、分页、图片探测和降级。

### GG-AQ-HIDDEN-001

状态：`blocked_by_service_feature`

等待接口提供 `hidden` 最终交付，然后删除插件中的 `lolQueryUrl/lolAuthKey/lolToken` 业务调用与公网请求。

### GG-AQ-VIDEO-001

状态：`blocked_by_service_feature`

等待接口提供 `video` 最终交付，然后移除插件视频 Provider 模板和直链解析。

### GG-AQ-RISK-001

状态：`blocked_by_service_feature_and_data_migration`

等待共享风险 API 和迁移工具，随后停止插件本地风险库作为事实源。

### GG-AQ-DYNAMIC-001

状态：`planned`

所有属于外部业务查询的动态 HTTP Provider 必须改为内网代理；没有 ADR 的公网查询不得通过发布门禁。

### GG-AQ-GATE-001

状态：`planned`

门禁要求：

- 正式内置查询运行路径无公网业务域名；
- Provider 凭据不出现在 SnowLuma 配置；
- 管理测试器与群命令复用同一内网客户端；
- 每个 feature 一次请求；
- 协议错误或网络失败不触发第二次请求；
- 完整 `npm test`、SnowLuma build 和双仓契约通过。

## 6. 发布顺序

每个 feature 都必须：

```text
接口代码 + 测试
  -> 接口生产部署与验证
  -> GroupGuard 代码 + 测试
  -> SnowLuma dist 部署
  -> 真人群命令验收
  -> 更新两仓机器状态
```

不得把未部署的接口 feature 先发到 SnowLuma，也不得恢复插件端公网兜底。
