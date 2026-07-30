# SnowLuma 群文件搬运（最终版）

## 最终状态

该功能已于 **2026-07-28** 完成生产部署和实机验收，当前方案定为最终版本。

生产基线：

```text
生产分支：codex/production-integration-audit-20260726
生产提交：7b8628b06ff159d9ec3df286016b1e112cc6d4d8
SnowLuma：v1.12.4
运行容器：groupguard-snowluma
应用目录：/mnt/sda1/groupguard/app
```

当前生产规则：

```text
来源群：125253150
来源文件发送者 QQ：763311907
接收群：960957757
GroupGuard 机器人 QQ：755396669
文件规则：\.7z$
大小上限：512 MB
```

生产配置文件在最终部署前后保持原样，SHA-256：

```text
1384d4d09cd6e5603ce3f03d7b4540c29d2d2c875a5dd131a6bb2340eabe2f95
```

详细验收记录见：

```text
docs/GROUP_FILE_MIRROR_FINAL_ACCEPTANCE_20260728.md
```

## 目标与权限模型

外部机器人在来源群发送群文件消息。GroupGuard 机器人在来源群可以只是普通群员，不需要来源群管理员身份，也不需要来源群文件上传权限；只要能收到文件消息即可。

GroupGuard 机器人在接收群需要具备群文件上传、删除群文件以及撤回自身消息的权限。当前生产环境中，机器人 QQ `755396669` 在接收群 `960957757` 为管理员。

最终用户看到的是接收群自己的原生群文件卡片，可以直接点击并正常下载。

## 最终执行链路

SnowLuma v1.12.4 在当前环境不会为外部机器人发送的文件卡片上报可用的 `group_upload` 通知，但会正常上报普通群消息，并在消息段中提供 `file` 数据。

GroupGuard 因此采用以下固定流程：

```text
来源群收到普通 message / message_sent 事件
→ 读取 file 消息段
→ 匹配来源群、发送者 QQ、文件名和文件大小
→ 缓存来源 message_id
→ 将文件消息适配为内部群文件上传事件
→ get_group_file_url 获取来源文件最新地址
→ upload_group_file 上传到接收群
→ 接收群生成新的原生群文件与可下载文件卡片
→ 保存来源消息、目标 file_id 和目标消息 ID
→ 新文件成功后清理上一份目标文件与消息
```

主要 OneBot 能力：

```text
message / message_sent
get_group_file_url
upload_group_file
get_group_root_files
delete_msg
delete_group_file
get_group_msg_history
group_recall
```

## 为什么不使用“直接转发文件消息”

实机测试证明：

```text
send_group_forward_msg
→ 接收群可以看到文件卡片
→ 点击文件提示“资源已过期”
```

原因是合并转发只复制来源群文件的引用，并没有在接收群创建新的文件实体。来源群的 `file_id` 不能作为接收群自己的可下载文件使用。

因此以下方案均不是正式方案：

- `send_group_forward_msg` 合并转发文件卡片：外观正常，但文件资源过期；
- 发送即时下载链接：技术上可下载，但点击不方便、展示不美观；
- 依赖来源群 `group_upload`：SnowLuma v1.12.4 当前环境没有上报该事件。

最终方案必须使用 `get_group_file_url + upload_group_file`，在接收群重新创建原生群文件。

## 只保留最新文件

每条规则固定执行以下行为：

1. 新文件必须先成功上传到接收群；
2. 成功后才清理上一份，避免上传失败造成目标群无文件；
3. 撤回接收群上一份文件消息；
4. 删除接收群文件库中的上一份文件；
5. 接收群最终只保留最新一份；
6. 来源群撤回当前文件消息时，同步清理接收群对应文件；
7. 同一来源消息不会重复搬运；
8. GroupGuard 自己在接收群生成的文件不会再次触发搬运，避免循环。

## 独立撤回与清理机制

群文件搬运产生的消息和文件**不走现有全局风控撤回机制**。

目标文件消息会在进入全局自动撤回调度前被识别并绕过：

```text
不进入 runtimeControlService.scheduleSelfRecall
不进入 PolicyEngine
不进入 action_queue_service 的全局自撤回队列
不受全局自动撤回概率、延迟或风控保护影响
```

该功能使用自己的按规则串行队列、状态文件和有限重试机制，直接执行：

```text
delete_msg
+
delete_group_file
```

清理触发条件只有两类：

- 新文件成功上传后，清理上一份；
- 来源群当前文件消息被撤回后，同步清理接收群文件。

## 配置文件

生产容器路径：

```text
/app/config/group-file-mirror.json
```

宿主机路径：

```text
/mnt/sda1/groupguard/app/config/group-file-mirror.json
```

状态文件：

```text
/app/data/group-file-mirror-state.json
```

可使用环境变量覆盖：

