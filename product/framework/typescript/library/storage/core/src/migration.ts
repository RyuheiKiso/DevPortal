// 公開型を取り込み
import type { KvStore, Migration } from "./types.js";
// MigrationError ファクトリを取り込み
import { createMigrationError } from "./errors.js";

// withMigration の生成オプション
export interface WithMigrationOptions<T> {
  // マイグレーション宣言の配列 ((fromVersion, toVersion) が連続している必要がある)
  migrations: readonly Migration[];
  // バージョン保存用のキー名 (省略時は "__version")
  versionKey?: string;
  // マイグレーション失敗時の戦略
  // - "throw" (既定): MigrationError を上位へ throw
  // - "reset": 該当キーを削除し、fallback を保存して fallback を返す
  // - "fallback": fallback 値を返す (store は不整合のまま、次回 get で再試行)
  onError?: "throw" | "reset" | "fallback";
  // reset / fallback で使う既定値
  fallback?: T;
}

// マイグレーション宣言を検証し、最新バージョンを算出する
// 連続性に違反するときは MigrationError を throw する
function resolveLatestVersion(migrations: readonly Migration[]): number {
  // 空配列のときはバージョン 0 を最新とみなす (マイグレーション無し)
  if (migrations.length === 0) return 0;
  // 先頭の fromVersion を起点に連続性を確認する
  let expected = migrations[0]!.fromVersion;
  // 各ステップが (expected → expected+1) になっているか確認
  for (const m of migrations) {
    // fromVersion が想定値と一致するか
    if (m.fromVersion !== expected) {
      // 連続性違反として MigrationError を投げる
      throw createMigrationError({
        fromVersion: m.fromVersion,
        toVersion: m.toVersion,
        message: `Migration chain is not contiguous: expected fromVersion ${expected}, got ${m.fromVersion}`,
      });
    }
    // toVersion が fromVersion + 1 になっているか
    if (m.toVersion !== m.fromVersion + 1) {
      // 連続性違反として MigrationError を投げる
      throw createMigrationError({
        fromVersion: m.fromVersion,
        toVersion: m.toVersion,
        message: `Migration step must increment version by 1: ${m.fromVersion} → ${m.toVersion}`,
      });
    }
    // 次の期待値を更新
    expected = m.toVersion;
  }
  // 最後の toVersion が最新バージョン
  return expected;
}

// バージョン管理付きの KV ストアミドルウェアを生成する
// 内部 KvStore は unknown 型 (旧バージョンの値が含まれうるため) を扱う
// 外側 KvStore は最新スキーマの型 T を公開する
export function withMigration<T>(
  // 生成オプション
  options: WithMigrationOptions<T>,
): (inner: KvStore<unknown>) => KvStore<T> {
  // マイグレーション宣言の不変参照
  const migrations = options.migrations;
  // バージョンキー名 (既定 "__version")
  const versionKey = options.versionKey ?? "__version";
  // 失敗戦略 (既定 "throw")
  const onError = options.onError ?? "throw";
  // 最新バージョンを算出 (連続性違反は ここで throw)
  const latestVersion = resolveLatestVersion(migrations);
  // fallback 値 (型は外側 T、ただし undefined の可能性あり)
  const fallback = options.fallback;
  // カリー化された wrapper を返す
  return (inner: KvStore<unknown>): KvStore<T> => {
    // 内部の生バージョン値を number に正規化する
    // 不正値 (object / 文字列 / 範囲外) はすべて 0 とみなして全マイグレーション適用
    const normalizeVersion = (raw: unknown): number => {
      // number でかつ有限値のみ採用
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      // それ以外は version 0 (= 最も古い扱い、全 migration を適用)
      return 0;
    };
    // 完成した KvStore を組み立てる
    const wrapped: KvStore<T> = {
      // 取得: 必要ならマイグレーションを適用してから返す
      async get(key: string): Promise<T | undefined> {
        // 値を取得 (旧バージョンの可能性あり)
        const value = await inner.get(key);
        // 未保存ならそのまま undefined (マイグレーション不要)
        if (value === undefined) return undefined;
        // 現在のバージョンを取得 (未保存なら 0 扱い)
        const rawVersion = await inner.get(versionKey);
        const currentVersion = normalizeVersion(rawVersion);
        // 最新と一致するならそのまま T として返す
        if (currentVersion === latestVersion) return value as T;
        // マイグレーション実行を試みる
        try {
          // 現在値を変換途中の値として保持
          let migrated: unknown = value;
          // currentVersion から latestVersion まで順次変換
          for (const m of migrations) {
            // 既に到達済みのステップは飛ばす
            if (m.fromVersion < currentVersion) continue;
            // migrate を呼ぶ (同期/非同期両対応)
            migrated = await Promise.resolve(m.migrate(migrated));
          }
          // 変換結果を inner に書き戻し、バージョンも更新
          await inner.set(key, migrated);
          await inner.set(versionKey, latestVersion);
          // 変換済み値を返す
          return migrated as T;
        } catch (cause) {
          // 戦略に応じて挙動を分岐する
          if (onError === "throw") {
            // throw 戦略: MigrationError を投げる
            throw createMigrationError({
              key,
              cause,
              message: "Migration failed during get()",
            });
          }
          // reset 戦略: 該当キーを削除し fallback を書く
          if (onError === "reset") {
            // 既存値を削除
            await inner.remove(key);
            // fallback が定義されていれば保存
            if (fallback !== undefined) {
              // fallback を inner に書き、バージョンを最新に揃える
              await inner.set(key, fallback);
              await inner.set(versionKey, latestVersion);
            }
            // fallback を返す (undefined の可能性あり)
            return fallback;
          }
          // fallback 戦略: 値だけ返し、store は触らない
          return fallback;
        }
      },
      // 保存: 値と共にバージョンを最新へ更新する
      async set(key: string, value: T): Promise<void> {
        // 値をそのまま inner に保存
        await inner.set(key, value);
        // バージョンキーも最新へ
        await inner.set(versionKey, latestVersion);
      },
      // 削除: inner にそのまま委譲
      async remove(key: string): Promise<void> {
        // 値を削除 (バージョンキーは残しておく; 他キーで共有のため)
        await inner.remove(key);
      },
    };
    // inner.has があれば素通しで提供
    if (inner.has !== undefined) {
      const innerHas = inner.has;
      wrapped.has = async (key: string): Promise<boolean> => innerHas(key);
    }
    // inner.keys があれば versionKey を除いて返す
    if (inner.keys !== undefined) {
      const innerKeys = inner.keys;
      wrapped.keys = async (): Promise<readonly string[]> => {
        // 全キーを取得
        const all = await innerKeys();
        // versionKey を除外して返す (外側はバージョン情報を見せない)
        return all.filter((k) => k !== versionKey);
      };
    }
    // inner.clear があれば素通しで提供
    if (inner.clear !== undefined) {
      const innerClear = inner.clear;
      wrapped.clear = async (): Promise<void> => innerClear();
    }
    // 完成した KvStore を返す
    return wrapped;
  };
}
