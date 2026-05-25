// grpc サブモジュールの公開エントリ（re-export のみ）
export type {
  GrpcCallError,
  GrpcCallOptions,
  GrpcClient,
  GrpcClientConfig,
  GrpcMetadata,
  GrpcMethodDescriptor,
  GrpcWebLikeClient,
} from "./types.js";
export {
  GRPC_STATUS_NAMES,
  RETRYABLE_GRPC_CODES,
  grpcStatusToHttpError,
} from "./errors.js";
export { invokeUnary } from "./adapter.js";
export { createGrpcClient } from "./client.js";
