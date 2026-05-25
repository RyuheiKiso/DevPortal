// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// 公開 API 経由で検証関連を取り込み
import { extractValidationIssues, fromValidationError } from "./index.js";

// extractValidationIssues の分岐網羅
describe("extractValidationIssues", () => {
  // issues が無ければ空配列
  it("returns empty array when issues is missing", () => {
    expect(extractValidationIssues({})).toEqual([]);
    expect(extractValidationIssues(null)).toEqual([]);
    expect(extractValidationIssues("string")).toEqual([]);
  });

  // issues が配列でなければ空配列
  it("returns empty array when issues is not an array", () => {
    expect(extractValidationIssues({ issues: "not array" })).toEqual([]);
  });

  // null 要素や message 無し要素は除外
  it("filters out invalid issue entries", () => {
    const issues = extractValidationIssues({
      issues: [
        // null 要素は除外
        null,
        // message 無しは除外
        { path: ["x"], code: "bad" },
        // message のみは有効
        { message: "valid issue" },
      ],
    });
    expect(issues).toEqual([{ path: undefined, code: undefined, message: "valid issue" }]);
  });

  // path が (string|number)[] でなければ undefined にする
  it("drops invalid path types", () => {
    const issues = extractValidationIssues({
      issues: [
        // path が文字列 (非配列)
        { path: "customer.name", message: "string path" },
        // path 配列だが boolean 要素を含む
        { path: ["ok", true], message: "mixed path" },
      ],
    });
    expect(issues).toEqual([
      { path: undefined, code: undefined, message: "string path" },
      { path: undefined, code: undefined, message: "mixed path" },
    ]);
  });

  // 正しい (string|number)[] path は採用
  it("keeps valid string/number paths", () => {
    const issues = extractValidationIssues({
      issues: [{ path: ["customer", 0, "name"], code: "too_small", message: "Name is required" }],
    });
    expect(issues).toEqual([
      { path: ["customer", 0, "name"], code: "too_small", message: "Name is required" },
    ]);
  });
});

// fromValidationError の挙動を検証する
describe("fromValidationError", () => {
  // 先頭 issue の message を userMessage に採用
  it("uses first issue message as userMessage", () => {
    const error = fromValidationError({
      message: "Invalid input",
      issues: [{ path: ["x"], message: "First issue" }, { message: "Second" }],
    });

    expect(error.kind).toBe("validation");
    expect(error.message).toBe("Invalid input");
    expect(error.userMessage).toBe("First issue");
    expect(error.validationIssues).toHaveLength(2);
  });

  // error.message が無ければ汎用文言
  it("falls back to generic message when error.message is missing", () => {
    const error = fromValidationError({ issues: [{ message: "only" }] });
    expect(error.message).toBe("Validation failed");
  });

  // issues が 0 件なら validationIssues は undefined
  it("sets validationIssues to undefined when no issues remain", () => {
    expect(fromValidationError(new Error("nope")).validationIssues).toBeUndefined();
  });

  // 検証エラーは ユーザー入力起因のため reportable=false
  it("marks validation errors as non-reportable", () => {
    expect(fromValidationError({ issues: [{ message: "x" }] }).reportable).toBe(false);
  });

  // userMessage は issue 0 件のとき既定文言にフォールバック
  it("uses default userMessage when there are no issues", () => {
    const error = fromValidationError({});
    expect(error.userMessage).toBe("Please check the entered values.");
  });
});
