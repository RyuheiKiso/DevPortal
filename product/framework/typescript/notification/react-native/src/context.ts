// React の createContext を取り込み
import { createContext } from "react";
// core から Manager 型を取り込み
import type { NotificationManager } from "@k1s0-ts-notification/core";

// Manager を流すための React Context（Provider 外では null）
export const NotificationContext = createContext<NotificationManager | null>(null);
