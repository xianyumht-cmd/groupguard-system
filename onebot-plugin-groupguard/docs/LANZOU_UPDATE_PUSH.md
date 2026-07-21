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

`0.0.0.0` is only the listen address. The monitor callback URL must use the GroupGuard computer's actual LAN address, such as `192.168.3.89`, and TCP port `6108` must be reachable between the two computers.

Endpoint:

```text
POST /api/lanzou-update/event?token=YOUR_GROUPGUARD_WEBUI_TOKEN
```

Add or merge this section into SnowLuma `config.json`:

```json
{
  "lanzouUpdatePush": {
    "enabled": true,
    "monitorBaseUrl": "http://192.168.3.100:6178",
    "groupIds": ["TARGET_GROUP_ID"],
    "privateUserIds": [],
    "messageTemplate": "{message}",
    "includeDiffSummary": true
  }
}
```

The Lanzou monitor backend `notify_targets.url` should point to:

```text
http://192.168.3.89:6108/api/lanzou-update/event?token=YOUR_GROUPGUARD_WEBUI_TOKEN
```

`YOUR_GROUPGUARD_WEBUI_TOKEN` must be exactly the persistent `GROUPGUARD_WEBUI_TOKEN` value configured on the GroupGuard computer.

Current two-machine layout:

- SnowLuma / GroupGuard plugin: `192.168.3.89:6108`
- Lanzou monitor API server: `192.168.3.100:6178`

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
