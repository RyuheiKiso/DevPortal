// AsyncStorage と互換性のある最小契約
// getItem / setItem / removeItem を持ち、同期/非同期どちらの戻りも許容する
// @react-native-async-storage/async-storage の API 形状に一致 (後方互換のため auth と同じ名前)
export interface NativeKeyValueStorage {
  // 指定キーの文字列値を取得する (未保存は null)
  getItem(key: string): string | null | Promise<string | null>;
  // 指定キーへ文字列値を保存する
  setItem(key: string, value: string): void | Promise<void>;
  // 指定キーの値を削除する
  removeItem(key: string): void | Promise<void>;
  // 任意: getAllKeys (AsyncStorage が提供する)
  getAllKeys?(): string[] | Promise<string[]>;
  // 任意: clear (AsyncStorage が提供する)
  clear?(): void | Promise<void>;
}

// expo-secure-store の API 形状を表す
// getItemAsync / setItemAsync / deleteItemAsync を持つ
export interface SecureNativeStorage {
  // 指定キーの文字列値を取得する (未保存は null)
  getItemAsync(key: string): Promise<string | null>;
  // 指定キーへ文字列値を保存する
  setItemAsync(key: string, value: string): Promise<void>;
  // 指定キーの値を削除する
  deleteItemAsync(key: string): Promise<void>;
}

// react-native-keychain の API 形状を表す (最小)
// 1 つの service に 1 つの username/password ペアを保存する設計のため、
// perKey モードでは service = "{prefix}/{key}" で扱う
export interface KeychainModule {
  // generic password を保存する
  setGenericPassword(
    username: string,
    password: string,
    options?: { service?: string },
  ): Promise<boolean | { service?: string }>;
  // generic password を取得する (取得失敗時は false を返す)
  getGenericPassword(options?: { service?: string }): Promise<
    false | { username: string; password: string; service?: string }
  >;
  // generic password を削除する
  resetGenericPassword(options?: { service?: string }): Promise<boolean>;
  // 全ての internet credentials の service 一覧を返す (任意実装)
  getAllGenericPasswordServices?(): Promise<string[]>;
}

// react-native-mmkv の API 形状 (同期 KV)
export interface MmkvInstance {
  // 文字列を取得する (未保存は undefined)
  getString(key: string): string | undefined;
  // 文字列を保存する
  set(key: string, value: string): void;
  // 値を削除する
  delete(key: string): void;
  // 保存済みキーの一覧を返す
  getAllKeys(): string[];
  // 全削除
  clearAll(): void;
  // 存在判定 (任意)
  contains?(key: string): boolean;
}
