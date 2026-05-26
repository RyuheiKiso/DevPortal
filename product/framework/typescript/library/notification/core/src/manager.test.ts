// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { createNotificationManager } from "./manager.js";
// テスト用の型
import type { NotificationEvent, NotificationTimer } from "./types.js";

// タイマーを手動制御するためのフェイク実装
function createFakeTimer() {
  // 登録済みコールバック群
  const callbacks: Array<{ id: number; cb: () => void; ms: number }> = [];
  // 連番 ID
  let nextId = 1;
  // タイマー本体
  const timer: NotificationTimer = {
    // set: 登録のみ（自動発火しない）
    set: (cb, ms) => {
      const id = nextId++;
      callbacks.push({ id, cb, ms });
      return id;
    },
    // clear: 該当エントリを除去
    clear: (handle) => {
      const idx = callbacks.findIndex((c) => c.id === handle);
      if (idx >= 0) {
        callbacks.splice(idx, 1);
      }
    },
  };
  // 全コールバックを手動発火
  const runAll = () => {
    const fired = callbacks.splice(0, callbacks.length);
    fired.forEach((c) => c.cb());
  };
  // 待機中タイマー数
  const pending = () => callbacks.length;
  return { timer, runAll, pending };
}

// 連番 ID factory（テスト用）
function createSequentialIdFactory(): () => string {
  let i = 0;
  return () => `id-${++i}`;
}

describe("createNotificationManager / toast", () => {
  // toast 発行で add イベントが届く
  it("toast を発行すると add イベントが listener に届く", () => {
    // フェイクタイマーと連番 ID を注入
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
      now: () => 1000,
    });
    // 受信イベント記録
    const events: NotificationEvent[] = [];
    manager.subscribe((e) => events.push(e));
    // 発行
    const id = manager.toast({ message: "hi" });
    expect(id).toBe("id-1");
    // add イベントが 1 件届いている
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("add");
    expect(events[0]?.notification.message).toBe("hi");
    // 自動 dismiss タイマーは未設定（duration=0）
    expect(fake.pending()).toBe(0);
  });

  // duration 経過で自動 dismiss
  it("duration 経過で remove イベントが届く", () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
    });
    const events: NotificationEvent[] = [];
    manager.subscribe((e) => events.push(e));
    // duration=100 で toast 発行
    manager.toast({ message: "hi", duration: 100 });
    // タイマー 1 件登録
    expect(fake.pending()).toBe(1);
    // タイマー発火
    fake.runAll();
    // remove イベントが届いている
    expect(events.map((e) => e.type)).toEqual(["add", "remove"]);
    // キューが空
    expect(manager.getAll()).toEqual([]);
  });

  // defaultDuration が適用される
  it("defaultDuration が未指定 toast に適用される", () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
      defaultDuration: 500,
    });
    manager.toast({ message: "x" });
    // タイマーが登録されている
    expect(fake.pending()).toBe(1);
  });

  // dedupeKey による置換（update イベント）
  it("dedupeKey が同じ toast を 2 回出すと 2 回目は update イベントになる", () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
    });
    const events: NotificationEvent[] = [];
    manager.subscribe((e) => events.push(e));
    // 1 回目
    const id1 = manager.toast({ message: "v1", dedupeKey: "k", duration: 100 });
    // 2 回目（同じ dedupeKey）
    const id2 = manager.toast({ message: "v2", dedupeKey: "k", duration: 200 });
    // 同じ ID が返る
    expect(id2).toBe(id1);
    // イベント順序は add -> update
    expect(events.map((e) => e.type)).toEqual(["add", "update"]);
    // タイマーは 1 件のみ（再設定）
    expect(fake.pending()).toBe(1);
    // 通知の内容は更新後の値
    const all = manager.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.message).toBe("v2");
  });

  // dedupeKey 置換時に level / duration を未指定でも defaultDuration と既存 level が引き継がれる
  it("dedupeKey 置換時に level / duration 未指定でも defaultDuration と既存 level が使われる", () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
      defaultDuration: 500,
    });
    // 1 回目: level=success
    manager.toast({ level: "success", message: "v1", dedupeKey: "k", duration: 1000 });
    // 2 回目: level / duration 未指定（既存 level と defaultDuration を踏襲）
    manager.toast({ message: "v2", dedupeKey: "k" });
    const all = manager.getAll();
    // level は既存値（success）を維持
    expect(all[0]?.level).toBe("success");
    // duration は defaultDuration を採用
    if (all[0]?.kind === "toast") {
      expect(all[0].duration).toBe(500);
    }
  });

  // dedupeKey 一致だが種別が toast 以外なら新規追加扱い
  it("dedupeKey 一致でも dialog だった場合は新規 toast として追加", () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
    });
    // 同じ dedupeKey で dialog を先に出す
    manager.dialog({ message: "d", dedupeKey: "shared" });
    // 続いて toast を発行
    manager.toast({ message: "t", dedupeKey: "shared" });
    // 両方残っている
    expect(manager.getAll()).toHaveLength(2);
  });

  // 上限超過時に最古の toast を捨てる
  it("maxQueueSize 超過時は最古の toast から FIFO で捨てる", () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
      maxQueueSize: 2,
    });
    const events: NotificationEvent[] = [];
    manager.subscribe((e) => events.push(e));
    // 3 件 toast を出す（上限 2）
    manager.toast({ message: "a", duration: 100 });
    manager.toast({ message: "b" });
    manager.toast({ message: "c" });
    // 最終的に b と c が残る
    const ids = manager.getAll().map((n) => n.id);
    expect(ids).toEqual(["id-2", "id-3"]);
    // a 削除時のタイマーも片付いている
    expect(fake.pending()).toBe(0);
    // remove イベントが 1 件混ざる
    const types = events.map((e) => e.type);
    expect(types).toEqual(["add", "add", "add", "remove"]);
  });

  // dialog / confirm のみで上限超過時は何も削除しない
  it("dialog / confirm のみで上限超過しても削除しない", () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
      maxQueueSize: 1,
    });
    // dialog を 2 件出しても削除されない
    void manager.dialog({ message: "d1" });
    void manager.dialog({ message: "d2" });
    expect(manager.getAll()).toHaveLength(2);
  });
});

