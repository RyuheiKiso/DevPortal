// React の createContext を取り込み
import { createContext } from "react";
// core から Logger 型を取り込み
import type { Logger } from "@k1s0-ts-logger/core";

// Logger を流すための Context（Provider 外では null）
export const LoggerContext = createContext<Logger | null>(null);