```text
GROUP_FILE_MIRROR_CONFIG_PATH
GROUP_FILE_MIRROR_STATE_PATH
```

首次启动时，如果配置不存在，系统会创建关闭状态的空配置，不会自动开始搬运。

## 示例配置

```json
{
  "enabled": true,
  "rules": [
    {
      "id": "搬运规则 1",
      "enabled": true,
      "sourceGroupId": "125253150",
      "targetGroupId": "960957757",
      "sourceUploaderIds": ["763311907"],
      "fileNamePattern": "\\.7z$",
      "maxFileSizeMb": 512,
      "targetFolderId": "/",
      "keepLatestOnly": true,
      "deletePreviousTargetFile": true,
      "recallPreviousTargetMessage": true,
      "syncSourceRecall": true,
      "retryCount": 2,
      "retryDelayMs": 1500,
      "messageLookupAttempts": 6,
      "messageLookupDelayMs": 1000
    }
  ]
}
```

## 配置字段

| 字段 | 说明 |
|---|---|
| `enabled` | 总开关；必须为 `true` 才处理文件 |
| `rules[].enabled` | 单条规则开关 |
| `sourceGroupId` | 来源群号 |
| `targetGroupId` | 接收群号，不能和来源群相同 |
| `sourceUploaderIds` | 仅搬运这些 QQ 发送的文件消息；留空表示不限制发送者 |
| `fileNamePattern` | 文件名正则；留空表示不限文件名 |
| `maxFileSizeMb` | 单文件大小上限，范围 1–4096 MB |
| `targetFolderId` | 接收群目标文件夹，根目录使用 `/` |
| `keepLatestOnly` | 新文件成功后清理上一份，WebUI 固定开启 |
| `deletePreviousTargetFile` | 删除接收群文件库中的旧文件，WebUI 固定开启 |
| `recallPreviousTargetMessage` | 撤回旧文件对应的群消息，WebUI 固定开启 |
| `syncSourceRecall` | 来源消息撤回时同步清理，WebUI 固定开启 |
| `retryCount` | OneBot 动作失败后的重试次数 |
| `retryDelayMs` | 重试基础间隔 |
| `messageLookupAttempts` | 上传后查询目标文件消息 ID 的次数 |
| `messageLookupDelayMs` | 每次查询前等待时间 |

## 状态文件内容

状态文件保存：

- 当前来源群、来源发送者和来源消息 ID；
- 当前来源文件名、大小和文件 ID；
- 当前接收群、目标文件 ID 和目标消息 ID；
- 尚未清理成功的旧文件和旧消息；
- 最近成功时间、最近错误时间和错误内容。

服务重启后会继续处理尚未完成的清理。除非明确需要重置对应关系，否则不要手动删除状态文件。

## WebUI

页面地址：

```text
/group-file-mirror.html
```

生产访问形式：

```text
http://192.168.3.89:6108/?token=真实访问令牌
```

页面用于配置：

- 来源群号；
- 接收群号；
- 上传文件机器人的 QQ；
- 文件类型；
- 文件大小上限；
- 接收群文件夹；
- 当前最新文件；
- 最近成功、最近错误和待清理数量。

## 生产部署与验证

最终部署使用生产分支准确提交：

```text
7b8628b06ff159d9ec3df286016b1e112cc6d4d8
```

部署验证输出必须包含：

```text
trigger_mode=ordinary_file_message_adapter
delivery_mode=upload_group_file
global_self_recall_bypass=enabled
mirror_cleanup=delete_msg+delete_group_file
```

最终实机验收确认：

- 来源群外部机器人发送新的 `.7z` 文件消息后，系统能自动识别；
- 能取得来源文件最新地址；
- 能在接收群上传新的原生群文件；
- 接收群文件列表能查询到新的目标 `file_id`；
- 接收群用户点击文件可以正常下载；
- 不再使用会提示“资源已过期”的合并转发卡片；
- 当前版本被确认作为最终生产版本。

## 故障判断

### 接收群出现“资源已过期”

说明运行的仍是旧的合并转发方案。检查运行提交是否为：

```text
7b8628b06ff159d9ec3df286016b1e112cc6d4d8
```

### 来源群有文件但没有搬运

依次检查：

1. WebUI 总开关和规则是否开启；
2. 来源群号、发送者 QQ、文件后缀和大小是否匹配；
3. SnowLuma 是否上报普通 `message` 事件和 `file` 消息段；
4. 日志是否出现 `get_group_file_url` 或 `upload_group_file` 错误；
5. 状态文件是否写入最近错误。

### 接收群能看到文件但无法下载

检查该文件是否由 `upload_group_file` 在接收群新建，而不是由 `send_group_forward_msg` 生成的引用卡片。

### 旧文件未清理

检查状态文件中的 `pendingCleanup`，以及日志中的 `delete_msg`、`delete_group_file` 错误。不要改为使用全局风控撤回队列。
