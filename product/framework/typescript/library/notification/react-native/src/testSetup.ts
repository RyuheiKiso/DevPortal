import { vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalError = console.error.bind(console);

vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  const message = String(args[0] ?? "");
  if (
    message.includes("react-test-renderer is deprecated") ||
    message.includes("The above error occurred in the <ManagerProbe> component")
  ) {
    return;
  }
  originalError(...args);
});
