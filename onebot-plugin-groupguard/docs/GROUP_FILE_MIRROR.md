# SnowLuma 群文件搬运

## 目标

机器人同时加入来源群和接收群后，GroupGuard 可以监听来源群的新文件，并把文件重新上传到接收群。

当规则开启“只保留最新文件”时，每次成功上传新文件后，会清理接收群中的上一份文件：

1. 撤回上一份文件对应的群消息；
2. 删除接收群文件库中的上一份文件；
3. 保存最新来源文件与接收文件的对应关系；
4. 来源群撤回当前文件消息时，尽力同步清理接收群对应文件。

该功能直接运行在 SnowLuma 事件入口，不依赖来源群的 GroupGuard 商业授权。

## SnowLuma 能力链路

GroupGuard 使用以下 OneBot 事件和动作：

```text
group_upload
get_group_file_url
upload_group_file
delete_group_file
delete_msg
get_group_msg_history
```

实际搬运流程：

```text
来源群 group_upload
→ 获取来源文件下载地址
→ SnowLuma 从下载地址上传到接收群
→ 记录目标 file_id 和文件消息 ID
→ 清理上一份目标文件与消息
```

GroupGuard 会忽略自己在接收群产生的 `group_upload` 事件，防止 A→B、B→A 或多规则串联导致循环上传。

## 配置文件

当前生产环境的主配置位于：

```text
/app/config/config.json
```

群文件搬运配置与主配置放在同一目录：

```text
/app/config/group-file-mirror.json
```

代码同时兼容主配置直接位于 `/app/config.json` 的旧布局；无论哪种布局，默认搬运配置都会落到应用的 `config` 目录。

也可以使用环境变量指定其他位置：

```text
GROUP_FILE_MIRROR_CONFIG_PATH
```

首次启动时，如果文件不存在，系统会自动创建一份关闭状态的空配置，不会自行开始搬运。

仓库示例：

```text
config/group-file-mirror.example.json
```

示例配置：

```json
{
  "enabled": true,
  "rules": [
    {
      "id": "sample-source-to-target",
      "enabled": true,
      "sourceGroupId": "1334664",
      "targetGroupId": "16461612",
      "sourceUploaderIds": ["上传文件机器人的QQ号"],
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

示例中的群号只用于说明，不会随程序自动启用。

## 配置字段

| 字段 | 说明 |
|---|---|
| `enabled` | 总开关；必须为 `true` 才处理文件 |
| `rules[].enabled` | 单条规则开关 |
| `sourceGroupId` | 来源群号 |
| `targetGroupId` | 接收群号，不能和来源群相同 |
| `sourceUploaderIds` | 仅搬运这些 QQ 上传的文件；留空表示不限制上传者 |
| `fileNamePattern` | 文件名正则；留空表示不限文件名 |
| `maxFileSizeMb` | 单文件大小上限，范围 1–4096 MB |
| `targetFolderId` | 接收群目标文件夹，根目录使用 `/` |
| `keepLatestOnly` | 新文件成功后是否清理上一份文件 |
| `deletePreviousTargetFile` | 是否删除接收群文件库中的旧文件 |
| `recallPreviousTargetMessage` | 是否撤回旧文件对应的聊天消息 |
| `syncSourceRecall` | 是否在检测到来源群撤回时同步清理当前目标文件 |
| `retryCount` | OneBot 动作失败后的重试次数 |
| `retryDelayMs` | 重试基础间隔 |
| `messageLookupAttempts` | 上传后查询目标文件消息 ID 的次数 |
| `messageLookupDelayMs` | 每次查询前等待时间 |

## 状态文件

默认状态文件：

```text
/app/data/group-file-mirror-state.json
```

也可以通过以下环境变量改路径：

```text
GROUP_FILE_MIRROR_STATE_PATH
```

状态文件保存：

- 当前来源文件；
- 当前接收群文件；
- 来源和目标消息 ID；
- 尚未清理成功的旧文件；
- 最近成功和失败信息。

服务重启后会继续处理尚未完成的清理，不应手动删除状态文件，除非明确要重置对应关系。

## 权限要求

机器人必须：

- 已加入来源群；
- 已加入接收群；
- 能读取来源群文件；
- 能向接收群上传文件；
- 需要清理目标文件时，具备删除目标群文件和撤回自身文件消息的权限。

来源群通常不要求机器人是管理员。接收群是否需要管理员权限取决于群文件权限和 QQ 当前限制。

## 撤回同步的可靠性

SnowLuma 的 `group_upload` 事件本身不包含聊天消息 ID，因此 GroupGuard 会通过两种方式补齐：

1. 观察来源群和接收群的文件消息事件；
2. 上传后使用 `get_group_msg_history` 查询文件消息 ID。

建议 SnowLuma 开启 `reportSelfMessage`，这样能直接接收到机器人自己的 `message_sent` 事件，目标消息撤回更及时。

即使偶尔没有取得来源消息 ID，下一次新文件上传成功时，“只保留最新文件”仍会清理接收群上一份文件。来源撤回同步属于额外保险，不是唯一清理机制。

## 一键写入生产配置

代码部署完成后，在 Windows 仓库的核心程序目录运行：

```powershell
cd D:\project2\napcatplugin\lengxi_repo\onebot-plugin-groupguard
powershell -ExecutionPolicy Bypass -File .\scripts\ops\Configure-GroupFileMirror.ps1 `
  -SourceGroupId 1334664 `
  -TargetGroupId 16461612 `
  -SourceUploaderId 上传文件机器人的QQ号 `
  -Enable
```

脚本会：

- 校验群号、上传者 QQ 和文件名正则；
- 备份服务器原配置；
- 原子写入 `/mnt/sda1/groupguard/app/config/group-file-mirror.json`；
- 使用 `jq` 再次验证 JSON；
- 默认不重启容器，服务会在下一个事件到来时热加载新配置。

需要同时重启容器时增加：

```powershell
-RestartContainer
```

首次配置建议先不写 `-Enable`，确认脚本输出的来源群、接收群和上传者 QQ 正确后，再带 `-Enable` 执行一次。

## 上线验证

1. 新文件能上传到接收群；
2. 下一份文件出现后，上一份文件消息被撤回；
3. 接收群文件库中上一份实体文件被删除；
4. 来源群撤回当前文件时，接收群对应文件被同步清理；
5. 服务重启后不会重复搬运当前文件；
6. 失败日志不会持续无限重试；
7. GroupGuard 自己上传到接收群的文件不会再次触发搬运。
