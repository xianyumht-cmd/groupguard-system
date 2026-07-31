# GroupGuard 双任务只读诊断 v2 部分结果

时间：2026-07-31 14:36-14:38 +08:00  
任务：`GG-BATTLE-DELIVERY-001`、`GFM-DELETE-002`

## 1. 安全结果

生产前后以下文件 SHA-256 完全一致：

```text
/app/dist/snowluma-service.mjs
/app/dist/build-info.json
/app/config/config.json
/app/config/group-file-mirror.json
/app/data/group-file-mirror-state.json
```

容器：

```text
status=running
restart_count=0
```

因此：

```text
production_modified=false
service_restarted=false
build_executed=false
deployment_executed=false
git_updated=false
```

## 2. v2 探针失败原因

`probe-onebot-readonly.mjs` 从标准输入在容器 `/app/[eval1]` 执行时使用：

```js
import { WebSocket } from 'undici';
```

生产容器根目录无法解析该包，返回：

```text
ERR_MODULE_NOT_FOUND: Cannot find package 'undici' imported from /app/[eval1]
```

这只是诊断探针的运行方式错误，不代表正在运行的 GroupGuard 服务缺少通信能力。生产服务仍然正常运行并处理了真实战绩查询。

探针失败后写出了空对象：

```json
{}
```

随后 PowerShell 5.1 在 StrictMode 下直接访问：

```powershell
$probe.battle.resolved_preferred.value
```

因 `battle` 属性不存在而再次中止。两个错误均属于诊断包缺陷。

## 3. 已取得的战绩运行证据

真实查询日志显示：

```text
commandId=builtin.query.battle.intranet
plugin_resolution ok=true
command type=success
latency=2894ms
plugin_execution_result ok=true
forward_send_direct source=response_capture_runtime group=805402626 scene=external_query
```

阶段性结论：

1. 命令成功命中新的内网战绩插件；
2. 没有出现接口请求失败、delivery 解析失败或 Base64 校验异常；
3. 最终进入的是 `send_group_forward_msg` 合并转发路径，而不是请求失败后的文字兜底；
4. 本次真实测试群号是 `805402626`，与旧包默认填写的 `960957757` 不一致；
5. 高概率是该群的实际 `preferred` 为 `forward`，但由于配置探针失败，目前仍缺少配置字段的直接证据，不能提前宣布最终 A 结论。

## 4. 主机性能观察

采集期间：

```text
宿主 load average: 7.44-7.70
可用内存: 699-715 MB
容器 CPU: 0.00%-1.45%
容器内存: 76.95-79.24 MiB
容器重启: 0
战绩命令耗时: 2894ms
```

宿主负载偏高，但 GroupGuard 容器资源占用很低，真实战绩请求正常完成。本次证据不支持把图片交付或 GFM 假缺失归因于盒子性能。

## 5. GFM 当前状态

OneBot 列表探针没有启动，因此尚未取得：

```text
get_group_root_files
get_group_files_by_folder
三次列表快照
列表结构
file_id 对比
列表延迟对比
```

GFM 仍未能在“结构不匹配 / ID 格式不匹配 / 列表可见性延迟 / 历史状态不足”之间作出最终判断。

## 6. v3 修复

v3 诊断包：

```text
GroupGuard-GFM-DELETE-002-GG-BATTLE-DELIVERY-001-readonly-diagnosis-kit-v3.zip
SHA-256: b19b8b947b06a0df9a16f6d646cd2244a9ee2affa1eb49f84b1ef542cf81daf0
```

修复内容：

1. 使用 Node 22 内置 `WebSocket`，不再从 `/app` 导入 `undici`；
2. PowerShell 安全读取可选 JSON 属性，探针失败也能生成最终报告；
3. 记录 `forward_send_direct` 证据；
4. 运行开始时要求填写本次真实查询所在群号，避免读取错误群的配置；
5. 继续保持全程只读，不修改配置、不重启、不构建、不部署。

下一次运行应填写实际测试群号 `805402626`，再执行一次真实查战绩并上传最终 ZIP。
