# GroupGuard 双任务只读诊断交接

更新时间：2026-07-31 14:42 +08:00  
状态：`awaiting_readonly_diagnosis_execution_v3`  
工作分支：`codex/gg-battle-delivery-diagnosis-20260731`

当前任务：

```text
GG-BATTLE-DELIVERY-001  战绩图片交付插件端只读链路诊断
GFM-DELETE-002          群文件假缺失原始列表只读诊断
```

## 1. 固定边界

- 当前生产宿主：SnowLuma；通信层：OneBot。
- LOLDataSystem P009 已证明接口可以返回 `image/png` segment，图片字节 373591，无接口端文字降级。
- 不得重复修改 5001/6178，不得先修改 6108 或生产配置。
- 未经授权不得重启、构建、部署或合并 main。

## 2. v2 已取得的有效证据

用户运行 v2 包并上传 `reports(1).zip`。生产前后关键文件 SHA-256 完全一致，容器始终 running，`restart_count=0`：

```text
production_modified=false
service_restarted=false
build_executed=false
deployment_executed=false
git_updated=false
```

真实战绩日志：

```text
commandId=builtin.query.battle.intranet
plugin_resolution ok=true
command type=success
latency=2894ms
plugin_execution_result ok=true
forward_send_direct source=response_capture_runtime group=805402626 scene=external_query
```

这说明：

1. 新的内网战绩插件成功命中；
2. 请求和插件执行成功；
3. 没有记录到 delivery/Base64 解析错误；
4. 最终走的是合并转发路径，不是请求失败后的文字兜底；
5. 实际测试群号为 `805402626`，旧包默认的 `960957757` 不对应本次真实查询。

高概率判断：该群的实际输出偏好是 `forward`，但尚缺少配置字段的直接读取证据，所以战绩最终 A 结论仍需 v3 确认。

## 3. v2 失败原因

OneBot/config 探针通过 stdin 在 `/app/[eval1]` 执行，并尝试：

```js
import { WebSocket } from 'undici';
```

容器根目录无法解析该包，导致：

```text
ERR_MODULE_NOT_FOUND: Cannot find package 'undici' imported from /app/[eval1]
```

探针输出成为 `{}`。PowerShell 随后在 StrictMode 下访问不存在的 `$probe.battle` 属性，再次中止。

两个问题都属于诊断包缺陷，不是生产 GroupGuard 服务缺陷。生产服务在同一时间正常处理了真实战绩查询。

详细记录：

```text
docs/READONLY_DIAGNOSIS_V2_PARTIAL_RESULT_20260731.md
```

## 4. 主机性能观察

```text
宿主 load average: 7.44-7.70
可用内存: 699-715 MB
容器 CPU: 0.00%-1.45%
容器内存: 76.95-79.24 MiB
容器重启: 0
战绩命令耗时: 2894ms
```

宿主负载偏高，但 GroupGuard 容器占用低且请求成功完成。当前证据不支持把战绩交付或 GFM 假缺失归因于盒子性能。

## 5. GFM 仍未取得的证据

v2 探针未启动，因此还没有：

```text
get_group_root_files/get_group_files_by_folder 原始结构
三次列表快照
file_id 精确/规范化比较
文件名和大小候选比较
0ms/1500ms/5000ms 可见性变化
```

GFM 仍需在以下结论中选一：

```text
list_structure_mismatch
id_format_mismatch
list_visibility_delay_or_inconsistency
insufficient_historical_state
```

## 6. v3 诊断包

```text
GroupGuard-GFM-DELETE-002-GG-BATTLE-DELIVERY-001-readonly-diagnosis-kit-v3.zip
SHA-256: b19b8b947b06a0df9a16f6d646cd2244a9ee2affa1eb49f84b1ef542cf81daf0
```

v3 修复：

- 使用 Node 22 内置 `WebSocket`，不再导入 `undici`；
- PowerShell 安全读取可选属性；
- 探针失败也会继续生成最终报告；
- 记录 `forward_send_direct`；
- 启动时询问真实查战绩群号。

## 7. 下一步

运行 v3：

```text
run-readonly-groupguard-diagnosis.cmd
```

看到群号提示时输入：

```text
805402626
```

然后按提示在该群执行一次真实“查战绩”，结果出现后按回车。最后上传：

```text
reports\groupguard-readonly-diagnosis-<timestamp>.zip
```

收到后必须：

1. 校验前后哈希；
2. 读取实际群的 `resolved_preferred` 和来源；
3. 对战绩给出 A/B/C/D/E 单一结论；
4. 读取 GFM 三次列表并给出结构、ID、延迟或历史状态不足的单一结论；
5. 未经授权不修改生产、不部署、不合并 main。
