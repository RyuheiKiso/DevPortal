// React の createContext を取り込み
import { createContext } from "react";
// HTTP クライアント型を core から取り込み（peerDep でないため通常 dep）
import type { HttpClient } from "@k1s0-ts-http/core";

// HttpClient を流す Context（Provider 外では null）
export const HttpClientContext = createContext<HttpClient | null>(null);
