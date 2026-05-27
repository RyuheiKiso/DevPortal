// vitest DSL と react-test-renderer を取り込み
import { describe, expect, it } from "vitest";
import { act, create } from "react-test-renderer";
// core の Manager 生成関数を取り込み
import { createNotificationManager } from "@k1s0-ts-notification/core";
import type { AppNotification } from "@k1s0-ts-notification/core";
// テスト対象とその依存
import { NotificationProvider } from "./NotificationProvider.js";
import { __testing__, useNotificationStream } from "./streamHooks.js";

// useNotificationStream の戻り値を観測する小さなコンポーネント
function StreamProbe({ onItems }: { onItems: (items: readonly AppNotification[]) => void }): null {
  // hook 経由で現在のキューを取得
  const items = useNotificationStream();
  // 受け取り側に渡す（render ごとに呼ばれる）
  onItems(items);
  // 描画なし
  return null;
}

describe("useNotificationStream", () => {
  // toast 追加で state が更新される
  it("toast 追加で stream の state が更新される", () => {
    // 外部 manager を用意して直接 toast を呼べるようにする
    const manager = createNotificationManager();
    // 受信履歴
    const renders: readonly AppNotification[][] = [];
    const onItems = (items: readonly AppNotification[]): void => {
      // 配列のスナップショットを保持
      (renders as AppNotification[][]).push(items.slice() as AppNotification[]);
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
    const onItems = (items: readonly AppNotification[]): void => {
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
    const renders: readonly AppNotification[][] = [];
    const onItems = (items: readonly AppNotification[]): void => {
      (renders as AppNotification[][]).push(items.slice() as AppNotification[]);
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

  // useMemo を useRef 化したことで、同一 manager の再 render で subscribe が再走らないことを検証
  it("同一 manager で再 render しても manager.subscribe は 1 回しか呼ばれない", () => {
    // 通常の manager を生成し、subscribe をスパイ可能なラッパに包む
    const base = createNotificationManager();
    // subscribe 呼び出し回数のカウンタ
    let subscribeCalls = 0;
    // 既存 manager の subscribe を計測付きで差し替えたプロキシ
    const manager = {
      ...base,
      subscribe: (listener: Parameters<typeof base.subscribe>[0]): (() => void) => {
        // 呼び出しのたびにカウントを増やす
        subscribeCalls += 1;
        // 実体に委譲
        return base.subscribe(listener);
      },
    };
    // 観測関数（render 回数を増やしても store 同一性を維持できているか間接検証）
    // 値は使わず subscribe 回数のみ観察するため no-op で良い
    const onItems = (_items: readonly AppNotification[]): void => undefined;
    // マウント
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <NotificationProvider manager={manager}>
          <StreamProbe onItems={onItems} />
        </NotificationProvider>,
      );
    });
    // 同一 manager のまま再 render（Provider の children だけ差し替え）
    act(() => {
      renderer?.update(
        <NotificationProvider manager={manager}>
          <StreamProbe onItems={onItems} />
        </NotificationProvider>,
      );
    });
    // useRef による安定保持で subscribe は初回 1 回のみ
    expect(subscribeCalls).toBe(1);
  });

  // SSR snapshot は凍結済みの単一参照を毎回返す（hydration mismatch を起こさない）
  it("__testing__.getServerSnapshot は常に EMPTY_SNAPSHOT の同一参照を返す", () => {
    // 2 回呼び出しても同じ参照
    const first = __testing__.getServerSnapshot();
    const second = __testing__.getServerSnapshot();
    expect(first).toBe(second);
    // 公開された定数とも同一参照（モジュール内で 1 度だけ freeze されている証拠）
    expect(first).toBe(__testing__.EMPTY_SNAPSHOT);
    // 中身は空配列
    expect(first).toEqual([]);
    // 凍結されている
    expect(Object.isFrozen(first)).toBe(true);
  });
});
