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

  // finding 12: 外部 manager が後付け（undefined → defined）された遷移で internal manager が dispose される
  it("disposes the internal manager when an external manager is supplied later", () => {
    // 初回マウントで internal を作る（manager prop 未指定）
    let internalCaptured: NotificationManager | null = null;
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        <NotificationProvider config={{ defaultDuration: 100 }}>
          <ManagerProbe onReady={(m) => (internalCaptured = m)} />
        </NotificationProvider>,
      );
    });
    // internal が確保できている前提
    expect(internalCaptured).not.toBeNull();
    // 内部 manager の dispose を spy
    const disposeSpy = vi.spyOn(internalCaptured!, "dispose");
    // 外部 manager を準備
    const external = createNotificationManager();

    // external を後付けで渡す
    act(() => {
      renderer!.update(
        <NotificationProvider manager={external}>
          <ManagerProbe onReady={() => undefined} />
        </NotificationProvider>,
      );
    });

    // internal の dispose が呼ばれている
    expect(disposeSpy).toHaveBeenCalledTimes(1);

    act(() => {
      renderer?.unmount();
    });
  });

  // config プロップの primitive 値が初回と異なるレンダリングでは dev 時に 1 回だけ console.warn が呼ばれる
  // 同値の inline literal（参照は別、値は同じ）では警告を出さない
  it("warns once in dev when the config prop values change after mount", () => {
    // NODE_ENV を一時的に development 相当に切り替え
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let renderer: ReactTestRenderer | undefined;

    try {
      act(() => {
        renderer = create(
          <NotificationProvider config={{ defaultDuration: 100 }}>
            <ManagerProbe onReady={() => undefined} />
          </NotificationProvider>,
        );
      });
      // 同じ値の config（参照は別の inline literal）で再 render → 警告は出ない
      act(() => {
        renderer!.update(
          <NotificationProvider config={{ defaultDuration: 100 }}>
            <ManagerProbe onReady={() => undefined} />
          </NotificationProvider>,
        );
      });
      expect(warnSpy).not.toHaveBeenCalled();
      // primitive 値を変えると 1 回だけ警告
      act(() => {
        renderer!.update(
          <NotificationProvider config={{ defaultDuration: 200 }}>
            <ManagerProbe onReady={() => undefined} />
          </NotificationProvider>,
        );
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [message] = warnSpy.mock.calls[0] ?? [];
      expect(message).toContain("config プロップは初回マウント時のみ評価されます");
      // さらに値を変えても警告は増えない（1 回限り）
      act(() => {
        renderer!.update(
          <NotificationProvider config={{ defaultDuration: 300 }}>
            <ManagerProbe onReady={() => undefined} />
          </NotificationProvider>,
        );
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      act(() => {
        renderer?.unmount();
      });
      warnSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
    }
  });

  // isConfigEqual の分岐網羅: maxQueueSize / now / idFactory / timer / undefined 遷移
  // それぞれを単独で変更すると 1 回だけ warn が出ることを検証する
  it("warns when isConfigEqual detects a change in any single field", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // 検証用ヘルパ: 2 つの config を順に渡して warn 回数を返す
    const runCase = (a: object | undefined, b: object | undefined): number => {
      warnSpy.mockClear();
      let renderer: ReactTestRenderer | undefined;
      try {
        act(() => {
          renderer = create(
            // @ts-expect-error any 型の動的 config を渡して各分岐を直接踏むためのテスト用 cast
            <NotificationProvider config={a}>
              <ManagerProbe onReady={() => undefined} />
            </NotificationProvider>,
          );
        });
        act(() => {
          renderer!.update(
            // @ts-expect-error 同上
            <NotificationProvider config={b}>
              <ManagerProbe onReady={() => undefined} />
            </NotificationProvider>,
          );
        });
        return warnSpy.mock.calls.length;
      } finally {
        act(() => {
          renderer?.unmount();
        });
      }
    };

    try {
      // 分岐 L28: 片方だけ undefined（初回 undefined → 後で defined）
      expect(runCase(undefined, { defaultDuration: 100 })).toBe(1);
      // 分岐 L28 (逆): 初回 defined → 後で undefined
      expect(runCase({ defaultDuration: 100 }, undefined)).toBe(1);
      // 分岐 L35: maxQueueSize の差分
      expect(runCase({ maxQueueSize: 10 }, { maxQueueSize: 20 })).toBe(1);
      // 分岐 L39: now 関数の参照差分
      expect(runCase({ now: () => 1 }, { now: () => 2 })).toBe(1);
      // 分岐 L42: idFactory の参照差分
      expect(runCase({ idFactory: () => "a" }, { idFactory: () => "b" })).toBe(1);
      // 分岐 L45: timer の参照差分
      const timerA = { set: () => 0, clear: () => undefined };
      const timerB = { set: () => 0, clear: () => undefined };
      expect(runCase({ timer: timerA }, { timer: timerB })).toBe(1);
    } finally {
      warnSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
    }
  });

  // 同値 inline literal の連続更新では警告が出ない（README 例の idiomatic 用法を保護）
  it("does not warn when config is a fresh literal but primitive values are equal", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let renderer: ReactTestRenderer | undefined;

    try {
      // 毎回 inline literal を渡しても primitive 値が等しければ警告は出ない
      act(() => {
        renderer = create(
          <NotificationProvider config={{ defaultDuration: 100, maxQueueSize: 50 }}>
            <ManagerProbe onReady={() => undefined} />
          </NotificationProvider>,
        );
      });
      for (let i = 0; i < 3; i++) {
        act(() => {
          renderer!.update(
            <NotificationProvider config={{ defaultDuration: 100, maxQueueSize: 50 }}>
              <ManagerProbe onReady={() => undefined} />
            </NotificationProvider>,
          );
        });
      }
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      act(() => {
        renderer?.unmount();
      });
      warnSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
    }
  });

  // production モードでは config 参照が変わっても警告を出さない
  it("does not warn when NODE_ENV is production", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let renderer: ReactTestRenderer | undefined;

    try {
      act(() => {
        renderer = create(
          <NotificationProvider config={{ defaultDuration: 100 }}>
            <ManagerProbe onReady={() => undefined} />
          </NotificationProvider>,
        );
      });
      act(() => {
        renderer!.update(
          <NotificationProvider config={{ defaultDuration: 200 }}>
            <ManagerProbe onReady={() => undefined} />
          </NotificationProvider>,
        );
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      act(() => {
        renderer?.unmount();
      });
      warnSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
    }
  });

  // 外部 manager が指定されている場合は config 警告ロジックの対象外（警告なし）
  it("does not warn when an external manager is supplied", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const external = createNotificationManager();
    let renderer: ReactTestRenderer | undefined;

    try {
      act(() => {
        renderer = create(
          <NotificationProvider manager={external}>
            <ManagerProbe onReady={() => undefined} />
          </NotificationProvider>,
        );
      });
      act(() => {
        renderer!.update(
          <NotificationProvider manager={external}>
            <ManagerProbe onReady={() => undefined} />
          </NotificationProvider>,
        );
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      act(() => {
        renderer?.unmount();
      });
      warnSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
    }
  });
});
