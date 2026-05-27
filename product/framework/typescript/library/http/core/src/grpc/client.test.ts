// vitest DSL を取り込み
import { afterEach, describe, expect, it, vi } from "vitest";
// テスト対象
import { createGrpcClient } from "./client.js";
import { createBearerAuth } from "../auth.js";
import { HttpError } from "../errors.js";
import { REQUEST_ID_HEADER } from "../requestId.js";
// 型
import type {
  GrpcCallError,
  GrpcMethodDescriptor,
  GrpcWebLikeClient,
} from "./types.js";

// テスト用 descriptor（serialize/deserialize は本テストで使わない）
const desc: GrpcMethodDescriptor<string, string> = {
  service: "pkg.S",
  method: "M",
  requestSerialize: (s) => new TextEncoder().encode(s),
  responseDeserialize: (b) => new TextDecoder().decode(b),
};

// rpcCall を差し替え可能なスタブクライアントファクトリ
function stubFactory(
  impl: (
    url: string,
    md: Record<string, string>,
    cb: (err: GrpcCallError | null, res: string) => void,
  ) => void,
): (baseUrl: string) => GrpcWebLikeClient {
  return () => ({
    rpcCall: (url, _req, md, _desc, cb) => {
      impl(url as string, md as Record<string, string>, cb as never);
      return undefined;
    },
  });
}