describe("createNotificationManager / dialog", () => {
  // dialog は resolveDialog で解決される
  it("dialog() は resolveDialog で解決する", async () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
    });
    // 追加直後に解決する Promise
    const p = manager.dialog({ message: "ok?" });
    // pending な dialog の ID は id-1（連番）
    manager.resolveDialog("id-1", "yes");
    const result = await p;
    // 解決値
    expect(result.dismissed).toBe(true);
    expect(result.reason).toBe("yes");
    // キューから削除されている
    expect(manager.getAll()).toEqual([]);
  });

  // 未知 ID への resolveDialog は何もしない（idempotent）
  it("未知 ID への resolveDialog は no-op", () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    // throw しない
    expect(() => manager.resolveDialog("unknown", "x")).not.toThrow();
  });

  // dismiss(id) は pending な dialog を未指定 reason で解決
  it("dismiss は pending な dialog を未指定 reason で解決する", async () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    const p = manager.dialog({ message: "x" });
    manager.dismiss("id-1");
    const result = await p;
    expect(result.dismissed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // listener が emit("add") の中で同期的に resolveDialog を呼んでも Promise が解決されること
  // (Critical: pending 登録が emit より前に行われない実装だと永久未解決になっていた)
  it("listener が add イベント内で同期的に resolveDialog しても Promise が解決される", async () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    // add イベントの中で即座に resolveDialog を呼ぶ listener を仕掛ける
    manager.subscribe((ev: NotificationEvent) => {
      // dialog の add だけ反応
      if (ev.type === "add" && ev.notification.kind === "dialog") {
        // 同期的に解決を要求 (pending 未登録なら no-op になり Promise は永久未解決)
        manager.resolveDialog(ev.notification.id, "auto");
      }
    });
    // dialog を発行
    const p = manager.dialog({ message: "sync resolve" });
    // 同期解決が走っているはずなので即座に解決する
    const result = await p;
    expect(result.dismissed).toBe(true);
    expect(result.reason).toBe("auto");
    // 同期解決により queue 上からも削除されている
    expect(manager.getAll()).toEqual([]);
  });

  // listener が add イベント内で同期的に dismiss しても Promise が解決されること
  it("listener が add イベント内で同期的に dismiss しても Promise が解決される", async () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    manager.subscribe((ev: NotificationEvent) => {
      if (ev.type === "add" && ev.notification.kind === "dialog") {
        // dismiss でも pending が登録済みなら解決される
        manager.dismiss(ev.notification.id);
      }
    });
    const p = manager.dialog({ message: "sync dismiss" });
    const result = await p;
    expect(result.dismissed).toBe(true);
    // dismiss 経路では reason は付かない
    expect(result.reason).toBeUndefined();
  });

  // 同期解決 listener が居ても、他の listener にも add / remove 両イベントが到達すること
  // (emit 内の Array.from(listeners) スナップショット走査が壊れていないことの確認)
  it("同期解決 listener が居ても他の listener にも add / remove 両イベントが届く", async () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    // 同期解決 listener
    manager.subscribe((ev: NotificationEvent) => {
      if (ev.type === "add" && ev.notification.kind === "dialog") {
        manager.resolveDialog(ev.notification.id, "auto");
      }
    });
    // 観測用 listener
    const observed: NotificationEvent[] = [];
    manager.subscribe((ev: NotificationEvent) => {
      observed.push(ev);
    });
    const p = manager.dialog({ message: "x" });
    await p;
    // 観測用 listener には add と remove が 1 件ずつ届くはず (順序は recursive emit の影響で前後しうる)
    expect(observed.length).toBe(2);
    const types = observed.map((e) => e.type).sort();
    expect(types).toEqual(["add", "remove"]);
    // add イベントの notification.kind は dialog であること
    const addEvent = observed.find((e) => e.type === "add");
    expect(addEvent?.type === "add" && addEvent.notification.kind).toBe("dialog");
  });
});

