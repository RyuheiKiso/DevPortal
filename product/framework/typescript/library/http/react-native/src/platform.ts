// react-native の Platform API を取り込み（Metro が解決、テストでは vi.doMock で差し替え）
import { Platform } from "react-native";

// Platform 別の fetch 実装マップ（default は必須）
export interface PlatformFetchMap {
  // すべての Platform に対するデフォルト fetch
  default: typeof fetch;
  // iOS 専用 fetch（任意、未指定なら default）
  ios?: typeof fetch;
  // Android 専用 fetch（任意、未指定なら default）
  android?: typeof fetch;
}

// Platform.OS に応じた fetch を返す（指定がなければ default にフォールバック）
export function resolvePlatformFetch(map: PlatformFetchMap): typeof fetch {
  // 現在の Platform.OS（"ios" | "android" | "windows" | "macos" | "web" | "native"）
  switch (Platform.OS) {
    // iOS
    case "ios":
      return map.ios ?? map.default;
    // Android
    case "android":
      return map.android ?? map.default;
    // それ以外（windows / macos / web / native 等）は default
    default:
      return map.default;
  }
}
