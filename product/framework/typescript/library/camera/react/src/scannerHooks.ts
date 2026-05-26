// React の hook
import { useCallback, useEffect, useRef, useState } from "react";
// core から型
import type { BarcodeScanResult, ScannerConfig } from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";

// useBarcodeScanner の戻り値
export interface UseBarcodeScannerResult {
  // スキャン中フラグ
  scanning: boolean;
  // 直近の結果（最大 5 件まで保持）
  results: readonly BarcodeScanResult[];
  // 直近エラー
  error: unknown;
  // 開始
  start: (onScan?: (r: BarcodeScanResult) => void) => Promise<void>;
  // 停止
  stop: () => void;
}

// useBarcodeScanner hook
export function useBarcodeScanner(
  config: ScannerConfig,
  options: { historyLimit?: number; autoStart?: boolean } = {},
): UseBarcodeScannerResult {
  const manager = useCamera();
  // 履歴上限（既定 5）
  const historyLimit = options.historyLimit ?? 5;
  // state
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<readonly BarcodeScanResult[]>([]);
  const [error, setError] = useState<unknown>(undefined);
  // unsubscribe 関数の保持
  const unsubRef = useRef<(() => void) | undefined>(undefined);

  // start
  const start = useCallback(
    async (onScan?: (r: BarcodeScanResult) => void): Promise<void> => {
      // 既にスキャン中なら何もしない
      if (unsubRef.current !== undefined) {
        return;
      }
      setError(undefined);
      try {
        const unsub = await manager.startScanning(config, (r) => {
          // 結果を履歴に push（末尾に追加し historyLimit を超えたら先頭を捨てる）
          setResults((prev) => {
            const next = [...prev, r];
            return next.slice(-historyLimit);
          });
          // ユーザコールバックがあれば実行
          onScan?.(r);
        });
        unsubRef.current = unsub;
        setScanning(true);
      } catch (err) {
        setError(err);
      }
    },
    [manager, config, historyLimit],
  );

  // stop
  const stop = useCallback((): void => {
    // unsubscribe 関数を呼ぶ
    if (unsubRef.current !== undefined) {
      unsubRef.current();
      unsubRef.current = undefined;
    }
    setScanning(false);
  }, []);

  // autoStart オプション
  useEffect(() => {
    // autoStart 無効なら何もしない
    if (options.autoStart !== true) {
      return;
    }
    void start();
    return () => {
      // unmount で必ず停止
      if (unsubRef.current !== undefined) {
        unsubRef.current();
        unsubRef.current = undefined;
      }
    };
    // 意図的に start を deps に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.autoStart]);

  return { scanning, results, error, start, stop };
}
