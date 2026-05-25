# @k1s0-ts-error/core

Shared application error utilities for DevPortal TypeScript applications.

## Features

- Normalize unknown caught values into `AppError`
- Classify HTTP, auth, permission, validation, business, conflict, not-found, timeout, network, system, and unknown errors
- Keep user-facing messages separate from diagnostic details
- Preserve request IDs, trace IDs, status codes, error codes, details, and causes
- Convert normalized errors into logger records and notification inputs

## Example

```ts
import { normalizeError, toLogRecord, toNotification } from "@k1s0-ts-error/core";

try {
  await save();
} catch (caught) {
  const error = normalizeError(caught, { operation: "customer.save" });
  logger.error("Save failed", toLogRecord(error));
  notification.toast(toNotification(error));
}
```
