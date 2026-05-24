// Platform 別の fetch 実装マップ（default は必須）
export interface PlatformFetchMap {
  // すべての Platform に対するデフォルト fetch
  default: typeof fetch;
  // iOS 専用 fetch（任意、未指定なら default）
  ios?: typeof fetch;
  // Android 専用 fetch（任意、未指定なら default）
  android?: typeof fetch;
}

declare const require:
  | ((id: string) => unknown)
  | undefined;

function getPlatformOS(): string {
  if (typeof require !== "function") {
    return "default";
  }
  const mod = require("react-native") as {
    Platform?: { OS?: string };
  };
  return mod.Platform?.OS ?? "default";
}

// Platform.OS に応じた fetch を返す（指定がなければ default にフォールバック）
export function resolvePlatformFetch(map: PlatformFetchMap): typeof fetch {
  // OS 判定（logger/react-native と同じ手法）
  switch (getPlatformOS()) {
    case "ios":
      return map.ios ?? map.default;
    case "android":
      return map.android ?? map.default;
    default:
      return map.default;
  }
}
