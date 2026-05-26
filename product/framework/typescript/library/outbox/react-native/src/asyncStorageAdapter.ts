// core から KvStoreLike を import (型のみ。実装依存なし)
import type { KvStoreLike } from "@k1s0-ts-outbox/core";

// AsyncStorage の最小 I/F (@react-native-async-storage/async-storage を duck-typed で受ける)
export interface AsyncStorageLike {
  // 文字列値を取得 (未保存なら null)
  getItem(key: string): Promise<string | null>;
  // 文字列値を保存
  setItem(key: string, value: string): Promise<void>;
  // 値を削除
  removeItem(key: string): Promise<void>;
}

// 任意のロガー I/F (deserialize 失敗時の warn ログに使う)
export interface AsyncStorageAdapterLogger {
  // 警告ログ (破損データ検出時に呼ばれる)
  warn(message: string, context?: unknown): void;
}

// アダプタ生成オプション
export interface CreateAsyncStorageKvStoreOptions {
  // 全 key の prefix (既定は空文字 = prefix を付けない)
  // createOutboxStorage 側にも namespace があるため、二重 prefix を避ける目的で既定は空にしている
  // AsyncStorage を他用途と共有していて衝突を防ぎたい場合のみ指定する
  namespace?: string;
  // 値の直列化器 (既定 JSON.stringify)
  serialize?: (value: unknown) => string;
  // 値の復元器 (既定 JSON.parse)
  deserialize?: (raw: string) => unknown;
  // deserialize 失敗時の挙動 (既定 "skip"。"throw" にすれば従来通り例外を伝播)
  // "skip": 破損エントリを undefined 扱いにして処理を続行 (1 件の破損で全体停止しないため)
  // "throw": deserialize の例外をそのまま呼び出し元へ伝播 (厳密モード)
  onDeserializeError?: "skip" | "throw";
  // 破損データ検出時のログ出力先 (任意)
  logger?: AsyncStorageAdapterLogger;
}

// AsyncStorage 風 I/F を KvStoreLike に適合させる
// - namespace を prefix として全 key に付与 (空文字なら prefix なし)
// - 値は JSON 直列化される
// - core の `createOutboxStorage` にそのまま渡せる
export function createAsyncStorageKvStore(
  // AsyncStorage 互換実装 (peerDependency)
  storage: AsyncStorageLike,
  // オプション
  options?: CreateAsyncStorageKvStoreOptions,
): KvStoreLike {
  // namespace の既定は空文字 (createOutboxStorage 側に namespace を寄せる)
  const namespace = options?.namespace ?? "";
  // 直列化器
  const serialize = options?.serialize ?? JSON.stringify;
  // 復元器
  const deserialize = options?.deserialize ?? JSON.parse;
  // deserialize 失敗時の挙動 (既定 skip)
  const onDeserializeError = options?.onDeserializeError ?? "skip";
  // 破損データ検出時のログ
  const logger = options?.logger;
  // prefix ヘルパ (namespace が空文字なら prefix を付けずに素のキーを返す)
  const prefixed = (key: string): string => (namespace === "" ? key : `${namespace}:${key}`);
  // KvStoreLike を返す
  return {
    // 値取得 (破損データは onDeserializeError="skip" なら undefined を返す)
    async get(key: string): Promise<unknown> {
      // AsyncStorage から取得
      const raw = await storage.getItem(prefixed(key));
      // 未保存なら undefined
      if (raw === null) {
        return undefined;
      }
      // 文字列を deserialize (失敗時は skip / throw を選択)
      try {
        return deserialize(raw);
      } catch (err) {
        // throw モードでは従来通り例外を伝播
        if (onDeserializeError === "throw") {
          throw err;
        }
        // skip モードでは warn ログを出して undefined を返す
        // (1 件の破損で manager.list / scheduler tick 全体が停止しないようにする)
        logger?.warn("outbox(async-storage): deserialize failed, treating as missing", {
          key: prefixed(key),
          err,
        });
        return undefined;
      }
    },
    // 値保存
    async set(key: string, value: unknown): Promise<void> {
      // 直列化して AsyncStorage へ
      await storage.setItem(prefixed(key), serialize(value));
    },
    // 値削除
    async remove(key: string): Promise<void> {
      // AsyncStorage から削除
      await storage.removeItem(prefixed(key));
    },
  };
}
