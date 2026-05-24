import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HttpClient,
  HttpClientConfig,
  HttpRequest,
  HttpRequestInit,
  HttpResponse,
} from "@k1s0-ts-http/core";
import { createNetInfoAware } from "./netInfo.js";

const netInfo = vi.hoisted(() => ({
  state: { isConnected: false as boolean | null },
  listener: undefined as ((state: { isConnected: boolean | null }) => void) | undefined,
  unsubscribe: vi.fn(),
}));

vi.mock("@react-native-community/netinfo", () => ({
  default: {
    fetch: vi.fn(async () => netInfo.state),
    addEventListener: vi.fn((handler) => {
      netInfo.listener = handler;
      return netInfo.unsubscribe;
    }),
  },
}));

function okResponse(req: HttpRequest): HttpResponse<string> {
  return {
    status: 200,
    ok: true,
    headers: {},
    rawHeaders: new Headers(),
    body: "ok",
    raw: new Response(),
    request: req,
  };
}

function clientWithInterceptors(): HttpClient {
  const make = (config: HttpClientConfig): HttpClient => ({
    config,
    withConfig: (override) =>
      make({
        ...config,
        requestInterceptors: [
          ...(config.requestInterceptors ?? []),
          ...(override.requestInterceptors ?? []),
        ],
      }),
    request: async (init: HttpRequestInit) => {
      let req: HttpRequest = {
        url: init.url,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
        signal: init.signal,
        requestId: "netinfo-1",
      };
      for (const interceptor of config.requestInterceptors ?? []) {
        req = await interceptor(req);
      }
      return okResponse(req);
    },
  });
  return make({});
}

beforeEach(() => {
  netInfo.state = { isConnected: false };
  netInfo.listener = undefined;
  netInfo.unsubscribe.mockClear();
});

describe("createNetInfoAware", () => {
  it("rejects queued requests when their signal is aborted", async () => {
    const aware = await createNetInfoAware(clientWithInterceptors(), {
      rejectWhenOffline: false,
      queueWhenOffline: true,
    });
    const ctrl = new AbortController();
    const pending = aware.client.request({ url: "/queued", signal: ctrl.signal });

    ctrl.abort("stop");

    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    aware.dispose();
  });

  it("rejects queued requests on dispose", async () => {
    const aware = await createNetInfoAware(clientWithInterceptors(), {
      rejectWhenOffline: false,
      queueWhenOffline: true,
    });
    const pending = aware.client.request({ url: "/queued" });

    aware.dispose();

    await expect(pending).rejects.toMatchObject({ code: "OFFLINE" });
    expect(netInfo.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("resumes queued requests when NetInfo reports online", async () => {
    const aware = await createNetInfoAware(clientWithInterceptors(), {
      rejectWhenOffline: false,
      queueWhenOffline: true,
    });
    const pending = aware.client.request({ url: "/queued" });

    netInfo.listener?.({ isConnected: true });

    await expect(pending).resolves.toMatchObject({ body: "ok" });
    aware.dispose();
  });
});
