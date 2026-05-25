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

`dedupeKey` is applied to built-in mappings and to custom `buildToast` output unless the custom toast already sets its own `dedupeKey`.

## Build And Test

```bash
npm run typecheck
npm run build
npm test
npm run test:coverage
```
