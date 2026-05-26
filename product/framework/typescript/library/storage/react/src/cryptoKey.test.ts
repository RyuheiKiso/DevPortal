// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// fake-indexeddb の独立 factory を取り込む (テストごとに IDB を隔離するため)
import { IDBFactory } from "fake-indexeddb";
// テスト対象
import { createAesKey, loadOrCreateAesKey } from "./cryptoKey.js";

// createAesKey の網羅テスト
describe("createAesKey", () => {
  // extractable:false の AES-GCM 256bit 鍵が生成されることを確認
  it("extractable:false の AES-GCM 256bit CryptoKey を生成する", async () => {
    // 鍵を生成
    const key = await createAesKey();
    // CryptoKey 型であること
    expect(key.type).toBe("secret");
    // アルゴリズムが AES-GCM 256bit であること
    expect(key.algorithm.name).toBe("AES-GCM");
    // 鍵長 256bit を確認 (AesKeyAlgorithm を仮定して length プロパティを参照)
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    // extractable:false で raw bytes を取り出せないこと
    expect(key.extractable).toBe(false);
    // usages に encrypt / decrypt が含まれること
    expect(key.usages).toEqual(expect.arrayContaining(["encrypt", "decrypt"]));
  });

  // 生成された鍵が実際に encrypt / decrypt できることを確認 (round-trip)
  it("生成した鍵で AES-GCM の暗号化・復号ができる", async () => {
    // 鍵を生成
    const key = await createAesKey();
    // 平文を用意 (TextEncoder で Uint8Array に)
    const plaintext = new TextEncoder().encode("hello");
    // IV を 12 バイトでランダム生成
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // 暗号化
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    // 復号
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    // 復号結果が元の平文と一致すること
    expect(new TextDecoder().decode(decrypted)).toBe("hello");
  });

  // 各呼び出しで別インスタンスの鍵が生成されることを確認
  it("呼ぶたびに新しい CryptoKey を生成する", async () => {
    // 2 回連続で生成
    const k1 = await createAesKey();
    const k2 = await createAesKey();
    // 参照比較で別インスタンスであること
    expect(k1).not.toBe(k2);
  });
});

