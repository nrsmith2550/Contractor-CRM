import { describe, expect, it } from "vitest";
import { MAX_LOGO_BYTES, validateLogo } from "@/server/domain/branding";
import { PNG_1PX } from "../support/images";

// A minimal JPEG header.
const JPEG =
  "data:image/jpeg;base64," +
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]).toString("base64");

describe("logo validation", () => {
  it("accepts a real PNG and a JPEG", () => {
    expect(validateLogo(PNG_1PX)).toEqual({ ok: true, dataUrl: PNG_1PX });
    expect(validateLogo(JPEG).ok).toBe(true);
  });

  it("rejects other types, spoofed types, junk and non-strings", () => {
    const text = "data:image/png;base64," + Buffer.from("not an image at all").toString("base64");
    expect(validateLogo(text).ok).toBe(false); // PNG label, wrong bytes
    expect(validateLogo(JPEG.replace("image/jpeg", "image/png")).ok).toBe(false); // JPEG bytes labelled PNG
    expect(validateLogo("data:image/svg+xml;base64,PHN2Zy8+").ok).toBe(false); // SVG can carry scripts
    expect(validateLogo("data:image/gif;base64,R0lGODlh").ok).toBe(false);
    expect(validateLogo("https://example.com/logo.png").ok).toBe(false);
    expect(validateLogo("").ok).toBe(false);
    expect(validateLogo(null).ok).toBe(false);
    expect(validateLogo(42).ok).toBe(false);
  });

  it("rejects an oversized image", () => {
    const big = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(MAX_LOGO_BYTES),
    ]);
    const r = validateLogo("data:image/png;base64," + big.toString("base64"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/under 200 KB/);
  });
});
