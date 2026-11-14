import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// The PDF library loads its built-in fonts by a computed file name, which Next's file tracing cannot
// see. If they are missing from a route's traced files, they are missing from the deployed bundle too,
// and every quote PDF (and the quote email, which attaches one) fails on Vercel with
// "Cannot find module .../standard-fonts/Helvetica.cjs" even though it works locally.
// Runs after `pnpm build`, which is when CI runs the browser tests.

const ROUTES: [name: string, file: string][] = [
  ["the PDF download", ".next/server/app/(crm)/app/quotes/[id]/pdf/route.js.nft.json"],
  [
    "the quote page (which can email a PDF)",
    ".next/server/app/(crm)/app/quotes/[id]/page.js.nft.json",
  ],
];

test.describe("deployed bundle", () => {
  for (const [name, rel] of ROUTES) {
    test(`${name} ships the PDF fonts`, () => {
      const file = join(process.cwd(), rel);
      test.skip(!existsSync(file), "no production build to inspect");
      const files: string[] = JSON.parse(readFileSync(file, "utf8")).files;
      const fonts = files.filter((f) => f.includes("pdfkit") && f.includes("standard-fonts"));
      expect(fonts.some((f) => f.endsWith("Helvetica.cjs"))).toBe(true);
      expect(fonts.some((f) => f.endsWith("HelveticaBold.cjs"))).toBe(true);
    });
  }
});
