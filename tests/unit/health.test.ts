import { describe, expect, it } from "vitest";
import { checkDb } from "@/lib/health";

describe("checkDb", () => {
  it("reports not_configured when there is no executor", async () => {
    expect(await checkDb(null)).toEqual({ ok: false, db: "not_configured" });
  });

  it("reports ok when the query succeeds", async () => {
    expect(await checkDb(async () => [{ "?column?": 1 }])).toEqual({ ok: true, db: "ok" });
  });

  it("reports error when the query throws", async () => {
    const run = async () => {
      throw new Error("connection refused");
    };
    expect(await checkDb(run)).toEqual({ ok: false, db: "error" });
  });
});
