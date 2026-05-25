// vitest API を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { createCookieBackend } from "./cookie.js";

// document.cookie の挙動を模した最小スタブ
// 単純な「最後に set された 1 key だけを既存マップにマージ」する書き込み挙動を再現する
function createDocStub(initial: string = ""): { cookie: string } {
  // 内部状態は文字列のみ (cookie プロパティ越しに公開)
  let cookieString = initial;
  // setter は受け取った文字列から「key=value」を抽出し、既存マップに上書き
  const doc = {
    get cookie(): string {
      return cookieString;
    },
    set cookie(input: string) {
      // 既存をパース (簡易)
      const map = new Map<string, string>();
      // 空でなければ既存を取り込む
      if (cookieString !== "") {
        for (const part of cookieString.split(";")) {
          const trimmed = part.trim();
          if (trimmed === "") continue;
          const eq = trimmed.indexOf("=");
          if (eq === -1) {
            map.set(trimmed, "");
          } else {
            map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
          }
        }
      }
      // 新規入力を解析: 最初の "; " より前が key=value、後ろが属性
      const semicolon = input.indexOf(";");
      const kv = semicolon === -1 ? input : input.slice(0, semicolon);
      const attrs = semicolon === -1 ? "" : input.slice(semicolon);
      const eq = kv.indexOf("=");
      const key = eq === -1 ? kv : kv.slice(0, eq);
      const value = eq === -1 ? "" : kv.slice(eq + 1);
      // Max-Age=0 か Max-Age=-... を検出して削除扱い
      const isDelete = /Max-Age\s*=\s*-?0/i.test(attrs);
      if (isDelete) {
        map.delete(key);
      } else {
        map.set(key, value);
      }
      // 直列化して保存
      const parts: string[] = [];
      for (const [k, v] of map.entries()) {
        parts.push(`${k}=${v}`);
      }
      cookieString = parts.join("; ");
    },
  };
  return doc;
}

// createCookieBackend の網羅テスト
describe("createCookieBackend", () => {
  // 基本 round-trip (注入 document)
  it("round-trips encoded values via the provided document", async () => {
    const doc = createDocStub();
    const store = createCookieBackend({ document: doc });
    await store.set("auth", "abc=xyz; with spaces");
    // 取得結果は URI デコード済み
    await expect(store.get("auth")).resolves.toBe("abc=xyz; with spaces");
    // 内部の cookie 文字列には URI エンコード済みで入っている
    expect(doc.cookie).toContain("auth=abc%3Dxyz%3B%20with%20spaces");
  });
  // remove で消える
  it("removes a value with Max-Age=0", async () => {
    const doc = createDocStub();
    const store = createCookieBackend({ document: doc });
    await store.set("k", "v");
    await store.remove("k");
    // 取得は undefined
    await expect(store.get("k")).resolves.toBeUndefined();
  });
  // has 動作
  it("has reflects presence", async () => {
    const doc = createDocStub();
    const store = createCookieBackend({ document: doc });
    await expect(store.has?.("k")).resolves.toBe(false);
    await store.set("k", "v");
    await expect(store.has?.("k")).resolves.toBe(true);
  });
  // 未保存 get は undefined
  it("returns undefined for missing keys", async () => {
    const doc = createDocStub();
    const store = createCookieBackend({ document: doc });
    await expect(store.get("nope")).resolves.toBeUndefined();
  });
  // keys 一覧
  it("lists existing keys", async () => {
    const doc = createDocStub();
    const store = createCookieBackend({ document: doc });
    await store.set("a", "1");
    await store.set("b", "2");
    const keys = (await store.keys?.()) ?? [];
    expect([...keys].sort()).toEqual(["a", "b"]);
  });
  // clear が全削除する
  it("clear removes all keys", async () => {
    const doc = createDocStub();
    const store = createCookieBackend({ document: doc });
    await store.set("a", "1");
    await store.set("b", "2");
    await store.clear?.();
    await expect(store.keys?.()).resolves.toEqual([]);
  });
  // defaultAttributes が反映される
  it("applies defaultAttributes to set", async () => {
    let lastWritten = "";
    const doc: { cookie: string } = {
      get cookie() {
        return "";
      },
      set cookie(v: string) {
        lastWritten = v;
      },
    };
    const store = createCookieBackend({
      document: doc,
      defaultAttributes: { path: "/api", sameSite: "Strict", secure: true, domain: "example.com", maxAge: 3600 },
    });
    await store.set("k", "v");
    expect(lastWritten).toContain("Path=/api");
    expect(lastWritten).toContain("SameSite=Strict");
    expect(lastWritten).toContain("Secure");
    expect(lastWritten).toContain("Domain=example.com");
    expect(lastWritten).toContain("Max-Age=3600");
  });
  // 既定属性指定なし → Path=/ のみが付く (build attributes の空挙動を経由)
  it("uses default Path=/ when no defaultAttributes is given", async () => {
    let lastWritten = "";
    const doc: { cookie: string } = {
      get cookie() {
        return "";
      },
      set cookie(v: string) {
        lastWritten = v;
      },
    };
    const store = createCookieBackend({ document: doc });
    await store.set("k", "v");
    expect(lastWritten).toContain("Path=/");
  });
  // "=" 無しのトークンが pretrim 状態でも空文字値として登録される
  it("parses cookies without '=' as empty-value keys", async () => {
    // "= 無し" の cookie を直接持つドキュメント
    const doc = { cookie: "lonely; k=v" };
    const store = createCookieBackend({ document: doc });
    const keys = (await store.keys?.()) ?? [];
    expect([...keys].sort()).toEqual(["k", "lonely"]);
    await expect(store.get("lonely")).resolves.toBe("");
  });
  // 連続セミコロンで生まれる空トークンは無視される
  it("skips empty parts produced by consecutive semicolons", async () => {
    // 連続セミコロン入りの cookie
    const doc = { cookie: "a=1;;b=2" };
    const store = createCookieBackend({ document: doc });
    const keys = (await store.keys?.()) ?? [];
    expect([...keys].sort()).toEqual(["a", "b"]);
  });
  // defaultAttributes が指定されていても path が未指定の場合は "/" にフォールバックする
  it("falls back to Path=/ when defaultAttributes is given without path", async () => {
    let lastWritten = "";
    const doc: { cookie: string } = {
      get cookie() {
        return "";
      },
      set cookie(v: string) {
        lastWritten = v;
      },
    };
    // path だけ指定しない属性
    const store = createCookieBackend({ document: doc, defaultAttributes: { sameSite: "Lax" } });
    await store.set("k", "v");
    expect(lastWritten).toContain("Path=/");
    expect(lastWritten).toContain("SameSite=Lax");
  });
  // document 未指定時は window.document を使う (jsdom 環境で動作確認)
  it("uses window.document when document is not injected", async () => {
    // jsdom の document.cookie をリセット
    const before = document.cookie;
    // 注入無しでインスタンス化
    const store = createCookieBackend();
    await store.set("docless", "yes");
    // window.document.cookie に書き込まれている
    expect(document.cookie).toContain("docless=yes");
    // 後始末: 書き込んだクッキーを削除
    await store.remove("docless");
    // jsdom 環境では cookie が消えていれば OK
    expect(document.cookie.replace(before, "")).toBe("");
  });
});
