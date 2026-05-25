// react-native の Platform API を取り込み
import { Platform } from "react-native";
// core から Transport 型を取り込み
import type { Transport } from "@k1s0-ts-logger/core";

// Platform.OS ごとに使う Transport 群を切り替えるマップ
export interface PlatformTransportMap {
  // 全プラットフォーム共通（必須）
  default: readonly Transport[];
  // iOS 専用（指定があれば default を上書き）
  ios?: readonly Transport[];
  // Android 専用
  android?: readonly Transport[];
  // react-native-windows
  windows?: readonly Transport[];
  // react-native-macos
  macos?: readonly Transport[];
}

// Platform.OS から該当プラットフォーム向け Transport[] を取り出す
export function resolvePlatformTransports(map: PlatformTransportMap): readonly Transport[] {
  // 現在のプラットフォーム文字列（"ios" | "android" | "windows" | "macos" | "web" | "native"）
  const os = Platform.OS;
  // 各プラットフォーム別の指定があればそれを返し、無ければ default
  switch (os) {
    // iOS
    case "ios":
      return map.ios ?? map.default;
    // Android
    case "android":
      return map.android ?? map.default;
    // Windows（react-native-windows）
    case "windows":
      return map.windows ?? map.default;
    // macOS（react-native-macos）
    case "macos":
      return map.macos ?? map.default;
    // それ以外（web / native など）は default を返す
    default:
      return map.default;
  }
}
