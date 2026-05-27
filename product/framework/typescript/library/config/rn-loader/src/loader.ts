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

// FILE_NOT_FOUND メッセージで「探索した候補パスを列挙」する整形ヘルパ
// glob 風プレースホルダ (`dev.{json|yaml|yml}`) は実在パスと誤解されやすいため、
// 「Tried: A / B / C」形式に展開する
function formatTriedCandidates(dir: string, baseName: string): string {
  // 各拡張子の絶対パス候補を生成し、" / " で連結
  return ENV_EXTENSIONS.map((ext) => joinPath(dir, `${baseName}${ext}`)).join(" / ");
}

// ensureObject の挙動を制御するオプション
interface EnsureObjectOptions {
  // 「差分なし」を意味する null/undefined を空 {} として許容するか
  // dev は false（必須ファイル）、staging/prod は true（差分なしを許容）
  allowEmpty?: boolean;
}

// 任意の値がオブジェクト (連想配列) かどうかを判定する
// mergeEnvConfig の差分側 (Partial<T>) として安全に扱うためのガード
//
// 仕様:
//   - allowEmpty=true (staging/prod 用): null/undefined → {} に正規化（差分なし扱い）
//   - allowEmpty=false (dev 用): null/undefined を PARSE_ERROR として弾く（必須ファイル）
//   - 配列・プリミティブは常に構造エラーとして PARSE_ERROR
//
// js-yaml は完全空ファイルでは undefined、`null:`/`~` では null を返す。両方を同一視する。
function ensureObject(
  value: unknown,
  filePath: string,
  options: EnsureObjectOptions = {},
): Record<string, unknown> {
  // null / undefined の扱いは allowEmpty で分岐
  if (value === null || value === undefined) {
    // 任意ファイル（staging/prod）は空マージとして {} を返す
    if (options.allowEmpty) {
      return {};
    }
    // 必須ファイル（dev）が空の場合は構造エラー
    throw new ConfigLoaderError(
      `Empty top-level value in required config (file: ${filePath})`,
      "PARSE_ERROR",
    );
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
    // 二段構え:
    //   1. dev を先行探索 → 見つからなければ即 throw（staging/prod の I/O を無駄にしない）
    //   2. dev 確定後、3 ファイル読込を並列化し allSettled で unhandled rejection を防ぐ
    async loadEnvConfigMap(dir: string): Promise<EnvConfigMap<Record<string, unknown>>> {
      // 第 1 段: dev を先行探索（無ければエラー時点で staging/prod の I/O を発生させない）
      const devPath = await findEnvFile(dir, "dev");
      // dev が無ければ FILE_NOT_FOUND（候補パスを Tried 形式で列挙）
      if (devPath === undefined) {
        throw new ConfigLoaderError(
          `Config file not found. Tried: ${formatTriedCandidates(dir, "dev")}`,
          "FILE_NOT_FOUND",
        );
      }
      // 第 2 段: dev/staging/prod の読込を並列化
      // allSettled を使うことで、複数足同時失敗時の unhandled rejection を防ぐ
      const results = await Promise.allSettled([
        // dev は必須・空 NG。ensureObject に allowEmpty=false（デフォルト）を渡す
        loadConfig(devPath).then((v) => ensureObject(v, devPath)),
        // staging は任意・空 OK。先に findEnvFile してから読込
        findEnvFile(dir, "staging").then((path) =>
          // 見つからなければ {}、見つかれば読み込んで allowEmpty=true で正規化
          path === undefined
            ? ({} as Record<string, unknown>)
            : loadConfig(path).then((v) => ensureObject(v, path, { allowEmpty: true })),
        ),
        // prod も任意・空 OK
        findEnvFile(dir, "prod").then((path) =>
          // 見つからなければ {}、見つかれば読み込んで allowEmpty=true で正規化
          path === undefined
            ? ({} as Record<string, unknown>)
            : loadConfig(path).then((v) => ensureObject(v, path, { allowEmpty: true })),
        ),
      ]);
      // どれか一つでも reject していたら、最初に見つかったものから throw
      for (const r of results) {
        // status が rejected の結果を見つけ次第 throw（unhandled rejection は残らない）
        if (r.status === "rejected") {
          throw r.reason;
        }
      }
      // 全成功なので value を取り出して EnvConfigMap 形に組み立てる
      const [devRaw, stagingRaw, prodRaw] = (
        results as PromiseFulfilledResult<Record<string, unknown>>[]
      ).map((r) => r.value);
      // core の EnvConfigMap 形にまとめて返す
      return { dev: devRaw, staging: stagingRaw, prod: prodRaw };
    },
  };
}
