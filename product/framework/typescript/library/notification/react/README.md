# @k1s0-ts-notification/react

React bindings for `@k1s0-ts-notification/core`.

The package provides `NotificationProvider`, notification hooks, a queue stream hook, and an HTTP error handler hook. It is headless: applications render their own toast, dialog, and confirm UI.

## Install

```bash
npm install @k1s0-ts-notification/react @k1s0-ts-notification/core
```

Requires `react@>=18.0.0 <20.0.0`.

## Provider

```tsx
import { NotificationProvider } from "@k1s0-ts-notification/react";

export function App() {
  return (
    <NotificationProvider config={{ defaultDuration: 4000, maxQueueSize: 50 }}>
      <Root />
      <NotificationOutlet />
    </NotificationProvider>
  );
}
```

You can also pass an existing manager:

```tsx
<NotificationProvider manager={manager}>
  <Root />
</NotificationProvider>
```

If `manager` is later removed, the provider creates an internal manager instead of exposing a null context value.

## Hooks

```tsx
import { useNotification, useNotificationStream } from "@k1s0-ts-notification/react";

function SaveButton() {
  const notify = useNotification();
  return (
    <button
      onClick={() => {
        notify.toast({ level: "success", message: "保存しました" });
      }}
    >
      保存
    </button>
  );
}

function NotificationOutlet() {
  const items = useNotificationStream();
  const notify = useNotification();

  return (
    <div>
      {items.map((item) => (
        <button key={item.id} onClick={() => notify.dismiss(item.id)}>
          {item.message}
        </button>
      ))}
    </div>
  );
}
```

## HTTP Errors

```tsx
import { useHttpErrorHandler } from "@k1s0-ts-notification/react";

function OrdersPage() {
  const handleError = useHttpErrorHandler({
    dedupeKey: "orders-fetch",
    duration: 6000,
  });

  // Pass handleError to query or mutation error callbacks.
}
```

## Build And Test

```bash
npm run typecheck
npm run build
npm test
npm run test:coverage
```
