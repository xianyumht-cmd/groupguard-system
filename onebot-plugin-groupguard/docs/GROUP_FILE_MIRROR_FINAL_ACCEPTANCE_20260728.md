# 群文件搬运最终验收记录（2026-07-28）

## 验收结论

**通过。**

SnowLuma 群文件搬运功能已经完成生产部署和真实群环境测试，当前实现确认为最终版本。

最终方案不是“直接转发文件消息”，而是把来源群文件重新上传为接收群自己的原生群文件。接收群用户点击文件后可以正常下载。

## 生产基线

```text
仓库：xianyumht-cmd/groupguard-system
生产分支：codex/production-integration-audit-20260726
最终生产提交：7b8628b06ff159d9ec3df286016b1e112cc6d4d8
SnowLuma：v1.12.4
容器：groupguard-snowluma
应用目录：/mnt/sda1/groupguard/app
WebUI 端口：6108
```

最终部署验证：

```text
running_commit=7b8628b06ff159d9ec3df286016b1e112cc6d4d8
mirror_config_sha=1384d4d09cd6e5603ce3f03d7b4540c29d2d2c875a5dd131a6bb2340eabe2f95
mirror_enabled=true
mirror_rules=1
trigger_mode=ordinary_file_message_adapter
delivery_mode=upload_group_file
global_self_recall_bypass=enabled
mirror_cleanup=delete_msg+delete_group_file
```

部署前后配置文件 SHA-256 一致，说明现有生产规则未被覆盖。

## 验收环境

```text
来源群：125253150
来源文件发送者 QQ：763311907
接收群：960957757
GroupGuard 机器人 QQ：755396669
来源群权限：普通群员即可
接收群权限：管理员
文件类型：.7z
```

## 方案调查与淘汰记录

### 1. `group_upload` 事件监听

结果：不采用。

SnowLuma v1.12.4 在当前环境能够正常上报普通消息和 `group_recall`，但外部机器人发送文件卡片时没有上报 `group_upload`。

诊断结果：

```text
WS_CAPTURE_CONNECTED=true
CAPTURE_NOTICE_TYPES={"group_recall":1}
group_upload_events=0
RESULT=NO_GROUP_UPLOAD_EVENT
```

因此正式实现改为监听普通群消息中的 `file` 消息段。

### 2. 单节点合并转发

测试动作：

```text
send_group_forward_msg
```

结果：动作调用成功，接收群能够显示文件卡片，但点击文件提示“资源已过期”。

原因：合并转发只复制来源群文件引用，没有在接收群创建新的文件实体。

结论：淘汰。

### 3. 即时下载链接

测试链路：

```text
get_group_file_url
→ send_group_msg 发送文字下载地址
```

结果：技术链路成功，能取得最新下载 URL 并发送到接收群。

结论：不作为最终方案。原因是点击不方便，展示不美观，不符合原生文件使用体验。

### 4. 接收群原生群文件上传

测试链路：

```text
来源普通文件消息
→ get_group_file_url
→ upload_group_file
→ get_group_root_files 验证
```

真实测试返回：

```text
UPLOAD_GROUP_FILE_RESPONSE={"status":"ok","retcode":0,"data":{"file_id":"/f953486f-6cf4-4dd9-b7e9-3deeceb68d31"}}
TARGET_FILE_ID=/f953486f-6cf4-4dd9-b7e9-3deeceb68d31
TARGET_FILE_LIST_MATCH.file_name=gA6vaJ8GcDoXTo.7z
TARGET_FILE_LIST_MATCH.uploader=755396669
RESULT=NATIVE_GROUP_FILE_UPLOADED
```

人工确认：接收群点击新生成的原生群文件，可以正常下载。

结论：通过，定为最终方案。

## 最终执行流程

```text
来源群收到普通 message / message_sent
→ 识别 file 消息段
→ 匹配来源群、发送者 QQ、文件名和大小
→ 缓存来源 message_id
→ get_group_file_url 获取最新地址
→ upload_group_file 上传到接收群
→ 保存目标 file_id 和目标消息 ID
→ 新文件成功后清理上一份消息和文件
```

## 最终清理机制

文件搬运产生的目标消息和文件由模块自行管理，不进入已有全局风控撤回机制。

独立清理动作：

```text
delete_msg
delete_group_file
```

固定行为：

- 新文件成功后再清理旧文件；
- 接收群只保留最新一份；
- 来源当前文件消息撤回时同步清理接收群文件；
- 同一来源消息不会重复搬运；
- 自己上传到接收群的文件不会循环触发；
- 失败动作有限重试，并持久化到状态文件。

不会进入：

```text
runtimeControlService.scheduleSelfRecall
PolicyEngine
action_queue_service 的全局自撤回队列
```

## 自动化验证

PR #12 的构建和 CI 均通过：

```text
GroupGuard Build：success
GroupGuard CI：success
npm test：success
PowerShell 语法验证：success
build:snowluma：success
跨仓库合同验证：success
verify:group-file-mirror：group file native upload mirror verification passed
```

PR：

```text
https://github.com/xianyumht-cmd/groupguard-system/pull/12
```

合并提交：

```text
7b8628b06ff159d9ec3df286016b1e112cc6d4d8
```

## 最终验收项

| 验收项 | 结果 |
|---|---|
| 能识别来源群外部机器人发送的 `.7z` 文件消息 | 通过 |
| 不依赖 SnowLuma `group_upload` 通知 | 通过 |
| 能获取来源文件最新地址 | 通过 |
| 能上传为接收群原生群文件 | 通过 |
| 接收群文件列表能找到目标 `file_id` | 通过 |
| 接收群点击文件可以正常下载 | 通过 |
| 不再使用会过期的合并转发卡片 | 通过 |
| 搬运消息绕过全局风控撤回 | 通过 |
| 使用模块独立撤回和删文件机制 | 通过 |
| 生产配置部署前后保持不变 | 通过 |
| 生产运行提交与预期一致 | 通过 |

## 维护约束

后续维护不得把正式链路改回以下方案：

```text
send_group_forward_msg 文件卡片
仅发送下载链接
只依赖 group_upload 事件
使用全局风控撤回队列清理搬运文件
```

涉及该功能的后续修改必须至少验证：

1. 接收群生成的是自己的原生群文件；
2. 文件可以真实下载；
3. 新文件失败时不会先删除旧文件；
4. 独立撤回和删文件机制仍与全局风控隔离；
5. 生产配置不会在部署时被覆盖。
