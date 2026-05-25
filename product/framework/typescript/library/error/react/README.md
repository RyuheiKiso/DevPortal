# @k1s0-ts-error/react

React bindings for `@k1s0-ts-error/core`.

## Example

```tsx
import { ErrorProvider, useErrorHandler } from "@k1s0-ts-error/react";

function SaveButton() {
  const { handleError } = useErrorHandler();

  async function onClick() {
    try {
      await save();
    } catch (caught) {
      handleError(caught, { operation: "customer.save" });
    }
  }

  return <button onClick={onClick}>Save</button>;
}
```
