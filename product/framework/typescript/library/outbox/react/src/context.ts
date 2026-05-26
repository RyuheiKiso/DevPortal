// React の createContext を取り込み
import { createContext } from "react";
// core から Manager 型を取り込み
import type { OutboxManager } from "@k1s0-ts-outbox/core";

// Manager を流すための React Context (Provider 外では null)
// 型は unknown ペイロード固定 (利用側で hook の総称型から実型を付与する)
export const OutboxContext = createContext<OutboxManager<unknown> | null>(null);
