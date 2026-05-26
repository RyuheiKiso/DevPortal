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
