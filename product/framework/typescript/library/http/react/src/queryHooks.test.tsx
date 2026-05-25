import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import * as React from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import type {
  HttpClient,
  HttpRequest,
  HttpRequestInit,
  HttpResponse,
} from "@k1s0-ts-http/core";
import { HttpError } from "@k1s0-ts-http/core";
import { HttpClientProvider, useHttpMutation, useHttpQuery } from "./index.js";

function response<T>(body: T, requestId: string, init: HttpRequestInit): HttpResponse<T> {
  const request: HttpRequest = {
    url: init.url,
    method: init.method ?? "GET",
    headers: init.headers ?? {},
    body: init.body,
    signal: init.signal,
    requestId,
  };
  return {
    status: 200,
    ok: true,
    headers: {},
    rawHeaders: new Headers(),
    body,
    raw: new Response(),
    request,
  };
}

function rawJsonResponse<T>(body: T, requestId: string, init: HttpRequestInit): HttpResponse<T> {
  const request: HttpRequest = {
    url: init.url,
    method: init.method ?? "GET",
    headers: init.headers ?? {},
    body: init.body,
    signal: init.signal,
    requestId,
  };
  return {
    status: 200,
    ok: true,
    headers: { "content-type": "application/json" },
    rawHeaders: new Headers({ "content-type": "application/json" }),
    body: undefined,
    raw: Response.json(body),
    request,
  };
}

function rawTextResponse(requestId: string, init: HttpRequestInit): HttpResponse<string> {
  const request: HttpRequest = {
    url: init.url,
    method: init.method ?? "GET",
    headers: init.headers ?? {},
    body: init.body,
    signal: init.signal,
    requestId,
  };
  return {
    status: 200,
    ok: true,
    headers: { "content-type": "text/plain" },
    rawHeaders: new Headers({ "content-type": "text/plain" }),
    body: undefined,
    raw: new Response("plain text", {
      headers: { "content-type": "text/plain" },
    }),
    request,
  };
}

function invalidJsonResponse<T>(requestId: string, init: HttpRequestInit): HttpResponse<T> {
  const request: HttpRequest = {
    url: init.url,
    method: init.method ?? "GET",
    headers: init.headers ?? {},
    body: init.body,
    signal: init.signal,
    requestId,
  };
  return {
    status: 200,
    ok: true,
    headers: { "content-type": "application/json" },
    rawHeaders: new Headers({ "content-type": "application/json" }),
    body: undefined,
    raw: new Response("{", {
      headers: { "content-type": "application/json" },
    }),
    request,
  };
}

function clientOf(
  request: (init: HttpRequestInit) => Promise<HttpResponse<unknown>>,
): HttpClient {
  return {
    request: vi.fn(request) as HttpClient["request"],
    withConfig: vi.fn(),
    config: {},
  };
}

