// 公開型を取り込み
import type { KvStore } from "@k1s0-ts-storage/core";

// cookie の属性
export interface CookieAttributes {
  // パス (既定 "/")
  path?: string;
  // ドメイン (省略時はブラウザ規定)
  domain?: string;
  // SameSite 属性
  sameSite?: "Strict" | "Lax" | "None";
  // Secure 属性 (https のみで送信)
  secure?: boolean;
  // 最大秒数 (省略時はセッションクッキー)
  maxAge?: number;
}

// createCookieBackend のオプション
export interface CreateCookieBackendOptions {
  // document の注入 (SSR 安全、テスト容易化)
  document?: { cookie: string };
  // 全 cookie に適用する既定属性
  defaultAttributes?: CookieAttributes;
}

// document.cookie 文字列をパースして key-value マップへ
function parseCookies(raw: string): Map<string, string> {
  // 結果マップ
  const map = new Map<string, string>();
  // 空文字なら空 Map
  if (raw === "") return map;
  // セミコロン + 任意の空白で分割
  const parts = raw.split(";");
  // 各部分を key=value に分解
  for (const part of parts) {
    // 前後の空白を除去
    const trimmed = part.trim();
    // 空要素はスキップ
    if (trimmed === "") continue;
    // 最初の "=" で 2 つに分割
    const eq = trimmed.indexOf("=");
    // "=" が無いキーは値空文字として扱う
    if (eq === -1) {
      // URI デコードを試みる (失敗してもキーはそのまま)
      map.set(decodeURIComponent(trimmed), "");
      continue;
    }
    // キーと値を取り出し URI デコード
    const key = decodeURIComponent(trimmed.slice(0, eq));
    const value = decodeURIComponent(trimmed.slice(eq + 1));
    // マップに格納
    map.set(key, value);
  }
  // 完成したマップを返す
  return map;
}

// 属性オブジェクトを cookie の文字列形式に変換
// Path は必ず付与するため戻り値は常に "; ..." の形になる (空文字には決してならない)
function buildAttributes(attrs: CookieAttributes): string {
  // 各属性を ; 連結する配列 (Path で初期化)
  const parts: string[] = [`Path=${attrs.path ?? "/"}`];
  // domain (指定時のみ)
  if (attrs.domain !== undefined) parts.push(`Domain=${attrs.domain}`);
  // sameSite (指定時のみ)
  if (attrs.sameSite !== undefined) parts.push(`SameSite=${attrs.sameSite}`);
  // secure (true のときのみ)
  if (attrs.secure === true) parts.push("Secure");
  // maxAge (指定時のみ)
  if (attrs.maxAge !== undefined) parts.push(`Max-Age=${attrs.maxAge}`);
  // 結合した文字列を返す (先頭に "; " 付き)
  return `; ${parts.join("; ")}`;
}

// document.cookie ベースの KvStore を生成する
// 値は string 専用 (URI エンコードして保存)
export function createCookieBackend(options?: CreateCookieBackendOptions): KvStore<string> {
  // document (注入優先、なければ window.document)
  const doc = options?.document ?? window.document;
  // 既定属性 (省略時は path "/")
  const defaultAttrs: CookieAttributes = options?.defaultAttributes ?? { path: "/" };
  // 完成した KvStore を返す
  return {
    // 取得: パースして該当 key を引く
    async get(key: string): Promise<string | undefined> {
      // 全 cookie をパース
      const map = parseCookies(doc.cookie);
      // 存在しなければ undefined
      return map.has(key) ? map.get(key) : undefined;
    },
    // 保存: 属性付きの cookie 文字列を document.cookie に setter で書く
    async set(key: string, value: string): Promise<void> {
      // 値を URI エンコード
      const encodedKey = encodeURIComponent(key);
      const encodedValue = encodeURIComponent(value);
      // 属性を構築
      const attrString = buildAttributes(defaultAttrs);
      // document.cookie へ書き込み (1 cookie のみ反映、他の cookie は維持される)
      doc.cookie = `${encodedKey}=${encodedValue}${attrString}`;
    },
    // 削除: Max-Age=0 で上書き
    async remove(key: string): Promise<void> {
      // URI エンコード
      const encodedKey = encodeURIComponent(key);
      // 削除属性 (path だけ既定値を引き継ぐ、その他は不要)
      const attrString = buildAttributes({ ...defaultAttrs, maxAge: 0 });
      // 空値 + maxAge=0 で削除
      doc.cookie = `${encodedKey}=${attrString}`;
    },
    // 存在判定
    async has(key: string): Promise<boolean> {
      // パースして存在チェック
      return parseCookies(doc.cookie).has(key);
    },
    // キー一覧
    async keys(): Promise<readonly string[]> {
      // パースしたマップのキーを配列化
      return Array.from(parseCookies(doc.cookie).keys());
    },
    // 全削除
    async clear(): Promise<void> {
      // キー一覧を取得して 1 件ずつ削除
      const keys = Array.from(parseCookies(doc.cookie).keys());
      // 各キーを Max-Age=0 で消す
      for (const k of keys) {
        // URI エンコード
        const encodedKey = encodeURIComponent(k);
        // 削除属性
        const attrString = buildAttributes({ ...defaultAttrs, maxAge: 0 });
        // 書き込み
        doc.cookie = `${encodedKey}=${attrString}`;
      }
    },
  };
}
