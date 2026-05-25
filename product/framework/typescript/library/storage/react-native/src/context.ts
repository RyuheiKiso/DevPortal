// React の createContext を取り込み
import { createContext } from "react";
// core から StorageRegistry 型を取り込み
import type { StorageRegistry } from "@k1s0-ts-storage/core";

// StorageRegistry を流すための React Context (Provider 外では null)
export const StorageContext = createContext<StorageRegistry | null>(null);
