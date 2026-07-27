# SnowLuma 群文件消息转发

## 目标

当指定 QQ 在监控群发送文件消息卡片时，GroupGuard 直接调用 SnowLuma 的单条消息转发动作，把原消息转发到接收群。

该功能不下载文件，也不重新上传群文件。监控机器人只需要：

- 已加入监控群；
- 能正常接收群消息；
- 已加入接收群；
- 能在接收群正常发送消息。

监控机器人不需要在监控群拥有管理员身份，也不需要群文件上传权限。

## 正确链路

```text
监控群收到普通群消息事件
→ 消息发送者 QQ 匹配规则
→ 消息中包含 file 文件段
→ 文件名和大小匹配规则
→ 调用 forward_group_single_msg
→ 保存来源消息 ID 与接收群消息 ID
→ 成功后撤回接收群上一条转发消息
```

该链路不依赖 `group_upload` 通知，因此外部机器人只要在聊天消息列表留下文件卡片即可。

## 固定行为

每条规则固定执行以下行为：

1. 新文件消息成功转发后，才处理上一条转发；
2. 接收群只保留最新一条转发消息；
3. 来源文件消息被撤回时，同步撤回接收群对应消息；
4. 失败动作按规则配置进行有限重试；
5. 同一来源消息不会重复转发。

不会执行以下动作：

```text
get_group_file_url
upload_group_file
delete_group_file
```

## SnowLuma 能力要求

GroupGuard 使用以下 OneBot 事件和动作：

```text
message / message_sent
forward_group_single_msg
delete_msg
group_recall
```

核心动作参数：

```json
{
  "action": "forward_group_single_msg",
  "params": {
    "message_id": "来源文件消息ID",
    "group_id": "接收群号"
  }
}
```

SnowLuma 成功后应返回接收群的新 `message_id`。GroupGuard 依靠这个 ID 实现“只保留最新”和来源撤回同步。

## 配置文件

生产环境配置：

```text
/app/config/group-file-mirror.json
```

宿主机对应路径：

```text
/mnt/sda1/groupguard/app/config/group-file-mirror.json
```

状态文件：

```text
/app/data/group-file-mirror-state.json
```

也可以使用环境变量覆盖：

```text
GROUP_FILE_MIRROR_CONFIG_PATH
GROUP_FILE_MIRROR_STATE_PATH
```

首次启动时，如果配置不存在，系统会创建关闭状态的空配置，不会自行开始转发。

## 示例配置

```json
{
  "enabled": true,
  "rules": [
    {
      "id": "sample-source-to-target",
      "enabled": true,
      "sourceGroupId": "1334664",
      "targetGroupId": "16461612",
      "sourceUploaderIds": ["上传文件消息的QQ号"],
      "fileNamePattern": "\\.7z$",
      "maxFileSizeMb": 512,
      "keepLatestOnly": true,
      "recallPreviousTargetMessage": true,
      "syncSourceRecall": true,
      "retryCount": 2,
      "retryDelayMs": 1500
    }
  ]
}
```

## 配置字段

| 字段 | 说明 |
|---|---|
| `enabled` | 总开关；必须为 `true` 才处理文件消息 |
| `rules[].enabled` | 单条规则开关 |
| `sourceGroupId` | 监控群号 |
| `targetGroupId` | 接收群号，不能和监控群相同 |
| `sourceUploaderIds` | 仅转发这些 QQ 发送的文件消息；留空表示不限制发送者 |
| `fileNamePattern` | 文件名正则；留空表示不限文件名 |
| `maxFileSizeMb` | 单文件大小上限，范围 1–4096 MB |
| `keepLatestOnly` | 新消息成功后是否清理上一条转发，WebUI 固定开启 |
| `recallPreviousTargetMessage` | 是否撤回接收群上一条转发，WebUI 固定开启 |
| `syncSourceRecall` | 是否在来源文件消息撤回时同步撤回，WebUI 固定开启 |
| `retryCount` | OneBot 动作失败后的重试次数 |
| `retryDelayMs` | 重试基础间隔 |

旧配置中的以下字段会被安全忽略：

```text
targetFolderId
deletePreviousTargetFile
messageLookupAttempts
messageLookupDelayMs
```

## 状态文件

状态文件保存：

- 当前来源群号；
- 当前来源发送者 QQ；
- 当前来源文件消息 ID；
- 当前文件名与文件大小；
- 当前接收群消息 ID；
- 最近成功和失败信息；
- 尚未撤回成功的旧消息。

服务重启后会继续处理尚未完成的撤回，不应手动删除状态文件，除非明确要重置对应关系。

## WebUI

页面地址：

```text
/group-file-mirror.html
```

页面只展示与消息转发有关的设置：

- 监控群号；
- 接收群号；
- 文件消息发送者 QQ；
- 文件类型；
- 文件大小上限；
- 当前最新文件消息；
- 最近成功、最近错误和待撤回数量。

页面不再展示目标群文件夹，因为新实现不会重新上传群文件。

## 一键写入生产配置

在 Windows 仓库核心目录运行：

```powershell
cd D:\project2\napcatplugin\lengxi_repo\onebot-plugin-groupguard
powershell -ExecutionPolicy Bypass -File .\scripts\ops\Configure-GroupFileMirror.ps1 `
  -SourceGroupId 1334664 `
  -TargetGroupId 16461612 `
  -SourceUploaderId 上传文件消息的QQ号 `
  -Enable
```

脚本会：

- 校验群号、发送者 QQ 和文件名正则；
- 备份服务器原配置；
- 原子写入生产配置；
- 使用 `jq` 再次验证 JSON；
- 默认不重启容器，服务会在下一条消息到来时热加载配置。

## 上线验证

1. 在 WebUI 保存并开启规则；
2. 等指定 QQ 在监控群发送一条全新的匹配文件消息；
3. 接收群出现原样转发的文件消息；
4. WebUI 显示当前文件名和最近转发成功时间；
5. 再发送一条新文件消息，上一条接收群转发被撤回；
6. 撤回来源群当前文件消息，接收群对应消息被同步撤回；
7. 服务重启后不会重复转发当前来源消息；
8. 失败日志不会持续无限重试。

## 故障判断

### WebUI 一直显示“暂无”

先检查来源群消息事件中是否包含：

```text
post_type=message
message[].type=file
message_id
user_id
```

如果能收到普通群消息，但文件卡片没有被转换为 `file` 消息段，需要调查 SnowLuma 对该文件卡片格式的消息转换，而不是调查 `group_upload`。

### 接收群没有消息

查看最近错误是否包含：

```text
forward_group_single_msg
message not found
permission denied
```

监控群无需授权；接收群也不需要 GroupGuard 商业授权。QQ 侧只要求机器人能够在接收群正常发消息和执行该转发动作。
