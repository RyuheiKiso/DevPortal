// vitest のヘルパを取り込み
import { describe, expect, it } from "vitest";
// 判定対象の type guard 群
import { isBlobMedia, isDataUrlMedia, isFilePathMedia } from "./media.js";
// 型補完用
import type { CapturedMedia } from "./media.js";

// blob 型の固定値（kind: "blob"）
const blobValue: CapturedMedia = { kind: "blob", blob: new Blob(["x"]), mimeType: "image/jpeg" };
// dataUrl 型の固定値
const dataUrlValue: CapturedMedia = { kind: "dataUrl", value: "data:,abc", mimeType: "image/png" };
// filePath 型の固定値
const filePathValue: CapturedMedia = { kind: "filePath", path: "/tmp/a.jpg", mimeType: "image/jpeg" };

// media の判別共用体ヘルパ
describe("media type guards", () => {
  // isBlobMedia
  it("isBlobMedia は blob のみ true を返す", () => {
    expect(isBlobMedia(blobValue)).toBe(true);
    expect(isBlobMedia(dataUrlValue)).toBe(false);
    expect(isBlobMedia(filePathValue)).toBe(false);
  });

  // isDataUrlMedia
  it("isDataUrlMedia は dataUrl のみ true を返す", () => {
    expect(isDataUrlMedia(dataUrlValue)).toBe(true);
    expect(isDataUrlMedia(blobValue)).toBe(false);
    expect(isDataUrlMedia(filePathValue)).toBe(false);
  });

  // isFilePathMedia
  it("isFilePathMedia は filePath のみ true を返す", () => {
    expect(isFilePathMedia(filePathValue)).toBe(true);
    expect(isFilePathMedia(blobValue)).toBe(false);
    expect(isFilePathMedia(dataUrlValue)).toBe(false);
  });
});