describe("createNotificationManager / confirm", () => {
  // confirm は true で解決
  it("confirm() は resolveConfirm(true) で true を返す", async () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    const p = manager.confirm({ message: "delete?" });
    manager.resolveConfirm("id-1", true);
    expect(await p).toBe(true);
  });

  // confirm は false で解決
  it("confirm() は resolveConfirm(false) で false を返す", async () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    const p = manager.confirm({ message: "delete?" });
    manager.resolveConfirm("id-1", false);
    expect(await p).toBe(false);
  });

  // 未知 ID への resolveConfirm は no-op
  it("未知 ID への resolveConfirm は no-op", () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    expect(() => manager.resolveConfirm("unknown", true)).not.toThrow();
  });

  // dismiss は pending な confirm を false で解決
  it("dismiss は pending な confirm を false で解決する", async () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    const p = manager.confirm({ message: "x" });
    manager.dismiss("id-1");
    expect(await p).toBe(false);
  });

  // listener が emit("add") の中で同期的に resolveConfirm を呼んでも Promise が解決されること
  // (Critical: pending 登録が emit より前に行われない実装だと永久未解決になっていた)
  it("listener が add イベント内で同期的に resolveConfirm しても Promise が解決される", async () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    manager.subscribe((ev: NotificationEvent) => {
      if (ev.type === "add" && ev.notification.kind === "confirm") {
        // 同期的に true で解決
        manager.resolveConfirm(ev.notification.id, true);
      }
    });
    const p = manager.confirm({ message: "delete?" });
    // 同期解決で true が返るはず (永久未解決にならない)
    expect(await p).toBe(true);
    expect(manager.getAll()).toEqual([]);
  });
});

