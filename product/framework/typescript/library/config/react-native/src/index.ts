// Provider と props 型を公開
export { ConfigProvider } from "./ConfigProvider.js";
export type { ConfigProviderProps } from "./ConfigProvider.js";

// hooks を公開
export { useConfig, useFeatureFlag, useTheme } from "./hooks.js";

// Context 本体（テスト用途や上級利用向け）
export { ConfigContext } from "./context.js";

// RN 固有の Platform 別マージ機能
export { mergePlatformConfig } from "./platform.js";
export type { PlatformConfigMap } from "./platform.js";
