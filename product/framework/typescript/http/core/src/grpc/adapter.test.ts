// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { invokeUnary } from "./adapter.js";
// 型
import type {
  GrpcCallError,
  GrpcMethodDescriptor,
  GrpcWebLikeClient,
} from "./types.js";

// テスト用 method descriptor（serialize/deserialize は使われないので最小）
const desc: GrpcMethodDescriptor<string, string> = {
  service: "pkg.S",
  method: "M",
  requestSerialize: (s) => new TextEncoder().encode(s),
  responseDeserialize: (b) => new TextDecoder().decode(b),
};

// ファクトリ：rpcCall の挙動をテストごとに差し替える
function makeClient(
  impl: (cb: (err: GrpcCallError | null, res: string) => void) => void,
): GrpcWebLikeClient {
  return {
    rpcCall: (_url, _req, _md, _desc, cb) => {
      impl(cb as (err: GrpcCallError | null, res: string) => void);
      return undefined;
    },
  };
}

describe("invokeUnary", () => {
  // 成功時
  it("rpcCall 成功で response を返す", async () => {
    const c = makeClient((cb) => cb(null, "ok"));
    const out = await invokeUnary(c, "/u", "in", {}, desc, undefined, "rid");
    expect(out).toBe("ok");
  });
  // gRPC エラー
  it("rpcCall エラーは grpcStatusToHttpError で正規化", async () => {
    const c = makeClient((cb) => cb({ code: 14, message: "unav" }, undefined as never));
    await expect(
      invokeUnary(c, "/u", "in", {}, desc, undefined, "rid"),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", requestId: "rid" });
  });
  // code:0 はエラーオブジェクトでも成功扱い
  it("code:0 は成功扱い", async () => {
    const c = makeClient((cb) => cb({ code: 0, message: "" }, "ok2"));
    const out = await invokeUnary(c, "/u", "in", {}, desc, undefined, "rid");
    expect(out).toBe("ok2");
  });
  // 既に abort 済みの signal
  it("既に abort 済みの signal なら即時 ABORTED", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const c = makeClient(() => undefined); // 呼ばれない
    await expect(
      invokeUnary(c, "/u", "in", {}, desc, ctrl.signal, "rid"),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });
  // 進行中に abort
  it("rpcCall 進行中の abort で reject", async () => {
    const ctrl = new AbortController();
    // 後から callback を呼ぶ実装（cb を一度も呼ばない）
    const c = makeClient(() => {
      /* nothing: 永遠に待つ */
    });
    const p = invokeUnary(c, "/u", "in", {}, desc, ctrl.signal, "rid");
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: "ABORTED" });
  });
  // abort 後に rpcCall が遅れて成功して来た場合は無視（二重解決防止）
  it("abort 後の遅延 callback は無視（二重解決しない）", async () => {
    const ctrl = new AbortController();
    let cbRef: ((err: GrpcCallError | null, res: string) => void) | null = null;
    const c = makeClient((cb) => {
      cbRef = cb;
    });
    const p = invokeUnary(c, "/u", "in", {}, desc, ctrl.signal, "rid");
    ctrl.abort();
    // 後から成功 callback を発火
    cbRef!(null, "late");
    await expect(p).rejects.toMatchObject({ code: "ABORTED" });
  });
  // 成功後に再度 callback が呼ばれても無視（rpcCall の異常な二重発火対策）
  it("成功 callback の二回目は無視", async () => {
    let cbRef: ((err: GrpcCallError | null, res: string) => void) | null = null;
    const c = makeClient((cb) => {
      cbRef = cb;
    });
    const p = invokeUnary(c, "/u", "in", {}, desc, undefined, "rid");
    cbRef!(null, "first");
    cbRef!(null, "second"); // 無視されるはず
    await expect(p).resolves.toBe("first");
  });
});