describe("createGrpcClient", () => {
  // 各テスト後に dynamic import モックをリセット
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("grpc-web");
    vi.useRealTimers();
  });

  // 成功パス
  it("factory 注入で unary 成功", async () => {
    let seenUrl = "";
    let seenMd: Record<string, string> = {};
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      generateRequestId: () => "rid-1",
      grpcClientFactory: stubFactory((url, md, cb) => {
        seenUrl = url;
        seenMd = md;
        cb(null, "hello");
      }),
    });
    const out = await client.unary(desc, "in");
    expect(out).toBe("hello");
    expect(seenUrl).toBe("https://grpc/pkg.S/M");
    expect(seenMd[REQUEST_ID_HEADER]).toBe("rid-1");
  });

  // 追加 (B): baseUrl 空文字 / URL 不正は createGrpcClient 自体で throw
  it("createGrpcClient: 空 baseUrl は ZodError で throw", async () => {
    await expect(
      createGrpcClient({
        baseUrl: "",
        grpcClientFactory: () => ({ rpcCall: () => undefined }),
      }),
    ).rejects.toThrow();
  });

  // 追加 (B): service / method を URL エンコード
  it("URL は service / method を encodeURIComponent でサニタイズ", async () => {
    let seenUrl = "";
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      grpcClientFactory: stubFactory((url, _md, cb) => {
        seenUrl = url;
        cb(null, "ok");
      }),
    });
    const specialDesc: GrpcMethodDescriptor<string, string> = {
      ...desc,
      service: "pkg.S A",
      method: "M B",
    };
    await client.unary(specialDesc, "in");
    expect(seenUrl).toBe("https://grpc/pkg.S%20A/M%20B");
  });

  // T-A6 追加 (B): service 名の '.' は encode されない（一般的な package.Service 形式の保証）
  it("通常 URL は '.' を encode しない（package.Service 形式の保証）", async () => {
    let seenUrl = "";
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      grpcClientFactory: stubFactory((url, _md, cb) => {
        seenUrl = url;
        cb(null, "ok");
      }),
    });
    await client.unary({ ...desc, service: "my.pkg.Service", method: "Echo" }, "in");
    expect(seenUrl).toBe("https://grpc/my.pkg.Service/Echo");
  });

  // T-A6 追加 (B): service 名の '/' は encode される（誤入力防御）
  it("'/' を含む service 名は encode される（path 区切り防御）", async () => {
    let seenUrl = "";
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      grpcClientFactory: stubFactory((url, _md, cb) => {
        seenUrl = url;
        cb(null, "ok");
      }),
    });
    await client.unary({ ...desc, service: "pkg/sub", method: "M" }, "in");
    expect(seenUrl).toBe("https://grpc/pkg%2Fsub/M");
  });

  // C-A10: auth.getAuthHeaders が関数でない場合 INVALID_CONFIG で throw
  it("C-A10: auth.getAuthHeaders が関数でなければ INVALID_CONFIG で throw", async () => {
    await expect(
      createGrpcClient({
        baseUrl: "https://grpc",
        // 型を意図的に破壊
        auth: { getAuthHeaders: "not a function" as unknown as () => Promise<Record<string, string>> },
        grpcClientFactory: () => ({ rpcCall: () => undefined }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });

  // C-A10: grpcClientFactory が関数でない場合 INVALID_CONFIG で throw
  it("C-A10: grpcClientFactory が関数でなければ INVALID_CONFIG で throw", async () => {
    await expect(
      createGrpcClient({
        baseUrl: "https://grpc",
        grpcClientFactory: "not a function" as unknown as (baseUrl: string) => GrpcWebLikeClient,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });

  // auth と user metadata がマージされる
  it("auth と user metadata と X-Request-Id がマージ", async () => {
    let seenMd: Record<string, string> = {};
    const client = await createGrpcClient({
      baseUrl: "https://grpc/",
      auth: createBearerAuth(() => "tok"),
      generateRequestId: () => "rid",
      grpcClientFactory: stubFactory((_url, md, cb) => {
        seenMd = md;
        cb(null, "ok");
      }),
    });
    await client.unary(desc, "in", { metadata: { "X-User": "u1" } });
    expect(seenMd["Authorization"]).toBe("Bearer tok");
    expect(seenMd["X-User"]).toBe("u1");
    expect(seenMd[REQUEST_ID_HEADER]).toBe("rid");
  });

  // gRPC エラーは正規化される
  // H2: 冪等性ガード適用後は明示的に opts.idempotent: true を渡さないと retry されない
  it("UNAVAILABLE エラーはリトライ後に最終 throw (idempotent: true)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      retry: { maxRetries: 1, backoffBaseMs: 1, jitter: "none" },
      grpcClientFactory: stubFactory((_url, _md, cb) => {
        calls++;
        cb({ code: 14, message: "down" }, undefined as never);
      }),
    });
    // 冪等オプトイン
    const p = client.unary(desc, "in", { idempotent: true }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    const err = (await p) as { code: string };
    expect(err.code).toBe("UNAVAILABLE");
    // 1 + 1 = 2 回呼ばれている
    expect(calls).toBe(2);
  });

  // 非リトライエラーは即 throw
  it("PERMISSION_DENIED は即 throw（リトライしない）", async () => {
    let calls = 0;
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      retry: { maxRetries: 3, backoffBaseMs: 1, jitter: "none" },
      grpcClientFactory: stubFactory((_url, _md, cb) => {
        calls++;
        cb({ code: 7, message: "no" }, undefined as never);
      }),
    });
    await expect(client.unary(desc, "in")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(calls).toBe(1);
  });

  // perAttempt timeout
  it("timeoutMs (opts) が per-attempt として効く", async () => {
    vi.useFakeTimers();
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      retry: { maxRetries: 0 },
      grpcClientFactory: stubFactory(() => {
        // 一度も callback を呼ばずに待たせる
      }),
    });
    const p = client.unary(desc, "in", { timeoutMs: 50 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60);
    const err = (await p) as { code: string };
    expect(err.code).toBe("TIMEOUT");
  });

  // dynamic import 成功パス（grpc-web をモック）
  it("factory 未指定なら grpc-web を dynamic import", async () => {
    // grpc-web を vi.doMock
    vi.doMock("grpc-web", () => {
      class FakeBase {
        rpcCall(
          _url: string,
          _req: unknown,
          _md: Record<string, string>,
          _desc: unknown,
          cb: (err: GrpcCallError | null, res: string) => void,
        ): unknown {
          cb(null, "mocked");
          return undefined;
        }
      }
      return { GrpcWebClientBase: FakeBase };
    });
    // モック後にモジュールを再 import するため動的 import
    const mod = await import("./client.js");
    const client = await mod.createGrpcClient({ baseUrl: "https://grpc" });
    const out = await client.unary(desc, "in");
    expect(out).toBe("mocked");
  });

  // dynamic import 失敗パス（grpc-web を throw する mock に差し替え）
  // A13: lazy 化により createGrpcClient 自体は成功し、unary 呼び出し時に GRPC_PEER_MISSING を投げる
  it("grpc-web 未インストールなら unary 呼び出し時に GRPC_PEER_MISSING を throw", async () => {
    vi.doMock("grpc-web", () => {
      throw new Error("Cannot find module 'grpc-web'");
    });
    const mod = await import("./client.js");
    // createGrpcClient は副作用なし（peerDep に触らない）
    const client = await mod.createGrpcClient({
      baseUrl: "https://grpc",
      retry: { maxRetries: 0 },
    });
    expect(typeof client.unary).toBe("function");
    // unary 呼び出し時に解決して失敗
    await expect(client.unary(desc, "in")).rejects.toMatchObject({
      code: "GRPC_PEER_MISSING",
    });
  });

  // 並行 unary 呼び出しで underlying クライアントが二重作成されないこと (singleflight)
  // (resolveUnderlying の in-flight Promise 共有経路を網羅する)
  it("並行 unary で grpcClientFactory が 1 度しか呼ばれない (singleflight)", async () => {
    // factory 呼び出し回数を計測
    let factoryCalls = 0;
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      // factory はマイクロタスクを跨ぐ非同期処理を模した遅延を含める
      grpcClientFactory: () => {
        factoryCalls += 1;
        // すぐに rpcCall を返す軽量実装
        return {
          rpcCall: (_url, _req, _md, _desc, cb) => {
            // 成功で即 callback
            (cb as (err: null, res: string) => void)(null, "ok");
            return undefined;
          },
        };
      },
    });
    // 5 並列 unary 呼び出し → resolveUnderlying は 5 回呼ばれるが factory は 1 度だけ起動するはず
    const results = await Promise.all(
      Array.from({ length: 5 }, () => client.unary(desc, "in")),
    );
    // 全結果が同じレスポンス
    expect(results).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    // factory は singleflight により 1 回のみ呼ばれる
    expect(factoryCalls).toBe(1);
  });

  // attempt 毎に auth.getAuthHeaders が再評価され、token refresh が反映されること
  // (旧実装は withRetry 外で metadata を固定していたため、retry 中の token 更新が無視された)
  it("attempt 毎に auth.getAuthHeaders が再評価される (token refresh 反映)", async () => {
    // attempt 毎に異なるトークンを返す auth (初回 "old"、2 回目以降 "new")
    let getAuthCalls = 0;
    const auth = {
      async getAuthHeaders(): Promise<Record<string, string>> {
        getAuthCalls += 1;
        return { Authorization: getAuthCalls === 1 ? "Bearer old" : "Bearer new" };
      },
    };
    // rpcCall は attempt 毎に異なる metadata を観測したいので、各呼出の metadata を記録
    const observedAuth: string[] = [];
    let rpcCalls = 0;
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      auth,
      // 1 回目は失敗、2 回目は成功するようにする
      retry: { maxRetries: 3, backoffBaseMs: 1, backoffMaxMs: 1, jitter: "none" },
      grpcClientFactory: () => ({
        rpcCall: (_url, _req, md, _desc, cb) => {
          rpcCalls += 1;
          observedAuth.push((md as Record<string, string>)["Authorization"] ?? "");
          if (rpcCalls === 1) {
            // 初回は 5xx 相当の retryable エラー
            (cb as (err: { code: number; message: string } | null, res: string) => void)(
              { code: 14, message: "unavailable" },
              "",
            );
          } else {
            // 2 回目以降は成功
            (cb as (err: null, res: string) => void)(null, "ok");
          }
          return undefined;
        },
      }),
    });
    // H2: retry を期待するテストなので冪等オプトインを明示する
    const out = await client.unary(desc, "in", { idempotent: true });
    expect(out).toBe("ok");
    // 1 回目 attempt は "old"、2 回目 attempt は "new" が観測される (= attempt 毎に再評価された証)
    expect(observedAuth[0]).toBe("Bearer old");
    expect(observedAuth[1]).toBe("Bearer new");
    // auth.getAuthHeaders も 2 回呼ばれている
    expect(getAuthCalls).toBe(2);
  });

  // ----- H2: 冪等性ガード関連の新規テスト -----

  // H2: opts.idempotent 未指定なら UNAVAILABLE でも 1 試行のみ (副作用 RPC 暴走防止)
  it("H2: idempotent 未指定なら UNAVAILABLE でも retry されない (1 試行)", async () => {
    let calls = 0;
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      retry: { maxRetries: 3, backoffBaseMs: 1, jitter: "none" },
      grpcClientFactory: stubFactory((_url, _md, cb) => {
        calls++;
        cb({ code: 14, message: "down" }, undefined as never);
      }),
    });
    // idempotent を指定しない (デフォルトは非冪等扱い)
    await expect(client.unary(desc, "in")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(calls).toBe(1);
  });

  // H2: opts.idempotent: true を渡すと通常 retry される
  it("H2: opts.idempotent: true で UNAVAILABLE は retry される", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      retry: { maxRetries: 2, backoffBaseMs: 1, jitter: "none" },
      grpcClientFactory: stubFactory((_url, _md, cb) => {
        calls++;
        if (calls < 3) {
          cb({ code: 14, message: "down" }, undefined as never);
          return;
        }
        cb(null, "ok");
      }),
    });
    const p = client.unary(desc, "in", { idempotent: true });
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toBe("ok");
    expect(calls).toBe(3);
  });

  // H2: GrpcClientConfig.retry.allowNonIdempotent: true なら opts 未指定でも retry される
  it("H2: config.retry.allowNonIdempotent: true なら opts 未指定でも retry される", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      retry: {
        maxRetries: 2,
        backoffBaseMs: 1,
        jitter: "none",
        allowNonIdempotent: true,
      },
      grpcClientFactory: stubFactory((_url, _md, cb) => {
        calls++;
        if (calls < 2) {
          cb({ code: 14, message: "down" }, undefined as never);
          return;
        }
        cb(null, "ok");
      }),
    });
    const p = client.unary(desc, "in");
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  // H2: idempotent 未指定時は logger.debug("grpc.retry.disabled") が出る
  it("H2: 非冪等で retry 無効化されたとき grpc.retry.disabled が debug log に出る", async () => {
    const debugCalls: Array<[string, unknown]> = [];
    const logger = {
      debug: (m: string, c?: unknown) => debugCalls.push([m, c]),
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      logger,
      retry: { maxRetries: 3, backoffBaseMs: 1, jitter: "none" },
      grpcClientFactory: stubFactory((_url, _md, cb) => {
        cb({ code: 14, message: "down" }, undefined as never);
      }),
    });
    await expect(client.unary(desc, "in")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    // grpc.retry.disabled が記録されている
    const disabled = debugCalls.find(([m]) => m === "grpc.retry.disabled");
    expect(disabled).toBeDefined();
    expect(disabled?.[1]).toMatchObject({ reason: "non-idempotent" });
  });

  // M2: GrpcClientConfig.retry に retryableStatuses を渡すと ZodError
  it("M2: retry.retryableStatuses を渡すと ZodError で createGrpcClient が失敗", async () => {
    await expect(
      createGrpcClient({
        baseUrl: "https://grpc",
        // 型では弾けるが JS 利用や外部設定経由のミスを早期検出するため runtime でも弾く
        retry: { retryableStatuses: [500] } as unknown as { maxRetries: number },
        grpcClientFactory: () => ({ rpcCall: () => undefined }),
      }),
    ).rejects.toThrow();
  });

  // M7: gRPC 側でも auth エラーが AUTH_FAILED にラップされる
  it("M7: gRPC の auth が throw すると AUTH_FAILED にラップされる", async () => {
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      auth: {
        async getAuthHeaders() {
          throw new Error("token endpoint down");
        },
      },
      grpcClientFactory: () => ({ rpcCall: () => undefined }),
    });
    await expect(client.unary(desc, "in")).rejects.toMatchObject({
      code: "AUTH_FAILED",
      retryable: false,
    });
  });

  // M7: gRPC の auth が HttpError を直接 throw した場合は素通し
  it("M7: gRPC の auth が HttpError を throw した場合は素通し", async () => {
    const explicit = new HttpError({
      message: "custom gRPC auth error",
      code: "CUSTOM_AUTH",
      retryable: false,
    });
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      auth: {
        async getAuthHeaders() {
          throw explicit;
        },
      },
      grpcClientFactory: () => ({ rpcCall: () => undefined }),
    });
    await expect(client.unary(desc, "in")).rejects.toMatchObject({
      code: "CUSTOM_AUTH",
    });
  });

  // M7: gRPC の auth が非 Error をプリミティブ throw した場合は固定メッセージで AUTH_FAILED
  it("M7: gRPC の auth が非 Error を throw した場合は AUTH_FAILED にラップ", async () => {
    const client = await createGrpcClient({
      baseUrl: "https://grpc",
      auth: {
        async getAuthHeaders(): Promise<Record<string, string>> {
          // プリミティブを throw する pathological ケース
          throw "raw-token-fail";
        },
      },
      grpcClientFactory: () => ({ rpcCall: () => undefined }),
    });
    await expect(client.unary(desc, "in")).rejects.toMatchObject({
      code: "AUTH_FAILED",
      retryable: false,
      message: "auth failed: raw-token-fail",
    });
  });
});
