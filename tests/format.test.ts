import { describe, expect, test } from "bun:test";

import { formatTable } from "../src/utils/format";

describe("formatTable()", () => {
  test("aligns columns correctly", () => {
    const result = formatTable(
      ["NAME", "TYPE", "STATUS"],
      [
        ["my-skill", "vendor", "enabled"],
        ["a", "core", "disabled"],
      ],
    );

    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    // Headers
    expect(lines[0]).toContain("NAME");
    expect(lines[0]).toContain("TYPE");
    expect(lines[0]).toContain("STATUS");
    // Column alignment: "my-skill" is 8 chars, "a" should be padded to match
    expect(lines[1].indexOf("vendor")).toBe(lines[2].indexOf("core"));
  });

  test("handles empty rows", () => {
    const result = formatTable(["NAME", "TYPE"], []);
    expect(result).toBe("NAME  TYPE");
  });

  test("handles special characters in content", () => {
    const result = formatTable(
      ["NAME", "DESCRIPTION"],
      [
        ["my-skill", "A skill with <special> & \"chars\""],
        ["another", "Normal description"],
      ],
    );

    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("<special>");
    expect(lines[1]).toContain("&");
    expect(lines[1]).toContain("\"chars\"");
  });

  test("last column is not padded", () => {
    const result = formatTable(
      ["A", "B"],
      [["short", "end"]],
    );

    const lines = result.split("\n");
    // Last column should not have trailing spaces
    expect(lines[1]).toBe("short  end");
  });

  test("single column table", () => {
    const result = formatTable(["NAME"], [["alpha"], ["beta"]]);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("NAME");
    expect(lines[1]).toBe("alpha");
    expect(lines[2]).toBe("beta");
  });
});
