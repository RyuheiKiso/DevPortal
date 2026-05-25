// React の createContext を取り込み
import { createContext } from "react";
// 基底コンフィグ型を core から取り込み
import type { BaseConfig } from "@k1s0-ts-config/core";

// RN アプリ全体に設定値を伝搬させる Context
// 初期値は null（Provider 配下でない hook 呼び出しを検知するため）
export const ConfigContext = createContext<BaseConfig | null>(null);
