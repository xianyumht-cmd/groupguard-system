# Move Infra Call To Adapter

## Problem

- a use-case imports runtime services, `commands/common`, `fs`, `path`, or other infrastructure helpers directly

## Fix Pattern

```ts
// before
import { saveConfig } from '../../commands/common';

export function executeXxxUseCase() {
  saveConfig(ctx);
}
```

```ts
// after
export interface IConfigPort {
  saveConfig(): void | Promise<void>;
}

export function executeXxxUseCase(context: { configPort: IConfigPort }) {
  context.configPort.saveConfig();
}
```

## Move Target

- implementation goes to adapter layer
- use-case keeps only port call