describe("createNotificationManager / dismissAll / dispose", () => {
  // dismissAll(kind) で指定種別だけ閉じる
  it("dismissAll('toast') は toast のみ閉じる", () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    manager.toast({ message: "t" });
    void manager.dialog({ message: "d" });
    manager.dismissAll("toast");
    // toast は消え、dialog は残る
    const all = manager.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.kind).toBe("dialog");
  });

  // dismissAll() は全種別を閉じる
  it("dismissAll() は全種別を閉じる", async () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    manager.toast({ message: "t" });
    const dialogPromise = manager.dialog({ message: "d" });
    const confirmPromise = manager.confirm({ message: "c" });
    manager.dismissAll();
    // 全部消える
    expect(manager.getAll()).toEqual([]);
    // dialog は dismissed:true で解決
    await expect(dialogPromise).resolves.toEqual({ dismissed: true });
    // confirm は false で解決
    await expect(confirmPromise).resolves.toBe(false);
  });

  // dispose: タイマー停止と pending 解決を一括で行う
  it("dispose() は全タイマー停止と pending な dialog/confirm の解決を行う", async () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
    });
    // 自動 dismiss 付き toast を出す（タイマーが残る）
    manager.toast({ message: "t", duration: 100 });
    // 未解決 dialog / confirm
    const dialogPromise = manager.dialog({ message: "d" });
    const confirmPromise = manager.confirm({ message: "c" });
    // dispose
    manager.dispose();
    // タイマーが全て解除されている
    expect(fake.pending()).toBe(0);
    // Promise が解決されている
    await expect(dialogPromise).resolves.toEqual({ dismissed: true });
    await expect(confirmPromise).resolves.toBe(false);
    // キューも空
    expect(manager.getAll()).toEqual([]);
  });

  // dispose: listener にキュー全件の remove イベントが届く
  it("dispose() は queue 内の全通知に対して remove イベントを発火する", () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
    });
    // dispose 前の通知一覧（toast 2 件 + dialog 1 件 + confirm 1 件）
    manager.toast({ message: "t1" });
    manager.toast({ message: "t2" });
    void manager.dialog({ message: "d" });
    void manager.confirm({ message: "c" });
    // dispose 後に受信するイベントを記録
    const removedTypes: string[] = [];
    manager.subscribe((e) => {
      if (e.type === "remove") removedTypes.push(e.notification.kind);
    });
    // dispose を実行
    manager.dispose();
    // queue 内の 4 件分の remove イベントが届く（順序は add 順）
    expect(removedTypes).toEqual(["toast", "toast", "dialog", "confirm"]);
  });

  // dispose: 二度目以降の呼び出しは no-op
  it("dispose() の二度目以降は no-op（冪等）", () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    manager.toast({ message: "t" });
    const events: NotificationEvent[] = [];
    manager.subscribe((e) => events.push(e));
    // 1 回目の dispose で 1 件の remove が届く
    manager.dispose();
    expect(events.filter((e) => e.type === "remove")).toHaveLength(1);
    // 2 回目の dispose では新たなイベントが届かない
    manager.dispose();
    expect(events.filter((e) => e.type === "remove")).toHaveLength(1);
  });

  // dispose 後の toast は空文字 ID を返し、queue / タイマーに残らない
  it("dispose 後の toast は空文字 ID を返し queue にもタイマーにも残らない", () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
    });
    // dispose 後に subscribe したつもりの listener も登録されない（後述ケースで検証）
    manager.dispose();
    // toast 呼び出し
    const id = manager.toast({ message: "after-dispose", duration: 100 });
    // ID は空文字
    expect(id).toBe("");
    // queue は空のまま
    expect(manager.getAll()).toEqual([]);
    // タイマーも設定されていない（dispose 後ガードで scheduleAutoDismiss 自体が呼ばれない）
    expect(fake.pending()).toBe(0);
  });

  // dispose 後の dialog は即 dismissed:true で解決される
  it("dispose 後の dialog は即 dismissed:true で解決される", async () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    manager.dispose();
    await expect(manager.dialog({ message: "x" })).resolves.toEqual({ dismissed: true });
    // queue にも積まれない
    expect(manager.getAll()).toEqual([]);
  });

  // dispose 後の confirm は即 false で解決される
  it("dispose 後の confirm は即 false で解決される", async () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    manager.dispose();
    await expect(manager.confirm({ message: "x" })).resolves.toBe(false);
    expect(manager.getAll()).toEqual([]);
  });

  // dispose 後の dismiss / dismissAll / resolveDialog / resolveConfirm は no-op
  it("dispose 後の dismiss 系メソッドは throw せず何も起きない", () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    manager.dispose();
    // どれも throw しない
    expect(() => manager.dismiss("any")).not.toThrow();
    expect(() => manager.dismissAll()).not.toThrow();
    expect(() => manager.dismissAll("toast")).not.toThrow();
    expect(() => manager.resolveDialog("any", "reason")).not.toThrow();
    expect(() => manager.resolveConfirm("any", true)).not.toThrow();
    // 影響なし
    expect(manager.getAll()).toEqual([]);
  });

  // dispose 後の subscribe は no-op の解除関数を返す（listener は登録されない）
  it("dispose 後の subscribe は no-op の解除関数を返す", () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    manager.dispose();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    // 解除関数を呼んでも throw しない
    expect(() => unsubscribe()).not.toThrow();
    // listener が呼ばれる経路がそもそも無いことを別途確認するため、新たな toast を試す
    manager.toast({ message: "x" });
    expect(listener).not.toHaveBeenCalled();
  });

  // subscribe の解除関数で listener が外れる
  it("unsubscribe で listener にイベントが届かなくなる", () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    const events: NotificationEvent[] = [];
    const unsubscribe = manager.subscribe((e) => events.push(e));
    manager.toast({ message: "first" });
    unsubscribe();
    manager.toast({ message: "second" });
    // 1 件目しか受け取れない
    expect(events).toHaveLength(1);
  });

  // listener が throw しても他の listener に波及しない
  it("listener が throw しても他の listener はイベントを受け取る", () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    const captured: NotificationEvent[] = [];
    manager.subscribe(() => {
      throw new Error("boom");
    });
    manager.subscribe((e) => captured.push(e));
    manager.toast({ message: "x" });
    expect(captured).toHaveLength(1);
  });

  // 不明 ID に対する dismiss は no-op
  it("不明 ID への dismiss は何もしない", () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    expect(() => manager.dismiss("missing")).not.toThrow();
    expect(manager.getAll()).toEqual([]);
  });
});

