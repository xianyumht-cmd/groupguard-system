# SnowLuma Lanzou Update Push

SnowLuma standalone service can receive update events from `lanzou_update_push_api_server`.

## Two-machine startup configuration

The WebUI still defaults to `127.0.0.1`, which is suitable when both services run on one computer. For the two-machine layout below, persist the bind address, port, and token on the SnowLuma / GroupGuard computer before starting the service:

```powershell
[Environment]::SetEnvironmentVariable('GROUPGUARD_WEBUI_HOST', '0.0.0.0', 'User')
[Environment]::SetEnvironmentVariable('GROUPGUARD_WEBUI_PORT', '6108', 'User')
[Environment]::SetEnvironmentVariable('GROUPGUARD_WEBUI_TOKEN', 'REPLACE_WITH_A_STABLE_TOKEN', 'User')
```

Restart the terminal or service after setting them. The generated temporary token shown in startup logs is not suitable for a cross-machine callback because it changes after a restart. When GroupGuard is managed by a process manager or Windows service, set the same three variables in that service's persistent environment.

`0.0.0.0` is only the listen address. The monitor callback URL must use the GroupGuard computer's actual LAN address, and the configured port must be reachable between the two intranet hosts. Source code no longer contains a fixed production IP.

Endpoint:

```text
POST /api/lanzou-update/event
X-GroupGuard-Token: YOUR_GROUPGUARD_WEBUI_TOKEN
```

Add or merge this section into SnowLuma `config.json`:

```json
{
  "lanzouUpdatePush": {
    "enabled": true,
    "monitorBaseUrl": "http://LANZOU_MONITOR_HOST:6178",
    "groupIds": ["TARGET_GROUP_ID"],
    "privateUserIds": [],
    "messageTemplate": "检测到网盘更新：{title}\n{url}",
    "includeDiffSummary": true
  }
}
```

The Lanzou monitor backend `notify_targets.url` should point to:

```text
http://GROUPGUARD_HOST:6108/api/lanzou-update/event
```

Configure the notify target header `X-GroupGuard-Token` with the persistent `GROUPGUARD_WEBUI_TOKEN`. Do not put the token in handoff documents, Git history, or test artifacts.

Supported message template fields:

- `{message}`
- `{title}`
- `{name}`
- `{watcher_id}`
- `{url}`
- `{added_count}`
- `{removed_count}`
- `{changed_count}`
- `{diff_summary}`

The endpoint reuses SnowLuma WebUI token authentication. For a single-computer deployment, omit `GROUPGUARD_WEBUI_HOST` and keep the default loopback binding; for the documented two-computer deployment, use the explicit persistent settings above.

## Delivery contract

- The monitor creates a stable `event_id` from watcher and snapshot signatures.
- GroupGuard stores successful delivery receipts by `event_id` and target.
- Retries send only targets that have not succeeded; a duplicate successful event is acknowledged without sending again.
- A reused `event_id` with different payload content is rejected as `lanzou_update_event_id_conflict`.
- The contract is at-least-once across a process crash between the OneBot acknowledgement and receipt persistence. It prevents normal retries from duplicating messages, but cannot claim theoretical exactly-once delivery.
- `deliveryState` is one of `complete`, `partial`, `failed`, or `skipped`; callers must not treat HTTP transport success alone as business success.

The default template is readable UTF-8 Chinese. Templates containing replacement characters, common mojibake markers, or unsupported placeholders are rejected instead of being sent to a group.
