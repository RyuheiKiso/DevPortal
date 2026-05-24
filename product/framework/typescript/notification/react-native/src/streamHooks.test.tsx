// vitest DSL と react-test-renderer を取り込み
import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
// core の Manager 生成関数を取り込み
import { createNotificationManager } from "@k1s0-ts-notification/core";
import type { Notification } from "@k1s0-ts-notification/core";
// テスト対象とその依存
import { NotificationProvider } from "./NotificationProvider.js";
import { useNotificationStream } from "./streamHooks.js";

// react-native の Alert は本テストでは未使用だが、import を Node 環境で安全に解決するためモック
vi.mock("react-native", () => ({
  Alert: { alert: () => undefined },
}));

// useNotificationStream の戻り値を観測する小さなコンポーネント
function StreamProbe({ onItems }: { onItems: (items: readonly Notification[]) => void }): null {
  // hook 経由で現在のキューを取得
  const items = useNotificationStream();
  // 受け取り側に渡す（render ごとに呼ばれる）
  onItems(items);
  // 描画なし
  return null;
}

describe("useNotificationStream (react-native)", () => {
  // toast 追加で state が更新される
  it("toast 追加で stream の state が更新される", () => {
    // 外部 manager を用意して直接 toast を呼べるようにする
    const manager = createNotificationManager();
    // 受信履歴
    const renders: readonly Notification[][] = [];
    const onItems = (items: readonly Notification[]): void => {
      // 配列のスナップショットを保持
      (renders as Notification[][]).push(items.slice() as Notification[]);
    };
    // マウント
    act(() => {
      create(
        <NotificationProvider manager={manager}>
          <StreamProbe onItems={onItems} />
        </NotificationProvider>,
      );
    });
    // 初期 render では空配列
    expect(renders[0]).toEqual([]);
    // toast を追加すると state が更新される
    act(() => {
      manager.toast({ message: "hello" });
    });
    // 最新の render は 1 件の toast を含む
    const latest = renders[renders.length - 1];
    expect(latest).toHaveLength(1);
    expect(latest?.[0]?.message).toBe("hello");
  });

  // unmount で subscribe が解除される（リーク無し）
  it("unmount 後の通知発行は state を変えない", () => {
    const manager = createNotificationManager();
    const renders: number[] = [];
    const onItems = (items: readonly Notification[]): void => {
      renders.push(items.length);
    };
    // マウント
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <NotificationProvider manager={manager}>
          <StreamProbe onItems={onItems} />
        </NotificationProvider>,
      );
    });
    // unmount
    act(() => {
      renderer?.unmount();
    });
    // unmount 後に出した toast は記録に増えないこと
    const before = renders.length;
    manager.toast({ message: "after-unmount" });
    expect(renders.length).toBe(before);
  });

  // Provider の manager が差し替わった場合、旧 manager の queue を残さず新 manager に同期する
  it("manager 差し替え時に新しい manager の queue へ同期する", () => {
    const first = createNotificationManager();
    const second = createNotificationManager();
    first.toast({ message: "old" });
    second.toast({ message: "new" });
    const renders: readonly Notification[][] = [];
    const onItems = (items: readonly Notification[]): void => {
      (renders as Notification[][]).push(items.slice() as Notification[]);
    };

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <NotificationProvider manager={first}>
          <StreamProbe onItems={onItems} />
        </NotificationProvider>,
      );
    });
    expect(renders[renders.length - 1]?.[0]?.message).toBe("old");

    act(() => {
      renderer?.update(
        <NotificationProvider manager={second}>
          <StreamProbe onItems={onItems} />
        </NotificationProvider>,
      );
    });

    expect(renders[renders.length - 1]?.[0]?.message).toBe("new");
  });
});
