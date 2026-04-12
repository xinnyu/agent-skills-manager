import { describe, expect, test } from "bun:test";

import { ok, err } from "../src/utils/result";

describe("ok()", () => {
  test("creates a successful result with value", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  test("works with string values", () => {
    const result = ok("hello");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("hello");
    }
  });

  test("works with undefined", () => {
    const result = ok(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeUndefined();
    }
  });

  test("works with complex objects", () => {
    const data = { name: "test", items: [1, 2, 3] };
    const result = ok(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(data);
    }
  });

  test("works with empty string", () => {
    const result = ok("");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("");
    }
  });
});

describe("err()", () => {
  test("creates a failed result with error message", () => {
    const result = err("something went wrong");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("something went wrong");
    }
  });

  test("works with empty error message", () => {
    const result = err("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("");
    }
  });

  test("preserves detailed error messages", () => {
    const msg = 'File not found: /some/path/config.toml';
    const result = err<number>(msg);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(msg);
    }
  });
});
