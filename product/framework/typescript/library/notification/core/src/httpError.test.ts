import { describe, expect, it } from "vitest";
import {
  fromHttpError,
  isHttpErrorLike,
  resolveDefaultMapping,
} from "./httpError.js";
import type { HttpErrorLike } from "./httpError.js";
import { HttpError } from "@k1s0-ts-http/core";

describe("isHttpErrorLike", () => {
  it("returns false for nullish and primitive values", () => {
    expect(isHttpErrorLike(null)).toBe(false);
    expect(isHttpErrorLike(undefined)).toBe(false);
    expect(isHttpErrorLike("error")).toBe(false);
    expect(isHttpErrorLike(123)).toBe(false);
  });

  it("returns false when message is missing", () => {
    expect(isHttpErrorLike({ status: 500 })).toBe(false);
  });

  it("returns false when status and code are both missing", () => {
    expect(isHttpErrorLike({ message: "x" })).toBe(false);
  });

  it("accepts message with status", () => {
    expect(isHttpErrorLike({ message: "x", status: 500 })).toBe(true);
  });

  it("accepts message with code", () => {
    expect(isHttpErrorLike({ message: "x", code: "NETWORK" })).toBe(true);
  });
});

describe("resolveDefaultMapping", () => {
  it("maps NETWORK to warning", () => {
    const res = resolveDefaultMapping({ message: "x", code: "NETWORK" });
    expect(res.level).toBe("warning");
    expect(res.title).toContain("ネットワーク");
  });

  it("maps TIMEOUT to warning", () => {
    const res = resolveDefaultMapping({ message: "x", code: "TIMEOUT" });
    expect(res.level).toBe("warning");
    expect(res.title).toContain("タイムアウト");
  });

  it("maps ABORTED to info", () => {
    const res = resolveDefaultMapping({ message: "x", code: "ABORTED" });
    expect(res.level).toBe("info");
    expect(res.title).toContain("キャンセル");
  });

  it("maps 5xx to error", () => {
    const res = resolveDefaultMapping({ message: "x", status: 503 });
    expect(res.level).toBe("error");
    expect(res.title).toContain("サーバーエラー");
  });

  it.each([401, 403, 404])("maps status %i to warning", (status) => {
    const res = resolveDefaultMapping({ message: "x", status });
    expect(res.level).toBe("warning");
  });

  it("maps other 4xx to request error", () => {
    const res = resolveDefaultMapping({ message: "x", status: 418 });
    expect(res.level).toBe("warning");
    expect(res.title).toBe("リクエストエラー");
  });

  it("falls back to error when status and code do not match a known error", () => {
    const res = resolveDefaultMapping({ message: "x" });
    expect(res.level).toBe("error");
  });

  it("falls back to error for unexpected 2xx-like HttpError values", () => {
    const res = resolveDefaultMapping({ message: "x", status: 200 });
    expect(res.level).toBe("error");
  });
});

describe("fromHttpError", () => {
  it("sets title, message, level, and meta from the default mapping", () => {
    const err: HttpErrorLike = { message: "boom", status: 503, requestId: "r-1" };
    const toast = fromHttpError(err);
    expect(toast.level).toBe("error");
    expect(toast.title).toBe("サーバーエラーが発生しました");
    expect(toast.message).toBe("boom");
    expect(toast.meta?.requestId).toBe("r-1");
    expect(toast.meta?.status).toBe(503);
  });

  it("overrides title and message with messageResolver", () => {
    const err: HttpErrorLike = { message: "raw", status: 500 };
    const toast = fromHttpError(err, {
      messageResolver: () => ({ title: "T", message: "M" }),
    });
    expect(toast.title).toBe("T");
    expect(toast.message).toBe("M");
  });

  it("keeps the original message when messageResolver only returns title", () => {
    const err: HttpErrorLike = { message: "raw", status: 500 };
    const toast = fromHttpError(err, {
      messageResolver: () => ({ title: "T-only" }),
    });
    expect(toast.title).toBe("T-only");
    expect(toast.message).toBe("raw");
  });

  it("overrides level with levelResolver", () => {
    const err: HttpErrorLike = { message: "x", status: 404 };
    const toast = fromHttpError(err, { levelResolver: () => "error" });
    expect(toast.level).toBe("error");
  });

  it("passes duration, dedupeKey, and custom meta through", () => {
    const err: HttpErrorLike = { message: "x", code: "NETWORK" };
    const toast = fromHttpError(err, {
      duration: 5000,
      dedupeKey: "net-err",
      meta: { custom: 42 },
    });
    expect(toast.duration).toBe(5000);
    expect(toast.dedupeKey).toBe("net-err");
    expect(toast.meta?.custom).toBe(42);
    expect(toast.meta?.code).toBe("NETWORK");
  });

  it("copies retryable true to meta", () => {
    const err: HttpErrorLike = { message: "x", code: "NETWORK", retryable: true };
    const toast = fromHttpError(err);
    expect(toast.meta?.retryable).toBe(true);
  });

  it("copies retryable false to meta", () => {
    const err: HttpErrorLike = { message: "x", status: 400, retryable: false };
    const toast = fromHttpError(err);
    expect(toast.meta?.retryable).toBe(false);
  });

  it("keeps code and status in meta when present", () => {
    const err = { message: "x", code: "NETWORK" } as HttpErrorLike;
    const toast = fromHttpError(err);
    expect(toast.meta?.code).toBe("NETWORK");

    const err2 = { message: "x", status: 500 } as HttpErrorLike;
    const toast2 = fromHttpError(err2);
    expect(toast2.meta?.status).toBe(500);
  });

  it("omits meta when no source or custom meta exists", () => {
    const err = { message: "x" } as HttpErrorLike;
    const toast = fromHttpError(err);
    expect(toast.meta).toBeUndefined();
  });
});

describe("compatibility with @k1s0-ts-http/core HttpError", () => {
  it("accepts HttpError instances through duck typing", () => {
    const err = new HttpError({
      message: "service unavailable",
      status: 503,
      code: "UNKNOWN",
      retryable: true,
      requestId: "req-1",
    });
    expect(isHttpErrorLike(err)).toBe(true);
  });

  it("converts HttpError instances to toast input", () => {
    const err = new HttpError({
      message: "ECONNREFUSED",
      code: "NETWORK",
      retryable: true,
      requestId: "req-2",
    });
    const toast = fromHttpError(err);
    expect(toast.level).toBe("warning");
    expect(toast.title).toContain("ネットワーク");
    expect(toast.message).toBe("ECONNREFUSED");
    expect(toast.meta?.requestId).toBe("req-2");
    expect(toast.meta?.code).toBe("NETWORK");
    expect(toast.meta?.retryable).toBe(true);
  });
});
