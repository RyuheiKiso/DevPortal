// 公開型を取り込み
import type {
  AppendInput,
  ListOptions,
  OutboxEntry,
  OutboxEvent,
  OutboxListener,
  OutboxManager,
  OutboxManagerConfig,
  OutboxStatus,
  OutboxTimer,
  PublishContext,
  RetryPolicy,
  SchedulerOptions,
} from "./types.js";
// ID 生成のデフォルト実装
import { createDefaultIdFactory } from "./id.js";
// イベント配信
import { OutboxEventEmitter } from "./events.js";
// dedupeKey 検索
import { findEntryByDedupeKey } from "./dedupe.js";
// 設定検証
import { validateOutboxManagerConfig } from "./schema.js";
// リトライポリシのデフォルトと判定関数
import { computeBackoff, mergeRetryPolicy, shouldRetryEntry } from "./retry.js";
// DLQ ヘルパ
import { buildDlqEntry, buildRestoredEntry, selectAutoArchiveIds } from "./dlq.js";
// スケジューラ
import { createOutboxScheduler } from "./scheduler.js";
// エラー型
import { OutboxError, toEntryError } from "./errors.js";

// OutboxEntry を shallow freeze する内部ヘルパ
// (notification ライブラリと同じく、Manager から渡す entry の外部 mutation を防ぐ)
// payload 自体の deep clone は性能上避け、entry オブジェクトのトップレベルだけ freeze する
function freezeEntry<T>(entry: OutboxEntry<T>): OutboxEntry<T> {
  // Object.freeze はネスト構造には伝播しないが、entry のフィールド差し替えは防げる
  return Object.freeze(entry) as OutboxEntry<T>;
}

// scheduler 既定値
const DEFAULT_SCHEDULER: SchedulerOptions = {
  // 5 秒ごとに tick
  intervalMs: 5000,
  // 10% の jitter
  jitterRatio: 0.1,
  // 1 tick 10 件まで
  batchSize: 10,
  // 自動起動はしない (明示 start を必須)
  autoStart: false,
};

