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
- **Previous-handler `isFatal` argument**: by default the **original** `isFatal` (including `undefined`) is forwarded to the chained previous handler, preserving the upstream `ErrorUtils` contract used by Sentry / Bugsnag / RN's default handler to distinguish "unset" from "explicit false". Set `normalizeFatalForPrevious: true` to receive a normalized boolean (`undefined` becomes `false`).
- **HttpError detection**: `isHttpErrorLike` requires a `retryable: boolean` field in addition to `message: string` and (`status: number` or `code: string`). This brand check matches the canonical `@k1s0-ts-http/core` `HttpError` shape while rejecting Node-style errno errors (e.g. `ENOENT`) that happen to have a `code: string`. Such non-HTTP errors fall through to the generic `fatalLevel`/`nonFatalLevel` path.

`dedupeKey` is applied to built-in mappings and to custom `buildToast` output unless the custom toast already sets its own `dedupeKey`.

## Build And Test

```bash
npm run typecheck
npm run build
npm test
npm run test:coverage
```
