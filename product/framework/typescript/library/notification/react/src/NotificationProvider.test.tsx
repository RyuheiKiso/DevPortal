import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import {
  createNotificationManager,
  type NotificationManager,
} from "@k1s0-ts-notification/core";
import { NotificationProvider } from "./NotificationProvider.js";
import { useNotification } from "./hooks.js";

function ManagerProbe({ onReady }: { onReady: (m: NotificationManager) => void }): null {
  const manager = useNotification();
  onReady(manager);
  return null;
}

describe("NotificationProvider", () => {
  it("provides an external manager when one is supplied", () => {
    const external = createNotificationManager();
    let captured: NotificationManager | null = null;
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        <NotificationProvider manager={external}>
          <ManagerProbe onReady={(m) => (captured = m)} />
        </NotificationProvider>,
      );
    });

    expect(captured).toBe(external);
    act(() => {
      renderer?.unmount();
    });
  });

  it("creates and disposes an internal manager", () => {
    let captured: NotificationManager | null = null;
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        <NotificationProvider config={{ defaultDuration: 100 }}>
          <ManagerProbe onReady={(m) => (captured = m)} />
        </NotificationProvider>,
      );
    });

    expect(captured).not.toBeNull();
    const disposeSpy = vi.spyOn(captured!, "dispose");

    act(() => {
      renderer?.unmount();
    });

    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to an internal manager if the external manager prop is removed", () => {
    const external = createNotificationManager();
    let captured: NotificationManager | null = null;
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        <NotificationProvider manager={external}>
          <ManagerProbe onReady={(m) => (captured = m)} />
        </NotificationProvider>,
      );
    });
    expect(captured).toBe(external);

    act(() => {
      renderer!.update(
        <NotificationProvider>
          <ManagerProbe onReady={(m) => (captured = m)} />
        </NotificationProvider>,
      );
    });

    expect(captured).not.toBeNull();
    expect(captured).not.toBe(external);

    act(() => {
      renderer?.unmount();
    });
  });

  it("throws when useNotification is called outside a provider", () => {
    expect(() => {
      act(() => {
        create(<ManagerProbe onReady={() => undefined} />);
      });
    }).toThrow(/useNotification must be called inside/);
  });
});
