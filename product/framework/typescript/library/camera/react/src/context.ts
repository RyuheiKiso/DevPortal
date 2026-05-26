// React の createContext を取り込み
import { createContext } from "react";
// core から CameraManager 型を取り込み
import type { CameraManager } from "@k1s0-ts-camera/core";

// Camera Context の値は CameraManager もしくは null（Provider 不在を表す）
export const CameraContext = createContext<CameraManager | null>(null);
