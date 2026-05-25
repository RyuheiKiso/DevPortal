import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import type {
  HttpClient,
  HttpRequest,
  HttpRequestInit,
  HttpResponse,
} from "@k1s0-ts-http/core";
import { HttpError } from "@k1s0-ts-http/core";
import { HttpClientProvider, useHttpMutation, useHttpQuery } from "./index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
