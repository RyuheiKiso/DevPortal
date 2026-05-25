// 公開型を取り込み
import type {
  ClearScopeOptions,
  KvStore,
  StorageRegistry,
  StorageScope,
} from "./types.js";
// エラーファクトリを取り込み
import { createNotAvailableError } from "./errors.js";

// exceptKeys が指定されているときのみ呼ばれる判定関数ファクトリ
// 配列 → 完全一致、関数 → そのまま
function buildExceptionPredicate(
  exceptKeys: NonNullable<ClearScopeOptions["exceptKeys"]>,
): (key: string) => boolean {
  // 関数指定 → そのまま使う
  if (typeof exceptKeys === "function") return exceptKeys;
  // 配列指定 → Set 化して O(1) 判定
  const set = new Set(exceptKeys);
  // 完成した述語
  return (k: string) => set.has(k);
}

// 1 スコープを exceptKeys を考慮してクリアする内部ヘルパ
async function clearOne(
  // 対象 KvStore
  store: KvStore<unknown>,
  // exceptKeys オプション
  options: ClearScopeOptions | undefined,
  // 失敗時の context に渡すスコープ名 (NotAvailable のメッセージに含める)
  scopeForError: StorageScope,
): Promise<void> {
  // exceptKeys が指定されていない (= 例外なし) なら store.clear で全消去
  if (options?.exceptKeys === undefined) {
    // clear が未提供だと選択的削除も全削除も不可
    if (store.clear === undefined) {
      // 利用不可エラーを投げる (アプリ側で対処)
      throw createNotAvailableError({
        message: `Scope "${scopeForError}" does not support clear()`,
      });
    }
    // 全削除を実行
    await store.clear();
    // 完了
    return;
  }
  // exceptKeys 指定時: keys() が無いと選択的削除ができない
  if (store.keys === undefined) {
    // 利用不可エラーを投げる
    throw createNotAvailableError({
      message: `Scope "${scopeForError}" does not support keys() required for selective clear`,
    });
  }
  // 例外判定述語を構築 (exceptKeys は確定で defined)
  const isException = buildExceptionPredicate(options.exceptKeys);
  // 全キーを列挙
  const all = await store.keys();
  // 例外キーを除外して削除対象を抽出
  const targets: string[] = [];
  // 各キーを判定
  for (const k of all) {
    // 例外なら除外
    if (isException(k)) continue;
    // 削除対象
    targets.push(k);
  }
  // 1 件ずつ remove (Promise.all でなく直列にし、副作用順を維持)
  for (const k of targets) {
    // remove に委譲
    await store.remove(k);
  }
}

// 4 スコープを束ねる StorageRegistry を生成する
// 全スコープ必須 (ephemeral も含めて) のため、アプリ側で createMemoryStore() を使って明示注入する
export function createStorageRegistry(parts: {
  // 機密 (認証トークン・PII)
  secure: KvStore<unknown>;
  // 永続 (設定・テーマ)
  durable: KvStore<unknown>;
  // セッション (タブ単位)
  session: KvStore<unknown>;
  // 揮発 (メモリのみ)
  ephemeral: KvStore<unknown>;
}): StorageRegistry {
  // 内部マップ (scope → KvStore)
  const map: Record<StorageScope, KvStore<unknown>> = {
    secure: parts.secure,
    durable: parts.durable,
    session: parts.session,
    ephemeral: parts.ephemeral,
  };
  // StorageRegistry 契約を返す
  const registry: StorageRegistry = {
    // 各スコープを read-only として公開
    secure: parts.secure,
    durable: parts.durable,
    session: parts.session,
    ephemeral: parts.ephemeral,
    // scope 名から型キャストして取り出す
    get<T = unknown>(scope: StorageScope): KvStore<T> {
      // map を引いて T として返す (実体は KvStore<unknown> だが、アプリで型を確定させる前提)
      return map[scope] as KvStore<T>;
    },
    // 指定スコープを選択的にクリア
    async clearScope(scope, options): Promise<void> {
      // 該当 store を取得
      const store = map[scope];
      // 内部ヘルパに委譲
      await clearOne(store, options, scope);
    },
    // 全スコープをクリア
    async clearAll(options): Promise<void> {
      // 各スコープに対して clearScope を順次実行
      for (const scope of ["secure", "durable", "session", "ephemeral"] as const) {
        // clearScope 同等の処理
        await clearOne(map[scope], options, scope);
      }
    },
  };
  // 完成した StorageRegistry を返す
  return registry;
}