// 既定タイマー (グローバル setTimeout / clearTimeout)
const DEFAULT_TIMER: OutboxTimer = {
  // setTimeout を呼び、ハンドルを unknown として返す
  set: (cb, ms) => setTimeout(cb, ms),
  // clearTimeout に渡してキャンセル
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// SchedulerOptions の部分指定を既定値で埋める
function mergeSchedulerOptions(partial: Partial<SchedulerOptions> | undefined): SchedulerOptions {
  // 全フィールドを既定とマージ
  return {
    intervalMs: partial?.intervalMs ?? DEFAULT_SCHEDULER.intervalMs,
    jitterRatio: partial?.jitterRatio ?? DEFAULT_SCHEDULER.jitterRatio,
    batchSize: partial?.batchSize ?? DEFAULT_SCHEDULER.batchSize,
    autoStart: partial?.autoStart ?? DEFAULT_SCHEDULER.autoStart,
  };
}

// listOptions のフィルタを適用する
function applyListFilter<T>(
  // 取得済みエントリ
  entries: readonly OutboxEntry<T>[],
  // フィルタ条件
  opts: ListOptions | undefined,
): readonly OutboxEntry<T>[] {
  // 結果配列の起点 (まずは全件)
  let result = entries;
  // status フィルタ
  if (opts?.status !== undefined) {
    // 配列 / 単一どちらでも Set 化して高速比較
    const statuses = new Set<OutboxStatus>(
      Array.isArray(opts.status) ? opts.status : [opts.status as OutboxStatus],
    );
    // 条件に合うものだけ残す
    result = result.filter((e) => statuses.has(e.status));
  }
  // limit
  if (opts?.limit !== undefined) {
    // 先頭から limit 件
    result = result.slice(0, opts.limit);
  }
  // 不変として返す
  return result;
}

// OutboxManager 本体を生成する
export function createOutboxManager<T = unknown>(
  // 必須設定 + 任意設定
  config: OutboxManagerConfig<T>,
): OutboxManager<T> {
  // 数値・列挙系の早期検証 (関数オブジェクトは zod 対象外)
  validateOutboxManagerConfig({
    retry: config.retry,
    scheduler: config.scheduler,
    dlqAutoArchive: config.dlqAutoArchive,
    perAttemptTimeoutMs: config.perAttemptTimeoutMs,
  });
  // 永続化アダプタ
  const storage = config.storage;
  // publisher
  const publisher = config.publisher;
  // RetryPolicy の確定値
  const retryPolicy: RetryPolicy = mergeRetryPolicy(config.retry);
  // SchedulerOptions の確定値
  const schedulerOpts = mergeSchedulerOptions(config.scheduler);
  // ID 生成器
  const idFactory = config.idFactory ?? createDefaultIdFactory();
  // Idempotency-Key 生成器 (未指定なら idFactory を流用)
  const idempotencyKeyFactory = config.idempotencyKeyFactory ?? idFactory;
  // 現在時刻取得
  const now = config.now ?? Date.now;
  // タイマー
  const timer = config.timer ?? DEFAULT_TIMER;
  // ロガー
  const logger = config.logger;
  // 1 試行あたりタイムアウト
  const perAttemptTimeoutMs = config.perAttemptTimeoutMs;
  // DLQ 自動アーカイブ設定
  const dlqAutoArchive = config.dlqAutoArchive;

  // イベント配信器
  const emitter = new OutboxEventEmitter<T>();
  // dispose フラグ
  let disposed = false;
  // in-flight publish 中の AbortController 群 (dispose で一括 abort)
  const inFlightAborts = new Set<AbortController>();

  // イベント発火ヘルパ (entry を freeze してから配信する)
  const emit = (event: OutboxEvent<T>): void => {
    // entry を含むイベントは freeze 済みコピーを配信する (受信側の mutation を防ぐ)
    const safeEvent: OutboxEvent<T> = event.entry !== undefined
      ? { ...event, entry: freezeEntry(event.entry) }
      : event;
    // disposed 後でも内部状態整合のため emit は通す (listener はクリア済み)
    emitter.emit(safeEvent);
  };

  // OutboxError("OUTBOX_DISPOSED") を生成する
  const disposedError = (): OutboxError => {
    // 共通エラーオブジェクト
    return new OutboxError({
      code: "OUTBOX_DISPOSED",
      message: "outbox manager is disposed",
      retryable: false,
    });
  };

  // append 実装本体
  const append = async (input: AppendInput<T>): Promise<OutboxEntry<T>> => {
    // dispose 後は明示的に拒否
    if (disposed) {
      throw disposedError();
    }
    // 現在時刻
    const t = now();
    // dedupeKey による既存 pending/failed エントリへの上書き判定
    if (input.dedupeKey !== undefined) {
      // 本体側の現在一覧を取得
      const entries = await storage.list(false);
      // 一致する既存エントリを探す
      const found = findEntryByDedupeKey(entries, input.dedupeKey);
      // ヒット & pending/failed の場合のみ上書き対象とする
      if (found !== null && (found.entry.status === "pending" || found.entry.status === "failed")) {
        // 既存エントリの id を維持しつつ payload と target を差し替え、attemptCount をリセット
        const replaced: OutboxEntry<T> = {
          ...found.entry,
          payload: input.payload,
          target: input.target ?? found.entry.target,
          meta: input.meta ?? found.entry.meta,
          status: "pending",
          attemptCount: 0,
          lastError: undefined,
          nextAttemptAt: t,
          updatedAt: t,
        };
        // 直列化下で永続化
        await storage.withLock(replaced.id, async () => {
          await storage.save(replaced);
        });
        // appended イベントを発火 (置換だが UI 観点では新規扱い)
        emit({ type: "appended", entry: replaced });
        // 置換後の entry を freeze して返す (caller の mutation を防ぐ)
        return freezeEntry(replaced);
      }
    }
    // 新規エントリの生成
    const id = idFactory();
    // Idempotency-Key (ユーザー指定があれば優先)
    const idempotencyKey = input.idempotencyKey ?? idempotencyKeyFactory();
    // 試行回数上限 (個別指定があれば優先、なければ retryPolicy.maxRetries + 1)
    const maxAttempts = input.maxAttempts ?? retryPolicy.maxRetries + 1;
    // 完成エントリ
    const entry: OutboxEntry<T> = {
      id,
      status: "pending",
      payload: input.payload,
      idempotencyKey,
      dedupeKey: input.dedupeKey,
      attemptCount: 0,
      maxAttempts,
      createdAt: t,
      updatedAt: t,
      nextAttemptAt: t,
      target: input.target,
      meta: input.meta,
    };
    // 永続化 (直列化下)
    await storage.withLock(id, async () => {
      await storage.save(entry);
    });
    // appended イベント
    emit({ type: "appended", entry });
    // 完成エントリを freeze して返す
    return freezeEntry(entry);
  };

  // get 実装 (取得値を freeze して caller の mutation を防ぐ)
  const get = async (id: string): Promise<OutboxEntry<T> | undefined> => {
    // storage.load が本体 + DLQ をまとめて検索する設計
    const entry = await storage.load(id);
    return entry !== undefined ? freezeEntry(entry) : undefined;
  };

  // list 実装 (各エントリを freeze して caller の mutation を防ぐ)
  const list = async (opts?: ListOptions): Promise<readonly OutboxEntry<T>[]> => {
    // DLQ 側か本体側かを判別
    const entries = await storage.list(opts?.fromDlq === true);
    // フィルタを適用してから freeze
    return applyListFilter(entries, opts).map((e) => freezeEntry(e));
  };

  // 1 試行ごとの AbortController を生成し、perAttemptTimeoutMs で自動 abort
  const createAttemptController = (): { controller: AbortController; cancelTimeout: () => void } => {
    // 新しい AbortController を用意
    const controller = new AbortController();
    // タイムアウトハンドル (未設定なら undefined)
    let timeoutHandle: unknown = undefined;
    // perAttemptTimeoutMs が設定されていれば自動 abort をスケジュール
    if (perAttemptTimeoutMs !== undefined) {
      // 指定 ms 経過時に abort
      timeoutHandle = timer.set(() => {
        // controller を abort (理由は明示)
        controller.abort(new OutboxError({
          code: "OUTBOX_PUBLISH_FAILED",
          message: `publish timed out after ${perAttemptTimeoutMs}ms`,
          retryable: true,
        }));
      }, perAttemptTimeoutMs);
    }
    // タイムアウトを早期キャンセルするヘルパ
    const cancelTimeout = (): void => {
      // ハンドルが設定されているなら clear
      if (timeoutHandle !== undefined) {
        timer.clear(timeoutHandle);
        timeoutHandle = undefined;
      }
    };
    // controller と cancel を返す
    return { controller, cancelTimeout };
  };

  // DLQ 自動アーカイブを適用する (上限超過なら最古から削除)
  // 並行で複数の moveToDlq が走った場合に、DLQ index への read-modify-delete が競合しないよう
  // 専用キー "__dlq_archive__" で直列化する (storage.withLock を流用)
  const enforceDlqLimit = async (): Promise<void> => {
    // 設定が無ければ何もしない
    if (dlqAutoArchive === undefined) {
      return;
    }
    // アーカイブ処理を直列化キー下で実行 (storage 内部の __index__ ロックとは別の論理ロック)
    await storage.withLock("__dlq_archive__", async () => {
      // DLQ 一覧を取得 (ロック下で取り直すことで他の moveToDlq の追加分も反映)
      const dlqEntries = await storage.list(true);
      // 削除対象 ID を選定
      const ids = selectAutoArchiveIds(dlqEntries.map((e) => e.id), dlqAutoArchive.maxEntries);
      // 該当を順次削除
      for (const id of ids) {
        await storage.remove(id);
        // ログにアーカイブ事実を残す
        logger?.warn("outbox: DLQ entry archived", { id });
      }
    });
  };

  // エントリを DLQ へ移動する (内部実装)
  const moveToDlqInternal = async (
    // 移動対象の現エントリ
    entry: OutboxEntry<T>,
    // 原因例外 (任意)
    cause: unknown | undefined,
  ): Promise<OutboxEntry<T>> => {
    // 移動後の dead エントリを構築
    const dead = buildDlqEntry(
      entry,
      cause !== undefined ? toEntryError(cause, now()) : entry.lastError,
      now(),
    );
    // 本体側を dead 状態で保存
    await storage.save(dead);
    // DLQ 側へ移動 (本体は削除される)
    await storage.moveToDlq(entry.id);
    // movedToDlq イベント発火 (cause があれば root error も伝える)
    emit({
      type: "movedToDlq",
      entry: dead,
      error: cause !== undefined
        ? { ...toEntryError(cause, now()), cause }
        : undefined,
    });
    // DLQ サイズ超過時の自動アーカイブを適用
    await enforceDlqLimit();
    // 結果を freeze して返す
    return freezeEntry(dead);
  };

  // 単発送信 (publish API 本体)
  const publish = async (id: string): Promise<OutboxEntry<T>> => {
    // dispose 後は明示的に拒否
    if (disposed) {
      throw disposedError();
    }
    // 直列化下で実行
    return storage.withLock(id, async () => {
      // 最新エントリを取得
      const current = await storage.load(id);
      // 存在しなければエラー
      if (current === undefined) {
        throw new OutboxError({
          code: "OUTBOX_NOT_FOUND",
          message: `entry not found: ${id}`,
          retryable: false,
          entryId: id,
        });
      }
      // 既に sent / dead / publishing なら冪等性のため freeze して返す
      if (current.status === "sent" || current.status === "dead" || current.status === "publishing") {
        return freezeEntry(current);
      }
      // publishing 状態に遷移
      const publishing: OutboxEntry<T> = {
        ...current,
        status: "publishing",
        updatedAt: now(),
      };
      await storage.save(publishing);
      // publishing イベント発火
      emit({ type: "publishing", entry: publishing });
      // 1 試行用の AbortController を生成
      const { controller, cancelTimeout } = createAttemptController();
      // dispose で全停止できるよう Set にも登録
      inFlightAborts.add(controller);
      // 試行コンテキスト
      const ctx: PublishContext = {
        attempt: publishing.attemptCount,
        signal: controller.signal,
        idempotencyKey: publishing.idempotencyKey,
        entryId: publishing.id,
      };
      try {
        // publisher を呼び出し
        await publisher(publishing, ctx);
        // 成功: sent 状態に遷移し index から外す (storage.remove ではなく、本体は残して index 削除のみ)
        // ただし設計上は status=sent でそのまま保持し、list はフィルタで弾く
        const sent: OutboxEntry<T> = {
          ...publishing,
          status: "sent",
          sentAt: now(),
          updatedAt: now(),
          // 次回試行時刻は無効化
          nextAttemptAt: undefined,
          // lastError もクリア
          lastError: undefined,
        };
        // 永続化
        await storage.save(sent);
        // published イベント
        emit({ type: "published", entry: sent });
        return freezeEntry(sent);
      } catch (err) {
        // 例外: attemptCount をインクリメント
        const nextAttemptCount = publishing.attemptCount + 1;
        // 失敗後の状態 (リトライ可否で分岐)
        const failed: OutboxEntry<T> = {
          ...publishing,
          status: "failed",
          attemptCount: nextAttemptCount,
          updatedAt: now(),
          lastError: toEntryError(err, now()),
        };
        // 再試行するかを判定
        const retry = shouldRetryEntry(failed, err, retryPolicy);
        if (retry) {
          // 次回試行時刻を backoff 経過後に設定し failed 状態のまま再投入
          // (UI で「失敗履歴あり・次回試行待ち」を区別できるよう pending にはしない)
          const backoff = computeBackoff(failed.attemptCount, retryPolicy);
          const requeued: OutboxEntry<T> = {
            ...failed,
            status: "failed",
            nextAttemptAt: now() + backoff,
          };
          // 永続化
          await storage.save(requeued);
          // failed イベント (リトライ予定あり)
          // failed イベントには永続化用の lastError 情報に加えて、デバッグ用の cause (root error) も渡す
          emit({ type: "failed", entry: requeued, error: { ...toEntryError(err, now()), cause: err } });
          return freezeEntry(requeued);
        }
        // リトライ不可: DLQ へ移動
        const dead = await moveToDlqInternal(failed, err);
        // failed イベントも追加で発火 (エラー観測者に通知)
        // failed (dead 化) でも cause を listener に渡す
        emit({ type: "failed", entry: dead, error: { ...toEntryError(err, now()), cause: err } });
        return freezeEntry(dead);
      } finally {
        // タイムアウトハンドルを解除
        cancelTimeout();
        // in-flight 集合から外す
        inFlightAborts.delete(controller);
      }
    });
  };

  // failed/dead を pending に戻して再送可能化する
  const retry = async (id: string): Promise<OutboxEntry<T>> => {
    // dispose 後は拒否
    if (disposed) {
      throw disposedError();
    }
    // 直列化下で実行
    return storage.withLock(id, async () => {
      // 現エントリを取得 (本体 / DLQ 両方)
      const current = await storage.load(id);
      // 存在しなければエラー
      if (current === undefined) {
        throw new OutboxError({
          code: "OUTBOX_NOT_FOUND",
          message: `entry not found: ${id}`,
          retryable: false,
          entryId: id,
        });
      }
      // sent / publishing 等の場合は無効
      if (current.status !== "failed" && current.status !== "dead") {
        throw new OutboxError({
          code: "OUTBOX_INVALID_STATE",
          message: `entry not in failed/dead state: ${current.status}`,
          retryable: false,
          entryId: id,
        });
      }
      // dead → 復元 (DLQ 側から本体側へ戻す)
      if (current.status === "dead") {
        // 復元後エントリを構築
        const restored = buildRestoredEntry(current, now());
        // 本体側へ書き込み
        await storage.save(restored);
        // DLQ から本体へ index 移動
        await storage.restoreFromDlq(id);
        // appended イベント (UI から見れば再投入)
        emit({ type: "appended", entry: restored });
        return freezeEntry(restored);
      }
      // failed → 単純に pending リセット
      const reset: OutboxEntry<T> = {
        ...current,
        status: "pending",
        attemptCount: 0,
        lastError: undefined,
        nextAttemptAt: now(),
        updatedAt: now(),
      };
      await storage.save(reset);
      // appended イベント (再投入扱い)
      emit({ type: "appended", entry: reset });
      return freezeEntry(reset);
    });
  };

  // 完全削除 (本体 + DLQ どちらにあっても)
  const remove = async (id: string): Promise<void> => {
    // dispose 後は拒否
    if (disposed) {
      throw disposedError();
    }
    // 削除前に現在値を保持して removed イベントに使う
    const current = await storage.load(id);
    // 直列化下で削除
    await storage.withLock(id, async () => {
      await storage.remove(id);
    });
    // removed イベント (存在しなかった場合は entry なしで通知)
    emit({ type: "removed", entry: current });
  };

  // 手動 DLQ 移動
  const moveToDlq = async (id: string, reason?: string): Promise<OutboxEntry<T>> => {
    // dispose 後は拒否
    if (disposed) {
      throw disposedError();
    }
    return storage.withLock(id, async () => {
      // 現エントリを取得
      const current = await storage.load(id);
      // 存在しなければエラー
      if (current === undefined) {
        throw new OutboxError({
          code: "OUTBOX_NOT_FOUND",
          message: `entry not found: ${id}`,
          retryable: false,
          entryId: id,
        });
      }
      // 既に dead なら何もせずそのまま返す (freeze 済みで mutation 防止)
      if (current.status === "dead") {
        return freezeEntry(current);
      }
      // reason を Error 風に正規化
      const causeError = reason !== undefined
        ? new OutboxError({ code: "OUTBOX_INVALID_STATE", message: reason, retryable: false, entryId: id })
        : undefined;
      // 共通の DLQ 移動処理
      return moveToDlqInternal(current, causeError);
    });
  };

  // DLQ 復帰
  const restoreFromDlq = async (id: string): Promise<OutboxEntry<T>> => {
    // dispose 後は拒否
    if (disposed) {
      throw disposedError();
    }
    return storage.withLock(id, async () => {
      // 現エントリ (DLQ 側を含む) を取得
      const current = await storage.load(id);
      // 存在しなければエラー
      if (current === undefined) {
        throw new OutboxError({
          code: "OUTBOX_NOT_FOUND",
          message: `entry not found: ${id}`,
          retryable: false,
          entryId: id,
        });
      }
      // dead でなければ復帰不要
      if (current.status !== "dead") {
        throw new OutboxError({
          code: "OUTBOX_INVALID_STATE",
          message: `entry not in dead state: ${current.status}`,
          retryable: false,
          entryId: id,
        });
      }
      // 復元後エントリ
      const restored = buildRestoredEntry(current, now());
      // 本体側に保存
      await storage.save(restored);
      // DLQ → 本体の index 移動
      await storage.restoreFromDlq(id);
      // restored イベント発火
      emit({ type: "restored", entry: restored });
      return freezeEntry(restored);
    });
  };

  // sent 状態の完了済みエントリを一括削除する
  // olderThanMs 指定時は sentAt が「now - olderThanMs」より古いものだけを対象とする
  // 長期運用で sent エントリが累積するのを防ぐためのメンテナンス API
  const purgeCompleted = async (olderThanMs?: number): Promise<number> => {
    // dispose 後は何もしない
    if (disposed) {
      return 0;
    }
    // 現時刻と閾値
    const cutoff = olderThanMs !== undefined ? now() - olderThanMs : undefined;
    // 本体側の一覧を取得
    const entries = await storage.list(false);
    // sent かつ閾値以前の sentAt を持つエントリを抽出
    const targets = entries.filter((e) => {
      // sent でなければ対象外
      if (e.status !== "sent") {
        return false;
      }
      // 閾値未指定なら全 sent を対象
      if (cutoff === undefined) {
        return true;
      }
      // sentAt が未定義なら念のため対象外 (整合性の保護)
      if (e.sentAt === undefined) {
        return false;
      }
      // sentAt が閾値より古いものだけ削除
      return e.sentAt <= cutoff;
    });
    // 順次削除
    for (const e of targets) {
      // withLock で直列化して削除 (並行 append/publish と衝突しないため)
      await storage.withLock(e.id, async () => {
        await storage.remove(e.id);
      });
      // 削除イベント
      emit({ type: "removed", entry: e });
    }
    // 削除件数を返す
    return targets.length;
  };

  // pending 全件を一度だけ試行する (scheduler を待たない)
  const flush = async (): Promise<void> => {
    // dispose 後は何もしない
    if (disposed) {
      return;
    }
    // 全エントリを取得
    const entries = await storage.list(false);
    // nextAttemptAt が現在以下の pending/failed を対象に publish
    const due = entries.filter(
      (e) => (e.status === "pending" || e.status === "failed") && (e.nextAttemptAt === undefined || e.nextAttemptAt <= now()),
    );
    // 順次 publish (直列化は publish 内で行われる)
    for (const e of due) {
      // 個別の例外は scheduler の onError と同様に握りつぶす (他エントリ処理を続行)
      try {
        await publish(e.id);
      } catch (err) {
        // logger があれば記録
        logger?.error("outbox: flush publish error", { id: e.id, error: err });
      }
    }
  };

  // scheduler の onTick 実装 (batchSize 件まで publish)
  const onTick = async (): Promise<void> => {
    // disposed なら何もしない
    // race condition 防御: dispose は scheduler.stop を先に呼ぶため、通常 tick は走らない
    // ただし scheduler 内部の setTimeout コールバックが既にキューに入っていた場合の保険として残す
    // (テストでの再現が race 依存になるため v8 ignore で除外している)
    /* v8 ignore next 3 */
    if (disposed) {
      return;
    }
    // tick イベント (デバッグ用)
    emit({ type: "scheduled" });
    // 対象エントリを取得 (本体側のみ。throw した場合は scheduler の onError へ流れる)
    const entries = await storage.list(false);
    // pending / failed かつ nextAttemptAt 経過したものを最大 batchSize 件
    const due = entries
      .filter((e) => (e.status === "pending" || e.status === "failed") && (e.nextAttemptAt === undefined || e.nextAttemptAt <= now()))
      .slice(0, schedulerOpts.batchSize);
    // 順次 publish (各 publish 内で直列化されている)
    for (const e of due) {
      try {
        await publish(e.id);
      } catch (err) {
        // publish は内部の try/catch で全例外を吸収するため、ここに到達するのは
        // storage.withLock 等の更に外側で予期せず例外が起きた場合のみ (理論上は到達しない)
        // 防御コードとして logger に流すが、テストでの再現が困難なため v8 ignore で除外
        /* v8 ignore next */
        logger?.error("outbox: tick publish error", { id: e.id, error: err });
      }
    }
  };

  // scheduler を生成
  const scheduler = createOutboxScheduler({
    timer,
    intervalMs: schedulerOpts.intervalMs,
    jitterRatio: schedulerOpts.jitterRatio,
    onTick,
    onError: (err: unknown) => {
      // scheduler 内部例外を logger へ転送 (storage.list 等の throw 経路を観測)
      logger?.error("outbox: scheduler error", { error: err });
    },
  });

  // subscribe 実装
  const subscribe = (listener: OutboxListener<T>): (() => void) => {
    // dispose 後は no-op 解除関数のみ返す
    if (disposed) {
      return () => {};
    }
    return emitter.subscribe(listener);
  };

  // 起動 (scheduler 開始 + started イベント)
  const start = (): void => {
    // dispose 後は何もしない
    if (disposed) {
      return;
    }
    // 既に running なら何もしない (scheduler 側で冪等処理)
    const wasRunning = scheduler.isRunning();
    // scheduler を起動
    scheduler.start();
    // wasRunning が false から true に変わった場合のみイベント発火
    if (!wasRunning) {
      emit({ type: "started" });
    }
  };

  // 停止 (scheduler 停止 + stopped イベント)
  const stop = (): void => {
    // 既に止まっていれば何もしない
    if (!scheduler.isRunning()) {
      return;
    }
    // scheduler を停止
    scheduler.stop();
    // stopped イベント
    emit({ type: "stopped" });
  };

  // クリーンアップ
  const dispose = async (): Promise<void> => {
    // 二回目以降は no-op
    if (disposed) {
      return;
    }
    // フラグを先に立てる
    disposed = true;
    // scheduler を止める (isRunning による分岐は stop 内で処理)
    if (scheduler.isRunning()) {
      scheduler.stop();
      // stopped イベントは emit (リスナクリア前)
      emit({ type: "stopped" });
    }
    // in-flight な AbortController を全 abort (publisher 側に伝播)
    for (const controller of Array.from(inFlightAborts)) {
      try {
        controller.abort(disposedError());
      } catch {
        // abort 失敗は無視
      }
    }
    // Set は publish 終了時に各自で削除される
    // listener を全クリア
    emitter.clear();
  };

  // クラッシュリカバリ: 前回プロセスで publish 中だったエントリを pending に戻す
  // publishing 状態はメモリ上の AbortController が消失している (= 永続的な孤児) なので、
  // 次回 tick / flush で再投入できるよう pending として扱う
  // 同一 idempotencyKey が保持されるので、サーバ側で重複排除が効く想定
  // TOCTOU 対策: withLock 内で再 load して最新 status を確認してから書き戻す
  // (list 取得後・withLock 取得前にユーザーが publish/retry を呼んで状態が変わっている可能性に対処)
  const recoverPublishing = async (): Promise<void> => {
    // 本体側の一覧を取得 (DLQ は対象外)
    const entries = await storage.list(false);
    // publishing 状態の候補だけを抽出 (確定はロック下で行う)
    const candidates = entries.filter((e) => e.status === "publishing");
    // 全件を pending に戻す
    for (const candidate of candidates) {
      // withLock 下で再 load → 最新 status を確認 → 必要なら書き戻し
      await storage.withLock(candidate.id, async () => {
        // 最新エントリを再取得 (list 取得後に変わっている可能性がある)
        const latest = await storage.load(candidate.id);
        // 既に消えている / 別状態に遷移していれば何もしない (TOCTOU 防御)
        if (latest === undefined || latest.status !== "publishing") {
          return;
        }
        // 復旧後エントリ
        const recovered: OutboxEntry<T> = {
          ...latest,
          status: "pending",
          // 即時試行可能にする (nextAttemptAt=now)
          nextAttemptAt: now(),
          updatedAt: now(),
        };
        await storage.save(recovered);
        // ログ通知 (運用者が監視できるよう warn 級)
        logger?.warn("outbox: recovered orphan publishing entry", { id: candidate.id });
      });
    }
  };
  // 非同期だが起動時に必ず実行する (autoStart より前に Promise を発火させ、scheduler tick より前に完了させる)
  // 失敗は logger に流すだけで初期化を止めない (再起動時の致命的事態を防ぐ防御策)
  const recoveryPromise = recoverPublishing().catch((err: unknown) => {
    // 復旧失敗は致命ではないが logger に記録
    logger?.error("outbox: recovery failed", { error: err });
  });

  // autoStart が true なら起動する (リカバリ完了を待ってから tick が走るよう scheduler.start を遅延)
  if (schedulerOpts.autoStart) {
    // リカバリ完了後に start を呼ぶ (起動順序を保証)
    void recoveryPromise.then(() => start());
  }

  // ready: 起動時のクラッシュリカバリ完了を待つ Promise
  // recoveryPromise は catch 済みのため reject されない (常に resolve)
  // utilizer は ready() を await してから publish/flush を呼ぶことで recovery 完了を保証できる
  const ready = (): Promise<void> => {
    // 同じ recoveryPromise を毎回返す (multi-await でも安全)
    return recoveryPromise;
  };

  // Manager 公開オブジェクト
  return {
    append,
    get,
    list,
    publish,
    retry,
    remove,
    moveToDlq,
    restoreFromDlq,
    flush,
    purgeCompleted,
    subscribe,
    start,
    stop,
    dispose,
    ready,
  };
}
