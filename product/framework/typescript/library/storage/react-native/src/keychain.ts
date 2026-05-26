// core から KvStore 型を取り込み
import type { KvStore } from "@k1s0-ts-storage/core";
// ローカル型を取り込み
import type { KeychainModule } from "./types.js";

// JSON.parse 結果が Record<string, string> であることを実行時検証する
// 改ざんされた Keychain データが任意型として後段に流入することを防ぐ
function isStringRecord(value: unknown): value is Record<string, string> {
  // null / 非オブジェクト / 配列を拒否する
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  // 各値が string であることを確認する
  for (const v of Object.values(value as Record<string, unknown>)) {
    // 非 string が混じっていれば不正
    if (typeof v !== "string") return false;
  }
  // すべて string なら true
  return true;
}

// FIFO 直列化ミューテックスを生成する
// `singleService` モードでの read-modify-write 競合 (並行 set/remove で一方の書込みが
// もう一方の readMap 結果を上書きする) を構造的に防ぐためのローカルヘルパ
// perKey モードでも同じ helper を被せて意図しない API 呼び出しの並行展開を抑える
function createMutex(): <R>(op: () => Promise<R>) => Promise<R> {
  // 直列実行の連鎖を表す Promise (初期値は即解決)
  let chain: Promise<unknown> = Promise.resolve();
  // op を chain の末尾に繋ぎ、結果 Promise を返す
  return <R>(op: () => Promise<R>): Promise<R> => {
    // 前段の成否に関わらず自分の op を起動する (catch 経路も op に倒す)
    const next = chain.then(op, op);
    // chain は op の例外を吸収して後続を続行させる (失敗が後続の起動条件を壊さないように)
    chain = next.catch(() => undefined);
    // 呼び出し側へは next (op の戻り値そのまま) を返す
    return next;
  };
}

// createKeychainBackend のオプション
export interface CreateKeychainBackendOptions {
  // キーから service 名を組み立てる際の prefix (perKey モードで使う)
  servicePrefix?: string;
  // 保存方式
  // - "perKey" (既定): key 毎に独立した service を割り当てる (key = service)
  // - "singleService": 単一 service に JSON マップで保存 (Android Keystore の制約緩和向け)
  mode?: "perKey" | "singleService";
  // singleService モードで使う service 名
  singleService?: string;
}

// react-native-keychain を非同期 KvStore<string> に正規化する
// perKey: key 1 つにつき 1 service。Keychain の制約に素直に乗る
// singleService: 1 service に JSON マップを保存。get/set のたびに JSON 全体を読み書きするため、
//                小規模データ向け。Android Keystore の service 数上限に当たるケースで有効
//
// 並行制御:
//   バックエンドインスタンスごとに 1 つの ミューテックスで全 API 呼出を直列化する。
//   singleService モードの「readMap → 編集 → writeMap」の RMW 競合を排除するのが主目的。
//   perKey モードでも同じ直列化を被せて API の振る舞いを統一する。
//   クロスプロセス (別 RN インスタンス) のレースは keychain ライブラリ自体の責務として扱う。
export function createKeychainBackend(
  keychain: KeychainModule,
  options?: CreateKeychainBackendOptions,
): KvStore<string> {
  // モード (既定 perKey)
  const mode = options?.mode ?? "perKey";
  // service prefix (perKey モード時に使う)
  const servicePrefix = options?.servicePrefix ?? "k1s0-storage";
  // singleService 名
  const singleService = options?.singleService ?? `${servicePrefix}-bundle`;
  // perKey モード: key を service 名にマッピングする
  const serviceFor = (key: string): string => `${servicePrefix}/${key}`;
  // インスタンス単位の直列化ミューテックス (perKey/singleService 両モードで共用)
  const mutex = createMutex();
  // perKey モードの実装
  if (mode === "perKey") {
    // 完成した KvStore を返す
    return {
      // 取得 (mutex で直列化)
      async get(key: string): Promise<string | undefined> {
        return mutex(async () => {
          // getGenericPassword は false (=未保存) または { username, password } を返す
          const result = await keychain.getGenericPassword({ service: serviceFor(key) });
          // false なら undefined
          if (result === false) return undefined;
          // 値は password に格納されている (username は key を入れる)
          return result.password;
        });
      },
      // 保存 (mutex で直列化)
      async set(key: string, value: string): Promise<void> {
        return mutex(async () => {
          // setGenericPassword(username, password, options)
          // username にキー名、password に値を入れる
          await keychain.setGenericPassword(key, value, { service: serviceFor(key) });
        });
      },
      // 削除 (mutex で直列化)
      async remove(key: string): Promise<void> {
        return mutex(async () => {
          // resetGenericPassword は失敗しても boolean を返すので await のみ
          await keychain.resetGenericPassword({ service: serviceFor(key) });
        });
      },
    };
  }
  // singleService モードの実装: 1 service に JSON マップを保存
  // JSON マップを読み書きするユーティリティ
  // (これらは mutex の外で定義し、各 API メソッド内で mutex 越しに呼び出す)
  const readMap = async (): Promise<Record<string, string>> => {
    // 単一 service から値を取得
    const result = await keychain.getGenericPassword({ service: singleService });
    // 未保存なら空マップ
    if (result === false) return {};
    // JSON パース (壊れていれば空マップで耐える)
    let parsed: unknown;
    try {
      // パースを試みる
      parsed = JSON.parse(result.password);
    } catch {
      // 壊れた値は空マップで起動継続
      return {};
    }
    // 実行時検証で Record<string, string> でないものは silently 空マップにする
    // (改ざんされた任意型データが上位コードに流入しないようにする)
    if (!isStringRecord(parsed)) return {};
    // 検証済みのマップを返す
    return parsed;
  };
  // 書き込みヘルパ (マップ全体を JSON 化して保存)
  const writeMap = async (map: Record<string, string>): Promise<void> => {
    // JSON 化して保存
    await keychain.setGenericPassword("bundle", JSON.stringify(map), { service: singleService });
  };
  // 完成した KvStore を返す (全 API は mutex 越しに直列化される)
  return {
    // 取得 (mutex 越しに readMap)
    async get(key: string): Promise<string | undefined> {
      return mutex(async () => {
        // マップを読み込み、キーの値を返す
        const map = await readMap();
        // 未保存なら undefined
        return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
      });
    },
    // 保存 (RMW を mutex で直列化することで「並行 set で一方の書込みが消える」事故を防ぐ)
    async set(key: string, value: string): Promise<void> {
      return mutex(async () => {
        // マップを読込み、キーを上書きして書き戻す
        const map = await readMap();
        map[key] = value;
        await writeMap(map);
      });
    },
    // 削除 (RMW を mutex で直列化)
    async remove(key: string): Promise<void> {
      return mutex(async () => {
        // マップを読込み、キーを削って書き戻す
        const map = await readMap();
        delete map[key];
        await writeMap(map);
      });
    },
    // 存在判定 (mutex 越しに readMap)
    async has(key: string): Promise<boolean> {
      return mutex(async () => {
        // マップ参照で判定
        const map = await readMap();
        return Object.prototype.hasOwnProperty.call(map, key);
      });
    },
    // キー一覧 (mutex 越しに readMap)
    async keys(): Promise<readonly string[]> {
      return mutex(async () => {
        // マップのキー
        const map = await readMap();
        return Object.keys(map);
      });
    },
    // 全削除 (mutex で直列化)
    async clear(): Promise<void> {
      return mutex(async () => {
        // service 自体を消すか、空マップで上書きする (前者を採用)
        await keychain.resetGenericPassword({ service: singleService });
      });
    },
  };
}