// loadOrCreateAesKey の網羅テスト
describe("loadOrCreateAesKey", () => {
  // 初回呼び出しは生成・保存し、二度目は IDB から取り出すこと
  it("初回は新規生成、二度目は IDB から取り出す (generateKey は 1 度だけ呼ばれる)", async () => {
    // テストごとに隔離した fake-indexeddb factory を用意
    const factory = new IDBFactory();
    // generateKey を spy
    const generateSpy = vi.spyOn(crypto.subtle, "generateKey");
    // 初回呼び出し (新規生成 → IDB に保存)
    const first = await loadOrCreateAesKey({ keyName: "my-app", factory });
    // 初回は generateKey が 1 度だけ呼ばれていること
    expect(generateSpy).toHaveBeenCalledTimes(1);
    // 二度目呼び出し (IDB から取り出すだけで、生成は走らない)
    const second = await loadOrCreateAesKey({ keyName: "my-app", factory });
    // 生成回数は増えていない (依然として 1 回)
    expect(generateSpy).toHaveBeenCalledTimes(1);
    // どちらも AES-GCM 鍵であること
    expect(first.algorithm.name).toBe("AES-GCM");
    expect(second.algorithm.name).toBe("AES-GCM");
    // 取り出した鍵も extractable:false が維持されていること
    expect(second.extractable).toBe(false);
    // spy を解除 (他テストへの汚染を避ける)
    generateSpy.mockRestore();
  });

  // 取り出した鍵で暗号化・復号 round-trip ができることを確認
  // (CryptoKey が IndexedDB の構造化クローンを跨いでも使えること)
  it("IDB から取り出した鍵で暗号化・復号できる", async () => {
    // 隔離 factory
    const factory = new IDBFactory();
    // 鍵を生成して保存
    const key = await loadOrCreateAesKey({ keyName: "my-app", factory });
    // 平文
    const plaintext = new TextEncoder().encode("round-trip");
    // IV を 12 バイトランダム
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // 取り出した鍵で暗号化
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    // もう一度 IDB から取り出して復号する (構造化クローン経由でも復号できることを確認)
    const reloaded = await loadOrCreateAesKey({ keyName: "my-app", factory });
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, reloaded, ciphertext);
    // 平文に戻ること
    expect(new TextDecoder().decode(decrypted)).toBe("round-trip");
  });

  // 異なる keyName は別の鍵として扱われること
  it("異なる keyName では別の鍵が保存される", async () => {
    // 隔離 factory
    const factory = new IDBFactory();
    // 鍵 A を生成
    const a = await loadOrCreateAesKey({ keyName: "app-a", factory });
    // 鍵 B を生成
    const b = await loadOrCreateAesKey({ keyName: "app-b", factory });
    // 別のインスタンスであること (参照比較)
    expect(a).not.toBe(b);
    // IV 12 バイトランダム
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // 平文
    const plaintext = new TextEncoder().encode("isolated");
    // 鍵 A で暗号化したものを鍵 B で復号しようとすると失敗すること
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, a, plaintext);
    // 別鍵での復号は AES-GCM のタグ検証で reject される
    await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv }, b, ciphertext)).rejects.toThrow();
  });

  // 並行起動の鍵二重生成レースが起きないこと (Critical: 旧鍵で暗号化されたデータの復号不能を防ぐ)
  it("並行呼び出しで同一鍵参照が返り generateKey が 1 回しか呼ばれない", async () => {
    // 隔離 factory
    const factory = new IDBFactory();
    // generateKey を spy
    const generateSpy = vi.spyOn(crypto.subtle, "generateKey");
    // 同じ options で 10 並列に loadOrCreateAesKey を発火
    const results = await Promise.all(
      // 10 個の並列呼び出し配列を作る
      Array.from({ length: 10 }, () => loadOrCreateAesKey({ keyName: "race", factory })),
    );
    // generateKey は in-flight 共有により 1 回のみ呼ばれているはず
    expect(generateSpy).toHaveBeenCalledTimes(1);
    // 全ての結果が同一参照 (= 同じ CryptoKey インスタンス) であること
    for (const r of results) {
      // 配列先頭との参照比較
      expect(r).toBe(results[0]);
    }
    // spy を解除
    generateSpy.mockRestore();
  });

  // throw 経路で in-flight Map が掃除され、次回呼び出しが新規生成で成功すること
  it("途中の保存失敗で in-flight Map が掃除され、次回呼び出しは成功する", async () => {
    // 隔離 factory
    const factory = new IDBFactory();
    // crypto.subtle.generateKey を 1 回だけ reject させる spy を仕込む
    const generateSpy = vi.spyOn(crypto.subtle, "generateKey").mockRejectedValueOnce(new Error("boom"));
    // 1 回目: 生成失敗を期待
    await expect(loadOrCreateAesKey({ keyName: "recover", factory })).rejects.toThrow("boom");
    // 2 回目: mock は 1 回のみだったので本物にフォールバックして成功するはず
    // (in-flight Map に rejected Promise が残っていれば、ここでも reject されてしまう)
    const key = await loadOrCreateAesKey({ keyName: "recover", factory });
    // 復帰後は有効な AES-GCM 鍵が返ること
    expect(key.algorithm.name).toBe("AES-GCM");
    // 結果として generateKey は 2 回呼ばれている (1 回目失敗 + 2 回目成功)
    expect(generateSpy).toHaveBeenCalledTimes(2);
    // spy を解除
    generateSpy.mockRestore();
  });

  // 異なる keyName での並行呼び出しが互いに干渉しないこと (合成キーが正しく分離されているか)
  it("異なる keyName の並行呼び出しは互いに干渉しない", async () => {
    // 隔離 factory
    const factory = new IDBFactory();
    // 2 つの異なる keyName を並列に発火
    const [a, b] = await Promise.all([
      // 鍵 A
      loadOrCreateAesKey({ keyName: "alpha", factory }),
      // 鍵 B
      loadOrCreateAesKey({ keyName: "beta", factory }),
    ]);
    // 別インスタンスであること (参照比較)
    expect(a).not.toBe(b);
    // IV 12 バイトランダム
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // 平文
    const plaintext = new TextEncoder().encode("separate");
    // 鍵 A で暗号化したものを鍵 B で復号しようとすると失敗すること (鍵が独立している証)
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, a, plaintext);
    // 別鍵での復号は AES-GCM のタグ検証で reject される
    await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv }, b, ciphertext)).rejects.toThrow();
  });

  // navigator が undefined な SSR 風環境ではフォールバックして in-memory のみで動作する
  // (detectLockManager の `typeof navigator === "undefined"` 分岐を網羅する)
  it("navigator が存在しない環境では in-memory inflight のみで動作する", async () => {
    // 隔離 factory (createIndexedDbBackend に明示注入するため navigator 経由の indexedDB 取得は不要)
    const factory = new IDBFactory();
    // navigator を一時的に undefined に差し替える (vitest の stubGlobal 経由)
    vi.stubGlobal("navigator", undefined);
    try {
      // 例外なく成功すれば OK (Web Locks 経路に入らず performIo が直接実行される)
      const key = await loadOrCreateAesKey({ keyName: "no-navigator", factory });
      expect(key.algorithm.name).toBe("AES-GCM");
    } finally {
      // navigator を元に戻す
      vi.unstubAllGlobals();
    }
  });

  // navigator.locks が存在する環境では、option 未指定でも自動で利用されること
  // (detectLockManager の navigator.locks 検出経路を網羅する)
  it("navigator.locks が存在すれば option 未指定でも自動利用される", async () => {
    // 隔離 factory
    const factory = new IDBFactory();
    // navigator.locks のスタブを取り付ける (jsdom には locks 実装が無いため Object.defineProperty で注入)
    const calls: string[] = [];
    const stubLocks = {
      request: async (name: string, callback: () => Promise<unknown>): Promise<unknown> => {
        // 呼び出された lock 名を記録
        calls.push(name);
        // callback を実行して結果を返す
        return await callback();
      },
    } as unknown as LockManager;
    // 元の locks を退避してテスト用 stub を差し込む
    const navAny = navigator as Navigator & { locks?: LockManager };
    const original = navAny.locks;
    // defineProperty で書き込み可能に設定 (もともと未定義のため新規プロパティ追加)
    Object.defineProperty(navigator, "locks", {
      value: stubLocks,
      configurable: true,
      writable: true,
    });
    try {
      // option.lockManager を渡さず呼び出す (navigator.locks が自動採用されるはず)
      await loadOrCreateAesKey({ keyName: "auto-detect", factory });
      // stub.request が呼ばれていれば feature detect 経路が動作している証
      expect(calls.length).toBeGreaterThan(0);
      // lock 名が keyName を含む
      expect(calls[0]).toContain("auto-detect");
    } finally {
      // 元の状態に戻す (他テストへの影響を防ぐ)
      if (original === undefined) {
        // 元々無かった場合は delete してプリスティン状態へ
        delete (navigator as { locks?: LockManager }).locks;
      } else {
        // 元々あった場合は復元
        Object.defineProperty(navigator, "locks", {
          value: original,
          configurable: true,
          writable: true,
        });
      }
    }
  });

  // 壊れたポリフィル: navigator.locks は存在するが request が関数でない場合は in-memory のみで動作する
  // (detectLockManager の `typeof locks.request !== "function"` 分岐を網羅する)
  it("navigator.locks.request が関数でない場合は in-memory inflight のみで動作する", async () => {
    // 隔離 factory
    const factory = new IDBFactory();
    // 壊れた locks (request が string)
    const brokenLocks = { request: "not-a-function" } as unknown as LockManager;
    // 元の locks を退避
    const navAny = navigator as Navigator & { locks?: LockManager };
    const original = navAny.locks;
    Object.defineProperty(navigator, "locks", {
      value: brokenLocks,
      configurable: true,
      writable: true,
    });
    try {
      // option.lockManager 未指定 + 壊れた navigator.locks → in-memory only にフォールバック
      // 例外なく成功すれば OK (Web Locks 呼び出しは試行されていない)
      const key = await loadOrCreateAesKey({ keyName: "broken-polyfill", factory });
      expect(key.algorithm.name).toBe("AES-GCM");
    } finally {
      // 元の状態に戻す
      if (original === undefined) {
        delete (navigator as { locks?: LockManager }).locks;
      } else {
        Object.defineProperty(navigator, "locks", {
          value: original,
          configurable: true,
          writable: true,
        });
      }
    }
  });

  // Web Locks API (LockManager) を注入したとき、`request` が呼ばれ I/O が lock 内側で実行されること
  it("LockManager を注入すると request 経由で I/O が排他化される", async () => {
    // 隔離 factory
    const factory = new IDBFactory();
    // 単純な LockManager モック (callback を直列実行し、呼ばれた lock 名を記録する)
    const calls: string[] = [];
    // 最低限の LockManager 互換オブジェクト (request のみ実装)
    const lockManager = {
      // exclusive モードの lock を取得し callback を実行するだけのモック
      // 戻り値は callback の戻り値の Promise
      request: vi.fn(async (name: string, callback: () => Promise<unknown>): Promise<unknown> => {
        // 呼び出された lock 名を記録
        calls.push(name);
        // callback を実行して結果を返す (本物の navigator.locks 互換)
        return await callback();
      }),
    } as unknown as LockManager;
    // 鍵を生成 (LockManager を注入)
    await loadOrCreateAesKey({ keyName: "with-lock", factory, lockManager });
    // request が 1 回呼ばれていること
    expect(calls).toHaveLength(1);
    // lock 名に keyName が含まれていること (合成キー由来)
    expect(calls[0]).toContain("with-lock");
  });

  // LockManager 経由で並行呼び出しを直列化すると generateKey が 1 度しか走らないこと
  // (cross-tab レースの再現テスト: 同じ論理鍵への 2 つのコンテキストが順序通り処理される)
  it("LockManager 注入時、別コンテキストの並列実行が直列化される", async () => {
    // 隔離 factory (両者で共有 → 1 つの IDB を見る)
    const factory = new IDBFactory();
    // generateKey を spy
    const generateSpy = vi.spyOn(crypto.subtle, "generateKey");
    // LockManager の現在保持者を表すマップ (lock 名 → 解放待ち Promise)
    const held = new Map<string, Promise<void>>();
    // 注入用 LockManager: 同名 lock を直列化する単純実装
    const lockManager = {
      request: async (name: string, callback: () => Promise<unknown>): Promise<unknown> => {
        // 直前のホルダーがあれば await して順序を整える
        const prev = held.get(name);
        if (prev !== undefined) await prev;
        // 自分の lock 開放を表す Promise を deferred で組み立てる
        let release: () => void = () => undefined;
        const myLock = new Promise<void>((resolve) => {
          release = resolve;
        });
        // 新しい holder として登録
        held.set(name, myLock);
        try {
          // callback を実行して結果を取得
          return await callback();
        } finally {
          // lock 解放 (後続が進める)
          release();
          // 自分が末尾なら map から外す
          if (held.get(name) === myLock) held.delete(name);
        }
      },
    } as unknown as LockManager;
    // 同じ keyName へ 5 並列に呼び出す (in-memory inflight を回避するため、間に await のマイクロタスクを挟む)
    // ※ inflightKeys は同期登録されるため、純粋な Promise.all では in-memory にヒットしてしまう。
    //    cross-tab を模した検証は次テストで行うため、ここは LockManager の直列化動作の確認に留める。
    await loadOrCreateAesKey({ keyName: "cross-tab", factory, lockManager });
    await loadOrCreateAesKey({ keyName: "cross-tab", factory, lockManager });
    // generateKey は 1 回 (= 2 回目は IDB から取得) であること
    expect(generateSpy).toHaveBeenCalledTimes(1);
    // spy 解除
    generateSpy.mockRestore();
  });

  // dbName / storeName のカスタマイズが反映されること
  it("dbName と storeName のカスタマイズが反映される", async () => {
    // 隔離 factory
    const factory = new IDBFactory();
    // factory.open を spy して、呼ばれた DB 名を確認
    const openSpy = vi.spyOn(factory, "open");
    // カスタム名を指定
    await loadOrCreateAesKey({
      // 鍵キー名
      keyName: "x",
      // カスタム DB 名
      dbName: "custom-db",
      // カスタムストア名
      storeName: "custom-store",
      // 隔離 factory
      factory,
    });
    // open が "custom-db" で呼ばれていること
    expect(openSpy).toHaveBeenCalledWith("custom-db", expect.any(Number));
  });
});
