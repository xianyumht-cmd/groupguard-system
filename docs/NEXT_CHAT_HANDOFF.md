# GroupGuard 当前任务交接

更新时间：2026-07-31 14:52 +08:00  
状态：`battle_resolved_gfm_awaiting_readonly_probe`  
工作分支：`codex/gg-battle-delivery-diagnosis-20260731`

当前仅剩任务：

```text
GFM-DELETE-002  群文件假缺失原始列表只读诊断
```

## 1. GG-BATTLE-DELIVERY-001 已解决

用户已确认群 `805402626` 的“查战绩”输出配置为：

```text
text
```

因此插件按群配置输出文字。用户调整该群配置后，查战绩输出问题已经解决。

最终结论：

```text
A = 实际群配置解析为 preferred=text
```

此前生产日志已经证明命令成功执行，且没有接口请求失败、delivery 解析失败或 Base64 校验错误。因此不需要修改：

- LOLDataSystem 5001/6178；
- SnowLuma 6108；
- Base64 校验；
- OneBot 图片 segment；
- 插件代码或生产服务。

详细结论：

```text
docs/GG_BATTLE_DELIVERY_001_RESOLUTION.md
```

后续不再重复发送“查战绩”，也不再继续战绩链路诊断。

## 2. GFM-DELETE-002 仍需完成

现象：目标群仍有多份历史文件，但 WebUI 显示：

```text
pendingCleanup=0
recent error=none
```

当前代码风险：删除旧文件前只执行一次列表查询；精确 `file_id` 未命中即按 `absent` 处理，设置 `fileDeleted=true`，随后从 `pendingCleanup` 清除。

待判断的最终结论只能是以下之一：

```text
list_structure_mismatch
id_format_mismatch
list_visibility_delay_or_inconsistency
insufficient_historical_state
```

仍缺少：

```text
get_group_root_files/get_group_files_by_folder 原始结构
0ms / 1500ms / 5000ms 三次列表快照
file_id 精确与规范化比较
文件名与大小候选匹配
列表指纹和可见性变化
```

## 3. 前两次诊断包结果

v1：SSH 强制 `BatchMode=yes`，密码认证被禁止，未建立生产连接。

v2：成功完成生产前后哈希和部分日志采集，但 OneBot 探针从 `/app/[eval1]` 导入 `undici` 失败；随后 PowerShell StrictMode 因缺失属性中止。

两次均确认：

```text
production_modified=false
service_restarted=false
build_executed=false
deployment_executed=false
git_updated=false
```

## 4. 使用 v3 的 GFM 专用入口

诊断包：

```text
GroupGuard-GFM-DELETE-002-GG-BATTLE-DELIVERY-001-readonly-diagnosis-kit-v3.zip
SHA-256: b19b8b947b06a0df9a16f6d646cd2244a9ee2affa1eb49f84b1ef542cf81daf0
```

后续只运行：

```text
run-readonly-gfm-delete-002-diagnosis.cmd
```

不运行双任务入口，不需要填写战绩群号，也不需要发送“查战绩”。

完成后上传：

```text
reports\groupguard-readonly-diagnosis-<timestamp>.zip
```

收到报告后：

1. 校验生产前后哈希和容器状态；
2. 读取 OneBot 三次列表快照；
3. 对 GFM 给出结构、ID、延迟或历史状态不足的单一结论；
4. 证据充分后再规划最小修复；
5. 未经明确授权，不修改生产、不部署、不合并 main。

## 5. 固定安全边界

- 不修改 5001、6178、6108 或生产配置；
- 不重启容器和服务；
- 不构建、不部署、不覆盖生产文件；
- 不执行 `git pull/reset/clean/checkout`；
- 不输出 token、cookie、authorization、密码或完整 Base64；
- 不在证据不足时直接修改 GFM 删除逻辑。
