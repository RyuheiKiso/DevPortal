// core から KvStore 型を取り込み
import type { KvStore } from "@k1s0-ts-storage/core";
// ローカル型を取り込み
import type { KeychainModule } from "./types.js";

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
  // perKey モードの実装
  if (mode === "perKey") {
    // 完成した KvStore を返す
    return {
      // 取得
      async get(key: string): Promise<string | undefined> {
        // getGenericPassword は false (=未保存) または { username, password } を返す
        const result = await keychain.getGenericPassword({ service: serviceFor(key) });
        // false なら undefined
        if (result === false) return undefined;
        // 値は password に格納されている (username は key を入れる)
        return result.password;
      },
      // 保存
      async set(key: string, value: string): Promise<void> {
        // setGenericPassword(username, password, options)
        // username にキー名、password に値を入れる
        await keychain.setGenericPassword(key, value, { service: serviceFor(key) });
      },
      // 削除
      async remove(key: string): Promise<void> {
        // resetGenericPassword は失敗しても boolean を返すので await のみ
        await keychain.resetGenericPassword({ service: serviceFor(key) });
      },
    };
  }
  // singleService モードの実装: 1 service に JSON マップを保存
  // JSON マップを読み書きするユーティリティ
  const readMap = async (): Promise<Record<string, string>> => {
    // 単一 service から値を取得
    const result = await keychain.getGenericPassword({ service: singleService });
    // 未保存なら空マップ
    if (result === false) return {};
    // JSON パース (壊れていれば空マップで耐える)
    try {
      // 任意の JSON を Record<string, string> として受ける
      const parsed = JSON.parse(result.password) as Record<string, string>;
      // 結果を返す
      return parsed;
    } catch {
      // 壊れた値は空マップで起動継続
      return {};
    }
  };
  // 書き込みヘルパ (マップ全体を JSON 化して保存)
  const writeMap = async (map: Record<string, string>): Promise<void> => {
    // JSON 化して保存
    await keychain.setGenericPassword("bundle", JSON.stringify(map), { service: singleService });
  };
  // 完成した KvStore を返す
  return {
    // 取得
    async get(key: string): Promise<string | undefined> {
      // マップを読み込み、キーの値を返す
      const map = await readMap();
      // 未保存なら undefined
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
    },
    // 保存
    async set(key: string, value: string): Promise<void> {
      // マップを読込み、キーを上書きして書き戻す
      const map = await readMap();
      map[key] = value;
      await writeMap(map);
    },
    // 削除
    async remove(key: string): Promise<void> {
      // マップを読込み、キーを削って書き戻す
      const map = await readMap();
      delete map[key];
      await writeMap(map);
    },
    // 存在判定
    async has(key: string): Promise<boolean> {
      // マップ参照で判定
      const map = await readMap();
      return Object.prototype.hasOwnProperty.call(map, key);
    },
    // キー一覧
    async keys(): Promise<readonly string[]> {
      // マップのキー
      const map = await readMap();
      return Object.keys(map);
    },
    // 全削除
    async clear(): Promise<void> {
      // service 自体を消すか、空マップで上書きする (前者を採用)
      await keychain.resetGenericPassword({ service: singleService });
    },
  };
}