describe("useHttpQuery", () => {
  it("loads parsed JSON data and exposes requestId", async () => {
    const client = clientOf(async (init) =>
      rawJsonResponse({ ok: true }, "query-1", init),
    );
    let state: ReturnType<typeof useHttpQuery<{ ok: boolean }>> | undefined;
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state?.loading).toBe(false);
    expect(state?.data).toEqual({ ok: true });
    expect(state?.requestId).toBe("query-1");
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/users" }),
    );

    await act(async () => {
      renderer?.unmount();
    });

    function Probe(): null {
      state = useHttpQuery<{ ok: boolean }>({ url: "/users" });
      return null;
    }
  });

  it("does not fetch while disabled", async () => {
    const client = clientOf(async (init) =>
      response({ ok: true }, "query-disabled", init),
    );
    let state: ReturnType<typeof useHttpQuery<{ ok: boolean }>> | undefined;
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
    });

    expect(state?.loading).toBe(false);
    expect(state?.data).toBeUndefined();
    expect(client.request).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });

    function Probe(): null {
      state = useHttpQuery<{ ok: boolean }>({ url: "/users" }, { enabled: false });
      return null;
    }
  });

  it("preserves requestId when JSON parsing fails", async () => {
    const client = clientOf(async (init) => invalidJsonResponse("query-bad-json", init));
    let state: ReturnType<typeof useHttpQuery<{ ok: boolean }>> | undefined;
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state?.loading).toBe(false);
    expect(state?.error).toBeInstanceOf(HttpError);
    expect(state?.error?.code).toBe("PARSE_ERROR");
    expect(state?.error?.requestId).toBe("query-bad-json");
    expect(state?.requestId).toBe("query-bad-json");

    await act(async () => {
      renderer?.unmount();
    });

    function Probe(): null {
      state = useHttpQuery<{ ok: boolean }>({ url: "/users" });
      return null;
    }
  });

  // refetch / deps / enabled toggle / abort race を網羅する
  it("refetch を呼ぶと再 fetch される", async () => {
    // 呼び出し回数で異なる body を返す client
    let call = 0;
    const client = clientOf(async (init) => {
      call += 1;
      return rawJsonResponse({ n: call }, `q-${call}`, init);
    });
    // state
    let state: ReturnType<typeof useHttpQuery<{ n: number }>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<{ n: number }>({ url: "/u" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      // 1 回目の取得を待つ
      await Promise.resolve();
      await Promise.resolve();
    });
    // 1 回目の data
    expect(state?.data).toEqual({ n: 1 });
    // refetch を呼ぶ
    await act(async () => {
      // 戻り値を await
      await state?.refetch();
      await Promise.resolve();
    });
    // 2 回目の data
    expect(state?.data).toEqual({ n: 2 });
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // deps が変化したら再 fetch
  it("deps が変化すると再 fetch する", async () => {
    // 呼び出し回数を計数
    let call = 0;
    const client = clientOf(async (init) => {
      call += 1;
      return rawJsonResponse({ n: call }, `q-deps-${call}`, init);
    });
    // 切替可能 deps
    let depsValue = 1;
    // state
    let state: ReturnType<typeof useHttpQuery<{ n: number }>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<{ n: number }>({ url: "/u" }, { deps: [depsValue] });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      // 1 回目の取得
      await Promise.resolve();
      await Promise.resolve();
    });
    // 1 回目の data
    expect(state?.data).toEqual({ n: 1 });
    // deps を変更
    depsValue = 2;
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      // 2 回目の取得
      await Promise.resolve();
      await Promise.resolve();
    });
    // 2 回目の data
    expect(state?.data).toEqual({ n: 2 });
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // enabled: false → true で fetch が走る
  it("enabled が false→true へ遷移すると fetch する", async () => {
    // 客体 client
    const client = clientOf(async (init) =>
      rawJsonResponse({ ok: true }, "q-enable", init),
    );
    // 切替可能 enabled
    let enabled = false;
    // state
    let state: ReturnType<typeof useHttpQuery<{ ok: boolean }>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<{ ok: boolean }>({ url: "/u" }, { enabled });
      return null;
    }
    // 初回描画（enabled=false）
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
    });
    // まだ fetch されていない
    expect(client.request).not.toHaveBeenCalled();
    // enabled を true へ
    enabled = true;
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      // 取得
      await Promise.resolve();
      await Promise.resolve();
    });
    // データが入ること
    expect(state?.data).toEqual({ ok: true });
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // 失敗時に state.error にネットワーク系 HttpError がセットされること（toHttpError の Error 派生分岐）
  it("request が Error を throw すると HttpError でラップして state.error に入る", async () => {
    // 常に reject する client
    const client = clientOf(async () => {
      // ネットワーク失敗想定の Error
      throw new Error("network");
    });
    // state
    let state: ReturnType<typeof useHttpQuery<unknown>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<unknown>({ url: "/u" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // error が HttpError
    expect(state?.error).toBeInstanceOf(HttpError);
    // メッセージが引き継がれていること
    expect(state?.error?.message).toBe("network");
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // HttpError をそのまま投げると HttpError のままラップせず利用する分岐
  it("request が HttpError を throw すると state.error にそのまま入る", async () => {
    // HttpError を直接 throw する client
    const httpError = new HttpError({
      message: "boom",
      code: "UNKNOWN",
      retryable: false,
    });
    const client = clientOf(async () => {
      throw httpError;
    });
    // state
    let state: ReturnType<typeof useHttpQuery<unknown>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<unknown>({ url: "/u" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // error 参照が同一
    expect(state?.error).toBe(httpError);
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // ABORTED コードのエラーは state を更新せず黙殺する
  it("HttpError code=ABORTED は state.error に入らない", async () => {
    // ABORTED を投げる client
    const client = clientOf(async () => {
      throw new HttpError({ message: "aborted", code: "ABORTED", retryable: false });
    });
    // state
    let state: ReturnType<typeof useHttpQuery<unknown>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<unknown>({ url: "/u" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // error は undefined のまま
    expect(state?.error).toBeUndefined();
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // parseAs=text の明示指定
  it("parseAs: 'text' で text/plain を読む", async () => {
    // client
    const client = clientOf(async (init) => rawTextResponse("q-text", init));
    // state
    let state: ReturnType<typeof useHttpQuery<string>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<string>({ url: "/t" }, { parseAs: "text" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // text を取得
    expect(state?.data).toBe("plain text");
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // parseAs=text で空文字のときは undefined を返す
  it("parseAs: 'text' で空ボディなら data は undefined", async () => {
    // empty body の Response を返す client
    const client = clientOf(async (init) => {
      // 必要最低限のレスポンス（生 Response は空 text）
      const request: HttpRequest = {
        url: init.url,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
        signal: init.signal,
        requestId: "q-text-empty",
      };
      // body 未設定 + raw は空テキスト
      return {
        status: 200,
        ok: true,
        headers: { "content-type": "text/plain" },
        rawHeaders: new Headers({ "content-type": "text/plain" }),
        body: undefined,
        raw: new Response("", { headers: { "content-type": "text/plain" } }),
        request,
      } as HttpResponse<string>;
    });
    // state
    let state: ReturnType<typeof useHttpQuery<string>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<string>({ url: "/t" }, { parseAs: "text" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // 空文字は undefined に変換される
    expect(state?.data).toBeUndefined();
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // parseAs=blob
  it("parseAs: 'blob' で blob を返す", async () => {
    // raw に blob を載せる client
    const client = clientOf(async (init) => {
      const request: HttpRequest = {
        url: init.url,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
        signal: init.signal,
        requestId: "q-blob",
      };
      return {
        status: 200,
        ok: true,
        headers: { "content-type": "application/octet-stream" },
        rawHeaders: new Headers({ "content-type": "application/octet-stream" }),
        body: undefined,
        raw: new Response(new Uint8Array([1, 2, 3])),
        request,
      } as HttpResponse<Blob>;
    });
    // state
    let state: ReturnType<typeof useHttpQuery<Blob>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<Blob>({ url: "/b" }, { parseAs: "blob" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // Blob が返ること
    expect(state?.data).toBeInstanceOf(Blob);
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // parseAs=arrayBuffer
  it("parseAs: 'arrayBuffer' で ArrayBuffer を返す", async () => {
    // raw に bytes を載せる client
    const client = clientOf(async (init) => {
      const request: HttpRequest = {
        url: init.url,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
        signal: init.signal,
        requestId: "q-ab",
      };
      return {
        status: 200,
        ok: true,
        headers: { "content-type": "application/octet-stream" },
        rawHeaders: new Headers({ "content-type": "application/octet-stream" }),
        body: undefined,
        raw: new Response(new Uint8Array([7, 8, 9])),
        request,
      } as HttpResponse<ArrayBuffer>;
    });
    // state
    let state: ReturnType<typeof useHttpQuery<ArrayBuffer>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<ArrayBuffer>({ url: "/ab" }, { parseAs: "arrayBuffer" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // ArrayBuffer が返ること
    expect(state?.data).toBeInstanceOf(ArrayBuffer);
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // parseAs=stream
  it("parseAs: 'stream' で raw.body を返す", async () => {
    // raw に bytes を載せる client
    const client = clientOf(async (init) => {
      const request: HttpRequest = {
        url: init.url,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
        signal: init.signal,
        requestId: "q-stream",
      };
      return {
        status: 200,
        ok: true,
        headers: { "content-type": "application/octet-stream" },
        rawHeaders: new Headers({ "content-type": "application/octet-stream" }),
        body: undefined,
        raw: new Response("abc"),
        request,
      } as HttpResponse<ReadableStream | null>;
    });
    // state
    let state: ReturnType<typeof useHttpQuery<ReadableStream | null>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<ReadableStream | null>({ url: "/s" }, { parseAs: "stream" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // ReadableStream 系の値が入ること（null も許容）
    expect(state?.data === null || state?.data instanceof ReadableStream).toBe(true);
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // parseAs=json を明示指定
  it("parseAs: 'json' で JSON を読む", async () => {
    // client
    const client = clientOf(async (init) =>
      rawJsonResponse({ x: 1 }, "q-json-explicit", init),
    );
    // state
    let state: ReturnType<typeof useHttpQuery<{ x: number }>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<{ x: number }>({ url: "/j" }, { parseAs: "json" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // 取得結果
    expect(state?.data).toEqual({ x: 1 });
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // response.body が既に解決済みのときは raw を読まずそのまま返す（resolveResponseBody の short-circuit）
  it("response.body が既に解決済みなら raw を読まずに返す", async () => {
    // body 解決済みのレスポンスを返す client
    const client = clientOf(async (init) =>
      response({ pre: true }, "q-pre", init),
    );
    // state
    let state: ReturnType<typeof useHttpQuery<{ pre: boolean }>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<{ pre: boolean }>({ url: "/p" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // body そのまま取得
    expect(state?.data).toEqual({ pre: true });
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // 進行中 request の完了前に unmount すると、後で resolve された then は signal.aborted で早期 return（line 164 分岐）
  it("request 完了前に unmount すると then 内で signal.aborted を見て setState を skip", async () => {
    // 後から手動で resolve する request promise を保持（引数なしで呼べる closure 化）
    let resolveReq: (() => void) | undefined;
    // client
    const client = clientOf(
      (init) =>
        new Promise<HttpResponse<unknown>>((resolve) => {
          // 後から呼ぶための保存（init は body 解決済みのレスポンス生成に使う）
          resolveReq = () =>
            resolve(response({ late: true }, "q-late-164", init) as HttpResponse<unknown>);
        }),
    );
    // state（最終的に未更新であることを確認するために保持）
    let state: ReturnType<typeof useHttpQuery<{ late: boolean }>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe（state を退避）
    function Probe(): null {
      state = useHttpQuery<{ late: boolean }>({ url: "/late" });
      return null;
    }
    // 描画（request はまだ resolve していない状態）
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // unmount でクリーンアップ（abort されるはず）
    await act(async () => {
      renderer?.unmount();
    });
    // ここで request を resolve（then 内で signal.aborted=true として早期 return）
    await act(async () => {
      // 任意の値で解決
      resolveReq?.();
      // microtask を flush
      await Promise.resolve();
      await Promise.resolve();
    });
    // state.data は undefined のまま（setState がスキップされた証拠）
    expect(state?.data).toBeUndefined();
  });

  // request 完了後 / body 解決中に unmount すると、body 解決後の signal.aborted で setState を skip（line 166 分岐）
  it("body 解決中に unmount すると signal.aborted を見て setState を skip", async () => {
    // raw.text() を制御するための後から resolve する promise
    let resolveText: ((s: string) => void) | undefined;
    // 制御可能な Response 風オブジェクト
    const rawCustom = {
      // body を解決させる text のみ用意
      text: () =>
        new Promise<string>((resolve) => {
          resolveText = resolve;
        }),
    } as unknown as Response;
    // 制御可能な response を返す client（body は未解決、content-type は text 系で auto 経路 → raw.text を待たせる）
    const client = clientOf(async (init) => {
      // 最低限の HttpRequest を作成
      const request: HttpRequest = {
        url: init.url,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
        signal: init.signal,
        requestId: "q-late-166",
      };
      // body は undefined → resolveResponseBody は raw.text を呼ぶ
      return {
        status: 200,
        ok: true,
        // content-type を text にして auto が text 経路に入るようにする
        headers: { "content-type": "text/plain" },
        rawHeaders: new Headers({ "content-type": "text/plain" }),
        body: undefined,
        raw: rawCustom,
        request,
      } as HttpResponse<string>;
    });
    // state
    let state: ReturnType<typeof useHttpQuery<string>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<string>({ url: "/text-late" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      // request 自体は即座に resolve されるが、then 内の resolveResponseBody が raw.text で停止
      await Promise.resolve();
      await Promise.resolve();
    });
    // unmount → ctrl.abort（resolveResponseBody は依然 raw.text で待機中）
    await act(async () => {
      renderer?.unmount();
    });
    // ここで raw.text を resolve → resolveResponseBody が完了 → line 166 で signal.aborted を検出
    await act(async () => {
      resolveText?.("payload-text");
      await Promise.resolve();
      await Promise.resolve();
    });
    // state.data は undefined のまま（line 166 で早期 return された証拠）
    expect(state?.data).toBeUndefined();
  });

  // request reject 後に signal.aborted=true なら catch も setState を skip（line 176 分岐）
  it("request の reject が abort 後に届くと catch 内で setState を skip", async () => {
    // 後から手動で reject する request promise を保持
    let rejectReq: ((err: unknown) => void) | undefined;
    // client
    const client = clientOf(
      () =>
        new Promise<HttpResponse<unknown>>((_resolve, reject) => {
          // reject を後から発火可能に
          rejectReq = (e) => reject(e);
        }),
    );
    // state
    let state: ReturnType<typeof useHttpQuery<unknown>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<unknown>({ url: "/late-reject" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // unmount でクリーンアップ
    await act(async () => {
      renderer?.unmount();
    });
    // ここで reject（catch 内で signal.aborted=true として早期 return）
    await act(async () => {
      // 任意の Error
      rejectReq?.(new Error("late-reject"));
      // microtask を flush
      await Promise.resolve();
      await Promise.resolve();
    });
    // state.error は undefined のまま
    expect(state?.error).toBeUndefined();
  });

  // parseAs="auto" + 非 JSON content-type + 空ボディ で undefined を返す（line 54 false 分岐）
  it("auto モードで非 JSON content-type かつ空ボディなら data は undefined", async () => {
    // 空ボディの client
    const client = clientOf(async (init) => {
      // 必要最低限のリクエスト
      const request: HttpRequest = {
        url: init.url,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
        signal: init.signal,
        requestId: "q-auto-empty",
      };
      // body 未設定 + content-type は text/plain（非 JSON）+ raw は空
      return {
        status: 200,
        ok: true,
        headers: { "content-type": "text/plain" },
        rawHeaders: new Headers({ "content-type": "text/plain" }),
        body: undefined,
        raw: new Response("", { headers: { "content-type": "text/plain" } }),
        request,
      } as HttpResponse<string>;
    });
    // state
    let state: ReturnType<typeof useHttpQuery<string>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<string>({ url: "/u" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // undefined に正規化される
    expect(state?.data).toBeUndefined();
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // parseAs="json" + 空ボディ で undefined を返す（resolveJsonBody の text.length===0 分岐）
  it("parseAs: 'json' で空ボディなら data は undefined", async () => {
    // 空ボディの JSON 風レスポンス
    const client = clientOf(async (init) => {
      // リクエスト
      const request: HttpRequest = {
        url: init.url,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
        signal: init.signal,
        requestId: "q-json-empty",
      };
      // body 未設定 + content-type=application/json + 空文字レスポンス
      return {
        status: 200,
        ok: true,
        headers: { "content-type": "application/json" },
        rawHeaders: new Headers({ "content-type": "application/json" }),
        body: undefined,
        raw: new Response("", { headers: { "content-type": "application/json" } }),
        request,
      } as HttpResponse<{ x: number } | undefined>;
    });
    // state
    let state:
      | ReturnType<typeof useHttpQuery<{ x: number } | undefined>>
      | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<{ x: number } | undefined>({ url: "/j" }, { parseAs: "json" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // 空 JSON は undefined に正規化される
    expect(state?.data).toBeUndefined();
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // resolveResponseBody が非 Error を投げた場合は固定メッセージで PARSE_ERROR が投げられる（line 57 false 分岐）
  it("body 解決が非 Error を投げると 'failed to parse response body' で PARSE_ERROR を返す", async () => {
    // raw.text が非 Error（文字列）を throw する Response 風
    const rawCustom = {
      // 直接 throw（非 Error）
      text: () => Promise.reject("non-error-string"),
    } as unknown as Response;
    // client
    const client = clientOf(async (init) => {
      // リクエスト
      const request: HttpRequest = {
        url: init.url,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
        signal: init.signal,
        requestId: "q-non-error",
      };
      // body 未設定 + content-type=text/plain + raw は throw する
      return {
        status: 200,
        ok: true,
        headers: { "content-type": "text/plain" },
        rawHeaders: new Headers({ "content-type": "text/plain" }),
        body: undefined,
        raw: rawCustom,
        request,
      } as HttpResponse<string>;
    });
    // state
    let state: ReturnType<typeof useHttpQuery<unknown>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<unknown>({ url: "/u" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // PARSE_ERROR + 固定メッセージ
    expect(state?.error).toBeInstanceOf(HttpError);
    expect(state?.error?.code).toBe("PARSE_ERROR");
    expect(state?.error?.message).toBe("failed to parse response body");
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // enabled=true で loading=true 状態のまま enabled=false に切替えると、setState は loading=true→false に下げる（line 151 true 分岐）
  it("enabled=true から loading 中に false へ切替えると loading が false になる", async () => {
    // 後から resolve する request
    const client = clientOf(
      () => new Promise<HttpResponse<unknown>>(() => undefined),
    );
    // 切替可能 enabled
    let enabled = true;
    // state
    let state: ReturnType<typeof useHttpQuery<unknown>> | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpQuery<unknown>({ url: "/u" }, { enabled });
      return null;
    }
    // 初回（enabled=true, loading=true で停止）
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
    });
    // 初期は loading=true
    expect(state?.loading).toBe(true);
    // enabled を false に切替
    enabled = false;
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
    });
    // loading が false に下がる
    expect(state?.loading).toBe(false);
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // unmount で進行中の request が abort される (cleanup の return path)
  it("unmount で進行中の request が abort される", async () => {
    // resolve しない promise を返す client
    let signalSeen: AbortSignal | undefined;
    const client = clientOf(
      (init) =>
        new Promise<HttpResponse<unknown>>(() => {
          // signal を保存しつつ何もしない
          signalSeen = init.signal;
        }),
    );
    // renderer
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      useHttpQuery<unknown>({ url: "/u" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
    });
    // signal が渡されている
    expect(signalSeen?.aborted).toBe(false);
    // unmount で abort
    await act(async () => {
      renderer?.unmount();
    });
    // signal が abort されていること
    expect(signalSeen?.aborted).toBe(true);
  });

  it("loads text responses as text by default", async () => {
    const client = clientOf(async (init) => rawTextResponse("query-text", init));
    let state: ReturnType<typeof useHttpQuery<string>> | undefined;
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state?.loading).toBe(false);
    expect(state?.data).toBe("plain text");
    expect(state?.requestId).toBe("query-text");

    await act(async () => {
      renderer?.unmount();
    });

    function Probe(): null {
      state = useHttpQuery<string>({ url: "/text" });
      return null;
    }
  });
});

describe("useHttpMutation", () => {
  it("returns parsed mutateAsync result and stores the latest success", async () => {
    const client = clientOf(async (init) =>
      rawJsonResponse({ saved: init.body === "payload" }, "mutation-1", init),
    );
    let state:
      | ReturnType<typeof useHttpMutation<string, { saved: boolean }>>
      | undefined;
    let renderer: ReactTestRenderer | undefined;
    let result: { saved: boolean } | undefined;

    await act(async () => {
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
    });

    await act(async () => {
      result = await state?.mutateAsync("payload");
    });

    expect(result).toEqual({ saved: true });
    expect(state?.loading).toBe(false);
    expect(state?.data).toEqual({ saved: true });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/save", body: "payload" }),
    );

    await act(async () => {
      renderer?.unmount();
    });

    function Probe(): null {
      state = useHttpMutation<string, { saved: boolean }>({
        url: "/save",
        method: "POST",
      });
      return null;
    }
  });

  // mutate （fire-and-forget）が dev 環境では console.warn にエラーを出すこと
  it("mutate が失敗したとき dev 環境で console.warn にエラーを出す", async () => {
    // console.warn をモック
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // NODE_ENV を dev へ stub
    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    const prevEnv = proc?.env?.NODE_ENV;
    if (proc?.env !== undefined) {
      proc.env.NODE_ENV = "development";
    }
    // 常に reject する client
    const client = clientOf(async () => {
      // 任意の例外を投げる
      throw new Error("mutate-fail");
    });
    // state 保持用
    let state:
      | ReturnType<typeof useHttpMutation<string, unknown>>
      | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpMutation<string, unknown>({ url: "/save", method: "POST" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // mutate を呼ぶ（throw しない fire-and-forget）
    await act(async () => {
      // 戻り値 void
      state?.mutate("payload");
      // 内部の Promise.catch を流す
      await Promise.resolve();
      await Promise.resolve();
    });
    // console.warn が呼ばれていること
    expect(warnSpy).toHaveBeenCalled();
    // state.error にエラーが入っていること
    expect(state?.error).toBeInstanceOf(HttpError);
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
    // NODE_ENV 復元
    if (proc?.env !== undefined) {
      proc.env.NODE_ENV = prevEnv;
    }
    // spy 解除
    warnSpy.mockRestore();
  });

  // mutate （fire-and-forget）が prod 環境では console.warn を出さないこと
  it("mutate が失敗しても prod 環境では console.warn を出さない", async () => {
    // console.warn をモック
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // NODE_ENV を production へ stub
    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    const prevEnv = proc?.env?.NODE_ENV;
    if (proc?.env !== undefined) {
      proc.env.NODE_ENV = "production";
    }
    // 常に reject する client
    const client = clientOf(async () => {
      // 任意の例外を投げる
      throw new Error("mutate-fail");
    });
    // state 保持用
    let state:
      | ReturnType<typeof useHttpMutation<string, unknown>>
      | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpMutation<string, unknown>({ url: "/save", method: "POST" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // mutate を呼ぶ
    await act(async () => {
      // void
      state?.mutate("payload");
      // 内部の Promise.catch を流す
      await Promise.resolve();
      await Promise.resolve();
    });
    // console.warn は呼ばれない
    expect(warnSpy).not.toHaveBeenCalled();
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
    // NODE_ENV 復元
    if (proc?.env !== undefined) {
      proc.env.NODE_ENV = prevEnv;
    }
    // spy 解除
    warnSpy.mockRestore();
  });

  // process.env が完全に未定義のときも console.warn を出さない（env undefined 分岐）
  it("process.env が未定義の環境では console.warn を出さない", async () => {
    // console.warn をモック
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // process.env を完全に消す
    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    const prevEnv = proc?.env;
    if (proc !== undefined) {
      // env を消す
      delete proc.env;
    }
    // 常に reject する client
    const client = clientOf(async () => {
      // 任意の例外
      throw new Error("mutate-fail");
    });
    // state
    let state:
      | ReturnType<typeof useHttpMutation<string, unknown>>
      | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpMutation<string, unknown>({ url: "/save", method: "POST" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // mutate を呼ぶ
    await act(async () => {
      // void
      state?.mutate("payload");
      // 内部の Promise.catch を流す
      await Promise.resolve();
      await Promise.resolve();
    });
    // console.warn は呼ばれない
    expect(warnSpy).not.toHaveBeenCalled();
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
    // env 復元
    if (proc !== undefined && prevEnv !== undefined) {
      proc.env = prevEnv;
    }
    // spy 解除
    warnSpy.mockRestore();
  });

  // mutateAsync が reject すること（throw 経路）
  it("mutateAsync は失敗時に HttpError を throw する", async () => {
    // 常に reject する client
    const client = clientOf(async () => {
      // 非 Error を throw（toHttpError の non-Error 分岐）
      throw "raw-string";
    });
    // state
    let state:
      | ReturnType<typeof useHttpMutation<string, unknown>>
      | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpMutation<string, unknown>({ url: "/save", method: "POST" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 例外を補足する変数
    let captured: unknown;
    // mutateAsync を呼ぶ
    await act(async () => {
      try {
        // throw する想定
        await state?.mutateAsync("payload");
      } catch (e) {
        // 補足
        captured = e;
      }
    });
    // captured が HttpError であること
    expect(captured).toBeInstanceOf(HttpError);
    // state.error にも HttpError が入っていること
    expect(state?.error).toBeInstanceOf(HttpError);
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  // reset で state がクリアされること
  it("reset で data / error / loading がクリアされる", async () => {
    // 成功する client
    const client = clientOf(async (init) =>
      rawJsonResponse({ ok: true }, "mutation-reset", init),
    );
    // state
    let state:
      | ReturnType<typeof useHttpMutation<string, { ok: boolean }>>
      | undefined;
    let renderer: ReactTestRenderer | undefined;
    // Probe
    function Probe(): null {
      state = useHttpMutation<string, { ok: boolean }>({ url: "/save", method: "POST" });
      return null;
    }
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // mutate して成功
    await act(async () => {
      // 成功
      await state?.mutateAsync("p");
    });
    // data が入っていること
    expect(state?.data).toEqual({ ok: true });
    // reset を呼ぶ
    await act(async () => {
      // 同期 setState
      state?.reset();
    });
    // 全部 undefined / false に戻ること
    expect(state?.data).toBeUndefined();
    expect(state?.error).toBeUndefined();
    expect(state?.loading).toBe(false);
    // 後片付け
    await act(async () => {
      renderer?.unmount();
    });
  });

  it("keeps only the latest mutation result in state", async () => {
    let releaseFirst: (() => void) | undefined;
    const client = clientOf(
      (init) =>
        new Promise<HttpResponse<unknown>>((resolve) => {
          if (init.body === "first") {
            releaseFirst = () =>
              resolve(response({ saved: "first" }, "mutation-first", init));
            return;
          }
          resolve(response({ saved: "second" }, "mutation-second", init));
        }),
    );
    let state:
      | ReturnType<typeof useHttpMutation<string, { saved: string }>>
      | undefined;
    let renderer: ReactTestRenderer | undefined;
    let first: Promise<{ saved: string }> | undefined;

    await act(async () => {
      renderer = create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
    });

    await act(async () => {
      first = state?.mutateAsync("first");
      await state?.mutateAsync("second");
      releaseFirst?.();
      await first;
    });

    expect(state?.data).toEqual({ saved: "second" });

    await act(async () => {
      renderer?.unmount();
    });

    function Probe(): null {
      state = useHttpMutation<string, { saved: string }>({
        url: "/save",
        method: "POST",
      });
      return null;
    }
  });
});
