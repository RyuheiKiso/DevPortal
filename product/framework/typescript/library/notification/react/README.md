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

> **Note:** `config` is evaluated only on the initial mount. Changing the `config` prop on subsequent renders does **not** recreate the internal manager. To apply a different configuration, either remount the `NotificationProvider` (e.g. via `key`) or pass an externally constructed `manager` prop.
>
> In development a one-time `console.warn` is emitted when the **primitive values** of `config` change after mount (passing a fresh inline literal with the same values is fine and does **not** trigger the warning). Function fields (`now` / `idFactory` / `timer`) are compared by reference. The development check uses `process.env.NODE_ENV === "development"` or React Native's `__DEV__ === true`; if your bundler does not expose `process.env.NODE_ENV` at runtime (for example when the bundler statically replaces it but does not polyfill `process`), the runtime value may be `undefined`, in which case the warning is suppressed (we err on the side of silence to avoid noise in production).
>
> If the `manager` prop transitions from `undefined` to a defined manager after mount, the previously created internal manager is automatically disposed.

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

> **SSR / RSC:** `useNotificationStream` is safe to render on the server. During the server pass it returns a stable, module-scoped frozen empty array, so the client hydrates with an empty queue and React does not emit a "snapshot is unstable" or hydration-mismatch warning. Notifications added on the client after hydration trigger a normal re-render as usual.

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
