// React の createContext を取り込み
import { createContext } from "react";
// core から Manager 型を取り込み
import type { OutboxManager } from "@k1s0-ts-outbox/core";

// Manager を流すための React Context (Provider 外では null)
export const OutboxContext = createContext<OutboxManager<unknown> | null>(null);
