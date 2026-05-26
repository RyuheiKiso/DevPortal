// 公開型を取り込み
import type { KvStore, Migration } from "./types.js";
// MigrationError ファクトリを取り込み
import { createMigrationError } from "./errors.js";

// withMigration の生成オプション
export interface WithMigrationOptions<T> {
  // マイグレーション宣言の配列 ((fromVersion, toVersion) が連続している必要がある)
  migrations: readonly Migration[];
  // バージョン保存用のキー名 (省略時は "__version")
  // 内部実装は v1.1 以降 envelope (値とバージョンを 1 レコードに同梱) を採用しているため
  // versionKey は「旧フォーマット (raw value + 別キーで version) の読み込み」と
  // 「外部ツールに最新スキーマを伝えるベストエフォート書込み」に用いる
  versionKey?: string;
  // マイグレーション失敗時の戦略
  // - "throw" (既定): MigrationError を上位へ throw
  // - "reset": 該当キーを削除し、fallback を保存して fallback を返す
  // - "fallback": fallback 値を返す (store は不整合のまま、次回 get で再試行)
  onError?: "throw" | "reset" | "fallback";
  // reset / fallback で使う既定値
  fallback?: T;
}

// envelope の判別子フィールド名 (衝突回避のために長く unique な名前にする)
const ENVELOPE_MARKER = "__k1s0_migration_envelope_v1__";

// envelope の構造定義
// 値とバージョンを 1 つの inner.set で原子的に書き込むためのラッパ
interface MigrationEnvelope {
  // 判別子 (この名前のフィールドが number ならば envelope と認定する)
  [ENVELOPE_MARKER]: number;
  // 実際の値
  value: unknown;
}

// 任意値が envelope 形であるかを判定する
// envelope は `inner.set` を 1 回で完結させるため、書込み途中のクラッシュでも
// 「新バージョン × 旧値」「旧バージョン × 新値」の中間状態を残さない
function isEnvelope(raw: unknown): raw is MigrationEnvelope {
  // オブジェクト以外は envelope ではない
  if (typeof raw !== "object" || raw === null) return false;
  // マーカーフィールドを取得 (型安全に Record として参照)
  const marker = (raw as Record<string, unknown>)[ENVELOPE_MARKER];
  // 判別子が有限な数値 (= バージョン番号) であれば envelope と認定
  return typeof marker === "number" && Number.isFinite(marker);
}

// 値とバージョンから envelope を組み立てる
function wrapEnvelope(value: unknown, version: number): MigrationEnvelope {
  // 判別子 + 実値の 2 フィールドのみで構成する
  return { [ENVELOPE_MARKER]: version, value };
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
//
// アトミック性:
//   set() および get() 内のマイグレーション書き戻しは「値とバージョンを 1 つの envelope」
//   として inner.set 1 回で書き込むため、途中クラッシュでも中間不整合が残らない。
//   `versionKey` への書込みは旧フォーマット互換のためのベストエフォートであり、
//   失敗しても envelope に格納されたバージョンが正となる。
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
    // versionKey への書込みはベストエフォート (envelope が正のため、失敗時は黙殺)
    // 旧フォーマット読み出しツールへのヒントとしてのみ役立つ
    const writeVersionKeyBestEffort = async (): Promise<void> => {
      // try/catch で吸収する (envelope が真実のため versionKey 失敗は致命的ではない)
      try {
        await inner.set(versionKey, latestVersion);
      } catch {
        // 失敗は無視 (envelope に格納されたバージョンが正)
      }
    };
    // 完成した KvStore を組み立てる
    const wrapped: KvStore<T> = {
      // 取得: 必要ならマイグレーションを適用してから返す
      async get(key: string): Promise<T | undefined> {
        // 値を取得 (envelope か旧フォーマットかは下で判定する)
        const raw = await inner.get(key);
        // 未保存ならそのまま undefined (マイグレーション不要)
        if (raw === undefined) return undefined;
        // 現在のバージョンと値を決定する
        // envelope であれば envelope.version を、そうでなければ versionKey を参照する
        let currentVersion: number;
        let currentValue: unknown;
        if (isEnvelope(raw)) {
          // envelope: 同梱されたバージョンと値を取り出す
          currentVersion = raw[ENVELOPE_MARKER];
          currentValue = raw.value;
        } else {
          // 旧フォーマット: 外部の versionKey を参照する (未保存なら 0 扱い)
          const rawVersion = await inner.get(versionKey);
          currentVersion = normalizeVersion(rawVersion);
          currentValue = raw;
        }
        // 最新と一致するならそのまま T として返す (envelope のラップを剥がした値)
        if (currentVersion === latestVersion) return currentValue as T;
        // マイグレーション実行を試みる
        try {
          // 現在値を変換途中の値として保持
          let migrated: unknown = currentValue;
          // currentVersion から latestVersion まで順次変換
          for (const m of migrations) {
            // 既に到達済みのステップは飛ばす
            if (m.fromVersion < currentVersion) continue;
            // migrate を呼ぶ (同期/非同期両対応)
            migrated = await Promise.resolve(m.migrate(migrated));
          }
          // 変換結果を envelope として 1 回の書込みで保存 (アトミック)
          await inner.set(key, wrapEnvelope(migrated, latestVersion));
          // 旧読み出し互換のため versionKey もベストエフォートで更新
          await writeVersionKeyBestEffort();
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
            // fallback が定義されていれば envelope で保存
            if (fallback !== undefined) {
              // fallback を envelope に包んで inner に書く (アトミック)
              await inner.set(key, wrapEnvelope(fallback, latestVersion));
              // versionKey もベストエフォートで更新
              await writeVersionKeyBestEffort();
            }
            // fallback を返す (undefined の可能性あり)
            return fallback;
          }
          // fallback 戦略: 値だけ返し、store は触らない
          return fallback;
        }
      },
      // 保存: 値とバージョンを envelope として 1 回で書く
      async set(key: string, value: T): Promise<void> {
        // 値とバージョンを envelope に包み、inner.set 1 回で原子的に書込み
        // (旧実装の "値書込み → versionKey 書込み" 2 段ではクラッシュで版ズレが発生していた)
        await inner.set(key, wrapEnvelope(value, latestVersion));
        // 旧互換のため versionKey もベストエフォートで更新
        await writeVersionKeyBestEffort();
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
