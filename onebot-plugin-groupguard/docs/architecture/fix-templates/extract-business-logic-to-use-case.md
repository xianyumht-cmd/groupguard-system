# Extract Business Logic To Use-Case

## Problem

- adapter or factory starts deciding permissions, validations, or workflow rules

## Fix Pattern

```ts
// before
export class Adapter {
  run(value: string) {
    if (!value.trim()) return 'invalid';
    return externalCall(value);
  }
}
```

```ts
// after
export function executeUseCase(value: string, context: { adapter: AdapterPort }) {
  if (!value.trim()) return { success: false, error: 'invalid' };
  return context.adapter.run(value);
}
```

## Move Target

- rule and decision logic belongs in use-case or domain
- adapter keeps translation only