describe("createNotificationManager / 既定実装と timer 注入", () => {
  // manager 生成時にも公開 schema と同じ制約で config を検証する
  it("不正な manager config は生成時に reject される", () => {
    expect(() => createNotificationManager({ defaultDuration: -1 })).toThrow();
    expect(() => createNotificationManager({ maxQueueSize: 0 })).toThrow();
  });

  // 既定 timer / idFactory / now を使った場合も動作する
  it("既定の timer / idFactory / now で toast が登録される", () => {
    const manager = createNotificationManager();
    const id = manager.toast({ message: "default" });
    expect(typeof id).toBe("string");
    expect(manager.getAll()).toHaveLength(1);
  });

  // 既定 timer は実 setTimeout を使うため duration 経過で消える
  it("実 setTimeout を使った場合も duration 経過で消える", async () => {
    // 実時間で動くのでタイムアウトを短く
    const manager = createNotificationManager();
    manager.toast({ message: "x", duration: 5 });
    await new Promise((r) => setTimeout(r, 30));
    expect(manager.getAll()).toEqual([]);
  });

  // 既定 timer の clear が dismiss 経由で呼ばれる（DEFAULT_TIMER.clear のカバレッジ）
  it("実 setTimeout 使用時に手動 dismiss でタイマーが解除される", () => {
    // 既定 timer を使う
    const manager = createNotificationManager();
    // 長めの duration で toast を発行
    const id = manager.toast({ message: "x", duration: 60_000 });
    // タイマー満了前に手動 dismiss（内部で clearTimeout が呼ばれる）
    manager.dismiss(id);
    // キューが空になっている
    expect(manager.getAll()).toEqual([]);
  });

  // toast の確認: getAll はスナップショットを返す（内部状態を改変できない）
  it("getAll は配列スナップショットを返し、外部の改変は内部に影響しない", () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    manager.toast({ message: "a" });
    const snapshot = manager.getAll();
    // 戻り値を空にしてみる
    (snapshot as unknown as { length: number }).length = 0;
    // 内部キューは健在
    expect(manager.getAll()).toHaveLength(1);
  });

  it("getAll が返す通知本体とネスト値は runtime immutable", () => {
    const manager = createNotificationManager({ idFactory: createSequentialIdFactory() });
    manager.toast({
      message: "a",
      actions: [{ id: "undo", label: "Undo" }],
      meta: { source: "test" },
    });

    const notification = manager.getAll()[0];
    expect(Object.isFrozen(notification)).toBe(true);
    if (notification?.kind === "toast") {
      expect(Object.isFrozen(notification.actions)).toBe(true);
      expect(Object.isFrozen(notification.actions?.[0])).toBe(true);
    }
    expect(Object.isFrozen(notification?.meta)).toBe(true);

    expect(() => {
      (notification as { message: string }).message = "mutated";
    }).toThrow(TypeError);
    expect(manager.getAll()[0]?.message).toBe("a");
  });

  // toast 入力で全プロパティが反映される
  it("toast 入力の全プロパティが反映される", () => {
    const manager = createNotificationManager({
      idFactory: createSequentialIdFactory(),
      now: () => 9999,
    });
    manager.toast({
      level: "success",
      title: "T",
      message: "M",
      duration: 0,
      actions: [{ id: "a1", label: "Undo" }],
      meta: { k: "v" },
      dedupeKey: "dk",
    });
    const n = manager.getAll()[0];
    expect(n?.id).toBe("id-1");
    expect(n?.kind).toBe("toast");
    expect(n?.level).toBe("success");
    expect(n?.title).toBe("T");
    expect(n?.message).toBe("M");
    expect(n?.meta?.k).toBe("v");
    expect(n?.dedupeKey).toBe("dk");
    expect(n?.createdAt).toBe(9999);
    // toast 限定プロパティを確認
    if (n?.kind === "toast") {
      expect(n.duration).toBe(0);
      expect(n.actions?.[0]?.label).toBe("Undo");
    }
  });

  // dialog 入力の全プロパティが反映される
  it("dialog 入力の全プロパティが反映される", () => {
    const manager = createNotificationManager({
      idFactory: createSequentialIdFactory(),
      now: () => 1,
    });
    void manager.dialog({
      level: "warning",
      title: "T",
      message: "M",
      actions: [{ id: "ok", label: "OK", intent: "primary" }],
      dismissible: false,
      meta: { x: 1 },
      dedupeKey: "dk",
    });
    const n = manager.getAll()[0];
    if (n?.kind === "dialog") {
      expect(n.dismissible).toBe(false);
      expect(n.actions?.[0]?.intent).toBe("primary");
    }
  });

  // confirm 入力の全プロパティが反映される
  it("confirm 入力の全プロパティが反映される", () => {
    const manager = createNotificationManager({
      idFactory: createSequentialIdFactory(),
      now: () => 1,
    });
    void manager.confirm({
      title: "T",
      message: "M",
      confirmLabel: "Yes",
      cancelLabel: "No",
      destructive: true,
      meta: { y: 2 },
      dedupeKey: "dk",
    });
    const n = manager.getAll()[0];
    if (n?.kind === "confirm") {
      expect(n.confirmLabel).toBe("Yes");
      expect(n.cancelLabel).toBe("No");
      expect(n.destructive).toBe(true);
      expect(n.level).toBe("warning");
    }
  });
});

describe("createNotificationManager / 内部状態保護", () => {
  // タイマー発火後にもう一度 dismiss しても安全
  it("自動 dismiss 後に再度 dismiss を呼んでも no-op", () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
    });
    manager.toast({ message: "x", duration: 50 });
    fake.runAll();
    // 二回目の dismiss
    expect(() => manager.dismiss("id-1")).not.toThrow();
  });

  // 完全に空状態の dismissAll は安全
  it("空状態の dismissAll は no-op", () => {
    const manager = createNotificationManager();
    expect(() => manager.dismissAll()).not.toThrow();
    expect(() => manager.dismissAll("toast")).not.toThrow();
  });

  // listener へのイベント順序：通知発行と即時自動 dismiss
  it("listener は add -> remove の順でイベントを受け取る", () => {
    const fake = createFakeTimer();
    const manager = createNotificationManager({
      timer: fake.timer,
      idFactory: createSequentialIdFactory(),
    });
    const listener = vi.fn();
    manager.subscribe(listener);
    manager.toast({ message: "x", duration: 10 });
    fake.runAll();
    // 2 件のイベント
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0]?.[0].type).toBe("add");
    expect(listener.mock.calls[1]?.[0].type).toBe("remove");
  });
});
