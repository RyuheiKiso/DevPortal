// React の hook を取り込み
import { useCallback, useContext, useEffect, useState } from "react";
// core から型を取り込み
import type { KvStore, StorageRegistry, StorageScope, TypedSlot } from "@k1s0-ts-storage/core";
// Context を取り込み
import { StorageContext } from "./context.js";

// Provider 外で hook が呼ばれた場合に throw する明示エラー
function ensureRegistry(registry: StorageRegistry | null): StorageRegistry {
  // null のとき (Provider 不在) は早期エラー
  if (registry === null) {
    throw new Error("useStorageRegistry must be called inside <StorageProvider>");
  }
  // 取得済みの StorageRegistry を返す
  return registry;
}

// StorageRegistry を取得する hook
export function useStorageRegistry(): StorageRegistry {
  // Context から取得
  const registry = useContext(StorageContext);
  // null チェック付きで返す
  return ensureRegistry(registry);
}

// 指定スコープの KvStore を取得する hook
export function useStorageScope<T = unknown>(scope: StorageScope): KvStore<T> {
  // Registry を取得
  const registry = useStorageRegistry();
  // scope から KvStore を引く (T は呼び出し側でキャスト前提)
  return registry.get<T>(scope);
}

// useStorageValue / useTypedSlot の戻り値型
export interface UseStorageStateResult<T> {
  // 現在値 (未保存または未読込なら undefined)
  value: T | undefined;
  // 値を更新する非同期関数
  setValue: (next: T) => Promise<void>;
  // 値を削除する非同期関数
  clear: () => Promise<void>;
  // 初回読込中フラグ
  loading: boolean;
  // 読込/書込エラー
  error: unknown;
}

// useStorageValue のオプション
export interface UseStorageValueOptions<T> {
  // 未保存時の既定値
  defaultValue?: T;
}

// 指定スコープ + キーの値を React state として保持する hook
// (react-native では cross-tab 同期は存在しないが、KvStore.subscribe があれば反映する)
export function useStorageValue<T>(
  // ストレージスコープ
  scope: StorageScope,
  // キー名
  key: string,
  // オプション
  options?: UseStorageValueOptions<T>,
): UseStorageStateResult<T> {
  // 対象 KvStore を取得
  const store = useStorageScope<T>(scope);
  // 既定値
  const defaultValue = options?.defaultValue;
  // 現在値の state (初期値は defaultValue)
  const [value, setValueState] = useState<T | undefined>(defaultValue);
  // 初回読込中フラグ
  const [loading, setLoading] = useState<boolean>(true);
  // エラー保持
  const [error, setError] = useState<unknown>(undefined);
  // 初回および store/key 変更時に値を読み込む
  useEffect(() => {
    // 競合キャンセル用フラグ
    let cancelled = false;
    // 読込開始
    setLoading(true);
    // 値を取得
    store.get(key).then(
      (v) => {
        // unmount 後の setState を防ぐ
        if (cancelled) return;
        // 未保存なら defaultValue を採用
        setValueState(v ?? defaultValue);
        // 読込完了
        setLoading(false);
      },
      (e) => {
        // unmount 後の setState を防ぐ
        if (cancelled) return;
        // エラー保持
        setError(e);
        // 読込完了
        setLoading(false);
      },
    );
    // unmount で cancelled を立てる
    return () => {
      cancelled = true;
    };
  }, [store, key, defaultValue]);
  // KvStore が subscribe をサポートする場合のみ購読
  useEffect(() => {
    // subscribe が無いバックエンドは noop
    if (store.subscribe === undefined) return;
    // 該当キーの変更のみ state へ反映
    const unsubscribe = store.subscribe((changedKey, next) => {
      // キーが一致しない通知は無視
      if (changedKey !== key) return;
      // 未保存通知は defaultValue へ
      setValueState(next ?? defaultValue);
    });
    // unmount で購読解除
    return unsubscribe;
  }, [store, key, defaultValue]);
  // 値を更新する関数 (state も即時更新する)
  const setValue = useCallback(
    async (next: T): Promise<void> => {
      // store に反映
      await store.set(key, next);
      // state も即時更新 (subscribe が無い backend のため)
      setValueState(next);
    },
    [store, key],
  );
  // 値を削除する関数
  const clear = useCallback(async (): Promise<void> => {
    // store から削除
    await store.remove(key);
    // state を defaultValue に戻す
    setValueState(defaultValue);
  }, [store, key, defaultValue]);
  // 結果を返す
  return { value, setValue, clear, loading, error };
}

// TypedSlot を React state として保持する hook
export function useTypedSlot<T>(slot: TypedSlot<T>): UseStorageStateResult<T> {
  // 現在値の state
  const [value, setValueState] = useState<T | undefined>(undefined);
  // 初回読込中フラグ
  const [loading, setLoading] = useState<boolean>(true);
  // エラー保持
  const [error, setError] = useState<unknown>(undefined);
  // 初回および slot 変更時に読み込む
  useEffect(() => {
    // 競合キャンセル用フラグ
    let cancelled = false;
    // 読込開始
    setLoading(true);
    // 値を取得
    slot.get().then(
      (v) => {
        // unmount 後の setState を防ぐ
        if (cancelled) return;
        // 値を反映
        setValueState(v);
        // 読込完了
        setLoading(false);
      },
      (e) => {
        // unmount 後の setState を防ぐ
        if (cancelled) return;
        // エラー保持
        setError(e);
        // 読込完了
        setLoading(false);
      },
    );
    // unmount で cancelled を立てる
    return () => {
      cancelled = true;
    };
  }, [slot]);
  // slot.subscribe があれば購読
  useEffect(() => {
    // subscribe が無ければ noop
    if (slot.subscribe === undefined) return;
    // 値変更を直接 state に反映
    const unsubscribe = slot.subscribe((next) => {
      // 通知を反映
      setValueState(next);
    });
    // 解除関数
    return unsubscribe;
  }, [slot]);
  // 値を更新する関数
  const setValue = useCallback(
    async (next: T): Promise<void> => {
      // slot に保存
      await slot.set(next);
      // state も即時更新
      setValueState(next);
    },
    [slot],
  );
  // 値を削除する関数
  const clear = useCallback(async (): Promise<void> => {
    // slot を空に
    await slot.clear();
    // state を undefined に
    setValueState(undefined);
  }, [slot]);
  // 結果を返す
  return { value, setValue, clear, loading, error };
}
