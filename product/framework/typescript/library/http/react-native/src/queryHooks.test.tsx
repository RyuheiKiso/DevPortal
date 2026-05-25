import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { HttpError } from "@k1s0-ts-http/core";
import type {
  HttpClient,
  HttpRequest,
  HttpRequestInit,
  HttpResponse,
} from "@k1s0-ts-http/core";
import { HttpClientProvider, useHttpQuery } from "./index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
const originalConsoleError = console.error;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("react-test-renderer is deprecated")
    ) {
      return;
    }
    originalConsoleError(...args);
  });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

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
      rawJsonResponse({ ok: true }, "rn-query-1", init),
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
    expect(state?.requestId).toBe("rn-query-1");

    await act(async () => {
      renderer?.unmount();
    });

    function Probe(): null {
      state = useHttpQuery<{ ok: boolean }>({ url: "/users" });
      return null;
    }
  });

  it("preserves requestId when JSON parsing fails", async () => {
    const client = clientOf(async (init) =>
      invalidJsonResponse("rn-query-bad-json", init),
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
    expect(state?.error).toBeInstanceOf(HttpError);
    expect(state?.error?.code).toBe("PARSE_ERROR");
    expect(state?.error?.requestId).toBe("rn-query-bad-json");
    expect(state?.requestId).toBe("rn-query-bad-json");

    await act(async () => {
      renderer?.unmount();
    });

    function Probe(): null {
      state = useHttpQuery<{ ok: boolean }>({ url: "/users" });
      return null;
    }
  });

  it("loads text responses as text by default", async () => {
    const client = clientOf(async (init) => rawTextResponse("rn-query-text", init));
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
    expect(state?.requestId).toBe("rn-query-text");

    await act(async () => {
      renderer?.unmount();
    });

    function Probe(): null {
      state = useHttpQuery<string>({ url: "/text" });
      return null;
    }
  });
});
