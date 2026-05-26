// React hook
import { useCallback, useEffect, useRef, useState } from "react";
// core 型
import type { BarcodeScanResult, ScannerConfig } from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";

// 戻り値の型
export interface UseBarcodeScannerResult {
  // スキャン中
  scanning: boolean;
  // 履歴（historyLimit 件まで）
  results: readonly BarcodeScanResult[];
  // 直近エラー
  error: unknown;
  // 開始
  start: (onScan?: (r: BarcodeScanResult) => void) => Promise<void>;
  // 停止
  stop: () => void;
}

// バーコードスキャナ hook（React Native 版）
export function useBarcodeScanner(
  config: ScannerConfig,
  options: { historyLimit?: number; autoStart?: boolean } = {},
): UseBarcodeScannerResult {
  const manager = useCamera();
  const historyLimit = options.historyLimit ?? 5;
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<readonly BarcodeScanResult[]>([]);
  const [error, setError] = useState<unknown>(undefined);
  const unsubRef = useRef<(() => void) | undefined>(undefined);

  const start = useCallback(
    async (onScan?: (r: BarcodeScanResult) => void): Promise<void> => {
      if (unsubRef.current !== undefined) {
        return;
      }
      setError(undefined);
      try {
        const unsub = await manager.startScanning(config, (r) => {
          setResults((prev) => {
            const next = [...prev, r];
            return next.slice(-historyLimit);
          });
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

  const stop = useCallback((): void => {
    if (unsubRef.current !== undefined) {
      unsubRef.current();
      unsubRef.current = undefined;
    }
    setScanning(false);
  }, []);

  useEffect(() => {
    if (options.autoStart !== true) {
      return;
    }
    void start();
    return () => {
      if (unsubRef.current !== undefined) {
        unsubRef.current();
        unsubRef.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.autoStart]);

  return { scanning, results, error, start, stop };
}
