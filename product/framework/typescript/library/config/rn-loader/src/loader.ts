// zod の ZodType 型を取り込む (loadAndValidate のスキーマ引数型)
import type { z } from "zod";
// core の検証ヘルパと型を取り込む (rn-loader は I/O 担当、検証は core に委譲)
import { validateConfig } from "@k1s0-ts-config/core";
import type { EnvConfigMap } from "@k1s0-ts-config/core";
// 共通の型を取り込む
import type { FileSystemBackend, Loader } from "./types.js";
// 拡張子からパーサを選ぶユーティリティを取り込む
import { detectParser } from "./detect.js";
// loader 共通のエラークラスを取り込む
import { ConfigLoaderError } from "./errors.js";
// パス結合ユーティリティ (backends 側と同じロジックを共有して混在パスを防ぐ)
import { joinPath } from "./pathUtils.js";

// 環境別ファイルを探す際に試す拡張子の優先順 (JSON > YAML > YML)
const ENV_EXTENSIONS = [".json", ".yaml", ".yml"] as const;

// 任意の値がオブジェクト (連想配列) かどうかを判定する
// mergeEnvConfig の差分側 (Partial<T>) として安全に扱うためのガード
//
// 仕様: 空 YAML 等で `null` / `undefined` がパース結果として返るケースは「差分なし」と
// 解釈して空 {} を返す（js-yaml は完全空ファイルでは undefined、`null:`/`~` では null を返す）。
// 配列・プリミティブは引き続き構造エラーとして PARSE_ERROR に分類する。
function ensureObject(value: unknown, filePath: string): Record<string, unknown> {
  // null / undefined は「差分なし」とみなして空オブジェクトに正規化
  if (value === null || value === undefined) {
    // 空マージとして扱うため {} を返却
    return {};
  }
  // 配列やプリミティブはトップレベルが連想配列でないため構造エラー
  if (typeof value !== "object" || Array.isArray(value)) {
    // 形式違いはパース後の構造エラーとして PARSE_ERROR に分類
    throw new ConfigLoaderError(
      `Expected object at top level (file: ${filePath})`,
      "PARSE_ERROR",
    );
  }
  // オブジェクトとして再キャストして返す
  return value as Record<string, unknown>;
}

// 指定された FileSystemBackend を使う Loader を組み立てる
// バックエンドさえあれば rnfs/expo/将来の OTA など共通の API で使える
export function createLoader(
  // ファイル I/O を行うバックエンド実装
  backend: FileSystemBackend,
): Loader {
  // ファイル 1 枚を読んでパース結果を返す内部関数
  // 拡張子判定 → 読込 → パーサ呼び出しの順
  async function loadConfig(filePath: string): Promise<unknown> {
    // 拡張子からパーサを先に決定する (未知拡張子はここで UNSUPPORTED_EXT が飛ぶ)
    const parse = detectParser(filePath);
    // ファイル読み込みは I/O 例外を包む対象なので try-catch で囲む
    let content: string;
    try {
      // バックエンドに読み込みを委譲
      content = await backend.readFile(filePath);
    } catch (cause) {
      // バックエンドが既に ConfigLoaderError を投げた場合はそのまま透過
      if (cause instanceof ConfigLoaderError) {
        throw cause;
      }
      // それ以外は IO_ERROR でラップ
      throw new ConfigLoaderError(
        `I/O error while reading config file: ${filePath}`,
        "IO_ERROR",
        cause,
      );
    }
    // パース結果を返す (PARSE_ERROR はパーサ側で包まれる)
    return parse(content, filePath);
  }

  // dev/staging/prod の各候補拡張子を順に試して見つかったパスを返す
  async function findEnvFile(dir: string, baseName: string): Promise<string | undefined> {
    // 候補拡張子を順番に試す (先勝ち)
    for (const ext of ENV_EXTENSIONS) {
      // 結合パスを組み立てる
      const candidate = joinPath(dir, `${baseName}${ext}`);
      // バックエンドの存在確認を呼ぶ
      if (await backend.exists(candidate)) {
        // 見つかったらパスを返して終了
        return candidate;
      }
    }
    // どの拡張子も見つからなかった
    return undefined;
  }

  // 公開 API として Loader インターフェイスを満たすオブジェクトを返す
  return {
    // 公開: ファイル → unknown
    loadConfig,

    // 公開: 指定パスにファイルが存在するかを返す
    //   バックエンドのパス解決 (baseDir) も適用される
    async exists(filePath: string): Promise<boolean> {
      // バックエンドの exists をそのまま委譲 (例外も透過)
      return backend.exists(filePath);
    },

    // 公開: ファイル → 検証済み T
    async loadAndValidate<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
      // ファイルを unknown としてロード
      const raw = await loadConfig(filePath);
      // core の validateConfig で T 型に確定させて返す
      return validateConfig(schema, raw);
    },

    // 公開: ディレクトリ → EnvConfigMap (dev/staging/prod)
    //
    // 並列化: 3 ファイルのパス探索と読込はそれぞれ I/O を伴うため Promise.all で並列実行する。
    // RN 環境では FS の I/O レイテンシが高めなので、起動時間に効く。
    async loadEnvConfigMap(dir: string): Promise<EnvConfigMap<Record<string, unknown>>> {
      // dev / staging / prod のパス探索を並列化
      const [devPath, stagingPath, prodPath] = await Promise.all([
        // dev ファイルを探す
        findEnvFile(dir, "dev"),
        // staging ファイルを探す
        findEnvFile(dir, "staging"),
        // prod ファイルを探す
        findEnvFile(dir, "prod"),
      ]);
      // dev が無ければファイル未存在として扱う
      if (devPath === undefined) {
        // 期待するパス候補を伝えるためにメッセージを組み立てる
        throw new ConfigLoaderError(
          `Config file not found: ${joinPath(dir, "dev.{json|yaml|yml}")}`,
          "FILE_NOT_FOUND",
        );
      }
      // 3 ファイル分の読込も並列化（staging/prod が undefined のときは空 {} に即時 resolve）
      const [devRaw, stagingRaw, prodRaw] = await Promise.all([
        // dev は必須。読み込み後 ensureObject で正規化
        loadConfig(devPath).then((v) => ensureObject(v, devPath)),
        // staging は欠けていたら {} 扱い
        stagingPath === undefined
          ? Promise.resolve<Record<string, unknown>>({})
          : loadConfig(stagingPath).then((v) => ensureObject(v, stagingPath)),
        // prod も欠けていたら {} 扱い
        prodPath === undefined
          ? Promise.resolve<Record<string, unknown>>({})
          : loadConfig(prodPath).then((v) => ensureObject(v, prodPath)),
      ]);
      // core の EnvConfigMap 形にまとめて返す
      return { dev: devRaw, staging: stagingRaw, prod: prodRaw };
    },
  };
}
