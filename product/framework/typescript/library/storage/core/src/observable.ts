// 公開型を取り込み
import type { KvStore } from "./types.js";

// withObservable が返す KvStore の拡張 I/F
// subscribe は必ず提供される (Required)
// emit は外部 (例: cross-tab event リスナー) から通知を注入するための公開エントリ
export interface KvStoreObservable<T> extends KvStore<T> {
  // 変更通知を購読する (subscribe を必須化)
  subscribe(listener: (key: string, next: T | undefined, prev: T | undefined) => void): () => void;
  // 外部から通知を発火する (cross-tab 連携用、内部 set/remove からも呼ばれる)
  emit(key: string, next: T | undefined, prev: T | undefined): void;
}

// withObservable の生成オプション
export interface WithObservableOptions {
  // cross-tab 連携のための emit を有効化するか (核となる挙動には影響しないがドキュメント上の意図を明示)
  crossTab?: boolean;
}

// 既存 KvStore に変更通知 (subscribe / emit) を付与するミドルウェアを生成する
// inner が既に subscribe を持っていても無視し、本ミドルウェアが通知の唯一の経路となる
// (二重通知を避けるため。inner.subscribe を活かしたいなら withObservable を被せない)
export function withObservable<T>(
  // 生成オプション (省略可)
  _options?: WithObservableOptions,
): (inner: KvStore<T>) => KvStoreObservable<T> {
  // カリー化された wrapper を返す
  return (inner: KvStore<T>): KvStoreObservable<T> => {
    // 購読者集合 (Set で重複防止)
    const listeners = new Set<(key: string, next: T | undefined, prev: T | undefined) => void>();
    // 内部から listener へ通知する関数
    const emit = (key: string, next: T | undefined, prev: T | undefined): void => {
      // 走査中の add/delete で影響を受けないよう配列スナップショットを使う
      for (const listener of Array.from(listeners)) {
        // 個別のリスナーを呼び出す (例外は呼び出し側で扱う)
        listener(key, next, prev);
      }
    };
    // キーごとの直列化チェーン (各キーの最後にキューへ繋いだ op の Promise を保持)
    // 同一キーへの並行 set/remove で read-modify-write がインターリーブする問題を防ぐ
    const chains = new Map<string, Promise<unknown>>();
    // clear 実行中を示すゲート (新規 set/remove はこれを await してから開始する)
    let clearInFlight: Promise<void> | null = null;
    // キー単位に op を直列化する (clear と排他、前段 tail を待ってから op を実行)
    const runSerially = async <R>(key: string, op: () => Promise<R>): Promise<R> => {
      // clear と排他: clear 中は新規 op が開始しないよう待機する
      // (clear が複数連続する可能性に備え while で再チェック)
      while (clearInFlight !== null) {
        await clearInFlight;
      }
      // 前段 tail を取り出す (未登録なら即座に resolve した Promise から始める)
      const prev = chains.get(key) ?? Promise.resolve();
      // 前段 tail に op を繋ぐ (前段が成功でも失敗でも op が実行されるよう .then(onFulfilled, onRejected))
      const next: Promise<R> = prev.then(
        () => op(),
        () => op(),
      );
      // tail を更新する (同一キーへの次の op はこの next を待つことで直列化される)
      chains.set(key, next);
      try {
        // 自分の op が完了するまで待って結果を返す
        return await next;
      } finally {
        // 自分が末尾のままなら Map から削除 (長期保持されるキーで chain が線形に伸びるのを防止)
        if (chains.get(key) === next) {
          chains.delete(key);
        }
      }
    };
    // 完成した KvStoreObservable を組み立てる
    const wrapped: KvStoreObservable<T> = {
      // 取得は inner に委譲
      async get(key: string): Promise<T | undefined> {
        // inner の値をそのまま返す
        return inner.get(key);
      },
      // 保存: 変更前後の値を取得して emit する (キー単位に直列化)
      async set(key: string, value: T): Promise<void> {
        // キーごとロック下で read-modify-write を 1 単位として実行する
        return runSerially(key, async () => {
          // 変更前の値を取得 (通知の prev に使う)
          const prev = await inner.get(key);
          // 値を保存
          await inner.set(key, value);
          // 購読者に通知 (set の順序と emit の順序は直列化により一致する)
          emit(key, value, prev);
        });
      },
      // 削除: 変更前の値を取得して emit する (キー単位に直列化)
      async remove(key: string): Promise<void> {
        // キーごとロック下で read-modify-write を 1 単位として実行する
        return runSerially(key, async () => {
          // 変更前の値を取得 (通知の prev に使う)
          const prev = await inner.get(key);
          // 未保存キーへの remove は通知も発火させない (no-op)
          if (prev === undefined) {
            // inner には委譲する (バックエンドの判断に従う)
            await inner.remove(key);
            // 通知はスキップ
            return;
          }
          // 削除を inner に委譲
          await inner.remove(key);
          // 購読者に通知 (next は undefined)
          emit(key, undefined, prev);
        });
      },
      // 購読: listener 集合に追加し、解除関数を返す
      subscribe(listener): () => void {
        // 集合に追加
        listeners.add(listener);
        // 解除関数を返す
        return () => {
          // 集合から削除 (二重解除でも no-op)
          listeners.delete(listener);
        };
      },
      // 外部からの通知発火 (cross-tab event リスナー等から呼ばれる)
      emit(key, next, prev): void {
        // 内部 emit と同じ動作 (公開シグネチャ)
        emit(key, next, prev);
      },
    };
    // inner.has があれば素通しで提供
    if (inner.has !== undefined) {
      const innerHas = inner.has;
      wrapped.has = async (key: string): Promise<boolean> => innerHas(key);
    }
    // inner.keys があれば素通しで提供
    if (inner.keys !== undefined) {
      const innerKeys = inner.keys;
      wrapped.keys = async (): Promise<readonly string[]> => innerKeys();
    }
    // clear をゲート + drain 付きで実行する共通ヘルパ (keys 有無いずれの分岐でも使う)
    // 1. 既に clear 実行中ならその完了を待つ (clear 連発の直列化)
    // 2. clearInFlight に新しいゲート Promise を登録し、新規 set/remove をブロックする
    // 3. 既存 in-flight な set/remove を drain して emit を先行させる
    // 4. core 処理 (snapshot + clear + emit) を実行
    // 5. ゲートを解放して新規 set/remove を再開させる
    const runClearWithGate = async (coreClear: () => Promise<void>): Promise<void> => {
      // 連続する clear 同士を直列化する
      while (clearInFlight !== null) {
        await clearInFlight;
      }
      // 新しいゲート (deferred Promise) を組み立てる
      let resolveGate!: () => void;
      const gate = new Promise<void>((r) => {
        // resolve 関数を外側にホイストする
        resolveGate = r;
      });
      // 自身をゲートとして公開し、新規 set/remove を待たせる
      clearInFlight = gate;
      try {
        // 既存 in-flight な set/remove を drain する (これらの emit を clear より前に観測させる)
        const pending = Array.from(chains.values());
        if (pending.length > 0) {
          // 排他のための drain なので reject は無視する (allSettled で待ち切る)
          await Promise.allSettled(pending);
        }
        // クリア本体 (snapshot + innerClear + emit) を実行
        await coreClear();
      } finally {
        // ゲートを解放して新規 set/remove を再開させる (await していた他の op が走れるようになる)
        resolveGate();
        // ゲートを null に戻す (他の clear が再競合に勝てるよう、必ず自分の責任で解放する)
        // 別 clear は while ループでブロックされており、ここを抜けるまで clearInFlight を書き換えないため
        // 同一性比較は不要 (clearInFlight は常に自身の gate を指している)
        clearInFlight = null;
      }
    };
    // inner.clear があれば、クリア前の全エントリで emit する
    if (inner.clear !== undefined && inner.keys !== undefined) {
      const innerClear = inner.clear;
      const innerKeys = inner.keys;
      wrapped.clear = async (): Promise<void> => {
        // ゲート + drain 付きで clear 本体を実行する
        await runClearWithGate(async (): Promise<void> => {
          // 通知のためにキー一覧と各値を退避する
          const allKeys = await innerKeys();
          const snapshot: Array<[string, T | undefined]> = [];
          // 各キーの値を読み込んでスナップショット
          for (const k of allKeys) {
            // 値を取得 (未保存は undefined になりうる)
            const v = await inner.get(k);
            // スナップショットに記録
            snapshot.push([k, v]);
          }
          // 一括削除を実行
          await innerClear();
          // スナップショットを使って全キーの削除通知を発火
          for (const [k, prev] of snapshot) {
            // 削除なので next=undefined
            emit(k, undefined, prev);
          }
        });
      };
    } else if (inner.clear !== undefined) {
      // keys が無いバックエンドでは listener への一括通知が出来ないため、clear のみ委譲する
      // (それでも set/remove との直列化は適用する)
      const innerClear = inner.clear;
      wrapped.clear = async (): Promise<void> => {
        // ゲート + drain 付きで innerClear のみ実行 (emit は無し)
        await runClearWithGate(async (): Promise<void> => {
          // 委譲して終わり
          await innerClear();
        });
      };
    }
    // 完成した KvStoreObservable を返す
    return wrapped;
  };
}
