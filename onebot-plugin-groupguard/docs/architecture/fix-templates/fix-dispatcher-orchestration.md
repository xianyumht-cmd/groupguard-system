# Fix Dispatcher Orchestration Violation

## Problem

- dispatcher imports infrastructure services or performs low-level runtime work directly

## Fix Pattern

```ts
// before
import { sendGroupScene } from '../commands/common';

export async function dispatch() {
  await sendGroupScene(groupId, 'raw_text', message);
}
```

```ts
// after
import { createSystemWriteMessagingPort } from '../infra/adapters/systemWriteAdapterFactory';

export async function dispatch() {
  const messagingPort = createSystemWriteMessagingPort();
  await messagingPort.sendGroupScene(groupId, 'raw_text', message);
}
```

## Move Target

- dispatcher keeps orchestration
- factory builds adapters
- adapter performs infrastructure call
