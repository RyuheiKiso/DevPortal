// React Native の Platform モジュールを取り込み（OS 判定に使用）
import { Platform } from "react-native";

// プラットフォームごとの設定マップ
// default を必須にして他は Partial（差分のみ）。RN 0.84 では windows / macos も公式対応
export interface PlatformConfigMap<T> {
  // 全プラットフォーム共通の既定値
  default: T;
  // iOS 用の差分
  ios?: Partial<T>;
  // Android 用の差分
  android?: Partial<T>;
  // Windows 用の差分（react-native-windows）
  windows?: Partial<T>;
  // macOS 用の差分（react-native-macos）
  macos?: Partial<T>;
}

// 実行中の Platform.OS に応じて default に差分をマージした設定を返す
// オブジェクト型のみを対象（浅いマージ）
export function mergePlatformConfig<T extends object>(
  // プラットフォーム別設定マップ
  map: PlatformConfigMap<T>,
): T {
  // 現在の OS 名を Platform から取得
  const os = Platform.OS as "ios" | "android" | "windows" | "macos" | "web" | "native";
  // OS に対応する差分を引き出す（無ければ undefined）
  const overrides =
    // iOS の場合
    os === "ios"
      ? map.ios
      : // Android の場合
        os === "android"
        ? map.android
        : // Windows の場合
          os === "windows"
          ? map.windows
          : // macOS の場合
            os === "macos"
            ? map.macos
            : // それ以外（web/native 等）はオーバーライド無し
              undefined;
  // default をベースに差分を浅くマージして返す
  return { ...map.default, ...(overrides ?? {}) } as T;
}
