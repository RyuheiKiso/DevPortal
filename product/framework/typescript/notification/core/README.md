# @k1s0-ts-notification/core

Headless notification primitives for DevPortal TypeScript packages.

This package does not render UI. It manages notification state and exposes a small event stream that React, React Native, or any other UI layer can render.

## Features

- Toast, dialog, and confirm notifications
- `info`, `success`, `warning`, and `error` levels
- Auto-dismiss timers for toast notifications
- `dedupeKey` replacement for repeated toast notifications
- Bounded toast queue with dialog and confirm preservation
- Promise-based dialog and confirm resolution
- Duck-typed HTTP error mapping without a runtime dependency on `@k1s0-ts-http/core`
- zod validation for manager configuration

## Install

```bash
npm install @k1s0-ts-notification/core
```

## Usage

```ts
import { createNotificationManager } from "@k1s0-ts-notification/core";

const manager = createNotificationManager({
  defaultDuration: 4000,
  maxQueueSize: 50,
});

const id = manager.toast({
  level: "success",
  message: "保存しました",
});

const confirmed = await manager.confirm({
  title: "削除",
  message: "本当に削除しますか？",
  destructive: true,
});

if (confirmed) {
  manager.dismiss(id);
}
```

Subscribe from a UI layer:

```ts
const unsubscribe = manager.subscribe((event) => {
  if (event.type === "add") {
    // render event.notification
  }
});

unsubscribe();
```

## HTTP Error Mapping

```ts
import { fromHttpError, isHttpErrorLike } from "@k1s0-ts-notification/core";

try {
  await client.get("/api/orders");
} catch (err) {
  if (isHttpErrorLike(err)) {
    manager.toast(fromHttpError(err, { dedupeKey: "orders-fetch" }));
  }
}
```

Default titles are localized Japanese messages for common network, timeout, abort, 4xx, and 5xx cases. Use `messageResolver` or `levelResolver` to override them.

## Build And Test

```bash
npm run typecheck
npm run build
npm test
npm run test:coverage
```

Coverage thresholds are fixed at 100% in `vitest.config.ts`.
