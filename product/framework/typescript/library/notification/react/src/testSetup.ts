import { vi } from "vitest";

const originalError = console.error.bind(console);

vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  const message = String(args[0] ?? "");
  if (message.includes("The above error occurred in the <ManagerProbe> component")) {
    return;
  }
  originalError(...args);
});
