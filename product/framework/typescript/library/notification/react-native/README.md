# @k1s0-ts-notification/react-native

React Native bindings for `@k1s0-ts-notification/core`.

The package provides the same headless provider and hooks as the React package, plus:

- `createAlertConfirmAdapter` for native `Alert.alert` confirm and dialog handling
- `installGlobalErrorNotifier` for React Native `ErrorUtils` integration

Toast UI is still owned by the application.

## Install

```bash
npm install @k1s0-ts-notification/react-native @k1s0-ts-notification/core
```

Requires `react@>=18.0.0 <20.0.0` and `react-native@>=0.73.0 <1.0.0`.

## Provider

```tsx
import { NotificationProvider } from "@k1s0-ts-notification/react-native";

export function App() {
  return (
    <NotificationProvider config={{ defaultDuration: 3500, maxQueueSize: 30 }}>
      <RootStack />
      <ToastOutlet />
    </NotificationProvider>
  );
}
```

> **Note:** `config` is evaluated only on the initial mount. Changing the `config` prop on subsequent renders does **not** recreate the internal manager. To apply a different configuration, either remount the `NotificationProvider` (e.g. via `key`) or pass an externally constructed `manager` prop.
>
> In development a one-time `console.warn` is emitted when the **primitive values** of `config` change after mount (passing a fresh inline literal with the same values is fine and does **not** trigger the warning). Function fields (`now` / `idFactory` / `timer`) are compared by reference. The development check uses `process.env.NODE_ENV === "development"` or React Native's `__DEV__ === true`; if neither is detectable at runtime (Metro production build with `process` removed), the warning is suppressed.
>
> If the `manager` prop transitions from `undefined` to a defined manager after mount, the previously created internal manager is automatically disposed.

## Alert Adapter

```tsx
import { useEffect } from "react";
import {
  createAlertConfirmAdapter,
  useNotification,
} from "@k1s0-ts-notification/react-native";

function AlertBridge() {
  const manager = useNotification();

  useEffect(() => {
    const { dispose } = createAlertConfirmAdapter(manager);
    return dispose;
  }, [manager]);

  return null;
}
```

Confirm dialogs resolve to `true` or `false`. Dialogs resolve to `{ dismissed: true, reason }`.

### One Alert at a time

React Native's `Alert` API only renders a single modal at a time, so the adapter **serializes** confirm and dialog notifications: the next one is only handed to `Alert.alert` after the current one is resolved (via button press or `onDismiss`). This applies both to notifications already pending at install time and to any added afterwards. Toast notifications are never routed to `Alert.alert` and never block the queue.

### Button labels (i18n)

Pass `labels` to provide localized fallback text for buttons that the individual notification does not specify:

```tsx
createAlertConfirmAdapter(manager, {
  labels: { confirm: "OK", cancel: "Cancel", close: "Dismiss" },
});
```

The lookup order is **`notification.{confirmLabel,cancelLabel}` > `options.labels.*` > built-in Japanese defaults (`"OK"` / `"キャンセル"` / `"閉じる"`)**. Per-notification labels always win, so a one-off `manager.confirm({ confirmLabel: "..." })` overrides the adapter-wide default. Wire `labels` to your i18n resolver (for example `i18next.t(...)`) at install time so every Alert reflects the active locale.

## Global Errors

```tsx
import { useEffect } from "react";
import {
  installGlobalErrorNotifier,
  useNotification,
} from "@k1s0-ts-notification/react-native";

function GlobalErrorBridge() {
  const manager = useNotification();

  useEffect(
    () =>
      installGlobalErrorNotifier(manager, {
        fatalLevel: "error",
        callPreviousHandler: true,
      }),
    [manager],
  );

  return null;
}
```

### Behavior details

- **Resilient handler**: throws from `buildToast`, `dedupeKey`, `manager.toast`, the previous global handler, the supplied `logger`, and even `String(error)` on values with poisoned `toString` are all caught. The notifier never re-enters React Native's `ErrorUtils` path with an uncaught exception. When an optional `logger` is supplied, each failure category is recorded with a distinct event name (`globalErrorNotifier.buildTostFailed` → `handlerFailed`, `globalErrorNotifier.dedupeKeyResolverFailed`, `globalErrorNotifier.toastFailed`, `globalErrorNotifier.previousHandlerFailed`, etc).
- **Re-install on the same manager**: calling `installGlobalErrorNotifier(manager, ...)` twice with the same `manager` automatically unhooks the previous install before registering the new one. This prevents double-firing of toasts when hot-reload or an effect re-runs. A `logger.warn("globalErrorNotifier.replacingPreviousInstall")` is emitted when this happens.
- **Multiple managers**: calling `installGlobalErrorNotifier` with a *different* `manager` while another install is still active automatically uninstalls the previous one as well, and emits `logger.warn("globalErrorNotifier.replacingPreviousGlobalInstall")`. Only the **most recent install** is wired into React Native's `ErrorUtils`; previous installs are detached so their handlers no longer fire (and no longer keep their managers alive via the global chain). If you genuinely need two managers to receive the same errors, run a single shared handler that fans out to both `manager.toast` calls.
- **Previous-handler `isFatal` argument**: by default the **original** `isFatal` (including `undefined`) is forwarded to the chained previous handler, preserving the upstream `ErrorUtils` contract used by Sentry / Bugsnag / RN's default handler to distinguish "unset" from "explicit false". Set `normalizeFatalForPrevious: true` to receive a normalized boolean (`undefined` becomes `false`).
- **HttpError detection**: `isHttpErrorLike` requires a `retryable: boolean` field in addition to `message: string` and (`status: number` or `code: string`). This brand check matches the canonical `@k1s0-ts-http/core` `HttpError` shape while rejecting Node-style errno errors (e.g. `ENOENT`) that happen to have a `code: string`. Such non-HTTP errors fall through to the generic `fatalLevel`/`nonFatalLevel` path.

`dedupeKey` is applied to built-in mappings and to custom `buildToast` output unless the custom toast already sets its own `dedupeKey`.

### Out of scope

`installGlobalErrorNotifier` only hooks React Native's synchronous `ErrorUtils.setGlobalHandler`. **Unhandled Promise rejections are not captured by this package**, because Hermes, JSC, and the various RN versions expose them through different (and sometimes absent) mechanisms. If your app needs to notify on unhandled rejections, install a listener separately, for example:

```ts
// Hermes / modern RN
globalThis.HermesInternal?.enablePromiseRejectionTracker?.({
  allRejections: true,
  onUnhandled: (_id: number, error: unknown) =>
    manager.toast({ level: "error", message: String(error) }),
});

// Web / generic environments
globalThis.addEventListener?.("unhandledrejection", (event) => {
  manager.toast({ level: "error", message: String(event.reason) });
});
```

## Build And Test

```bash
npm run typecheck
npm run build
npm test
npm run test:coverage
```
