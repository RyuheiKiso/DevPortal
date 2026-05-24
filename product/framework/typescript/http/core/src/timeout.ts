// withTimeout: 任意の非同期関数を AbortController で時限的に実行するヘルパ
// parentSignal と内部 timeout を合成し、どちらの abort も子 signal に伝播させる
export function withTimeout<T>(
  ms: number | undefined,
  parentSignal: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  // 内部の AbortController を 1 つ用意（タイムアウト or 親 abort を表現）
  const ctrl = new AbortController();
  // 親 signal の中断を子 signal に転送するハンドラ
  const onParentAbort = (): void => {
    // 親の中断理由を引き継ぐ（reason は any 互換）
    ctrl.abort(parentSignal?.reason);
  };
  // 親 signal が既に abort 済みの場合は即座に転送（addEventListener の前段）
  if (parentSignal !== undefined && parentSignal.aborted) {
    ctrl.abort(parentSignal.reason);
  }
  // 親 signal の abort を購読（一度限り）
  if (parentSignal !== undefined && !parentSignal.aborted) {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }
  // タイムアウト時に発火するタイマー ID（ms 未指定なら未設定）
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  // ms 指定がある場合のみタイマーを起動
  if (ms !== undefined) {
    timer = setTimeout(() => {
      // タイムアウト時は DOMException(TimeoutError) で abort（errors 層が "TIMEOUT" に正規化）
      ctrl.abort(new DOMException("timeout", "TimeoutError"));
    }, ms);
  }
  // fn を子 signal で実行し、結果を返す（finally でリソース解放）
  return (async (): Promise<T> => {
    try {
      // 子 signal を渡して fn を実行
      return await fn(ctrl.signal);
    } finally {
      // タイマーが起動中ならクリア
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      // 親 signal のリスナを解除（リーク防止）
      if (parentSignal !== undefined) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    }
  })();
}
