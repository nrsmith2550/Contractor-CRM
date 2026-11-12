import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/server/email/mailer";
import { quoteEmail } from "@/server/email/templates";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const pdf = Buffer.from("%PDF-1.7 fake");

describe("quote email template", () => {
  const base = {
    to: "buyer@example.test",
    company: "Acme <Roofing>",
    quoteNumber: "QUO-01001",
    quoteName: "Roof & gutters",
    totalFormatted: "$1,234.50",
    senderName: "Jo Rivers",
    replyTo: "jo@acme.test",
  };

  it("names the quote, total and sender, and escapes HTML in the html part", () => {
    const e = quoteEmail({ ...base, message: "Thanks for your time <b>today</b>" });
    expect(e.subject).toBe("Quote QUO-01001 from Acme <Roofing>");
    expect(e.text).toContain("QUO-01001");
    expect(e.text).toContain("$1,234.50");
    expect(e.text).toContain("Thanks for your time <b>today</b>");
    expect(e.html).toContain("Acme &lt;Roofing&gt;");
    expect(e.html).toContain("&lt;b&gt;today&lt;/b&gt;");
    expect(e.html).not.toContain("<b>today</b>");
    expect(e.replyTo).toBe("jo@acme.test");
  });

  it("omits the message paragraph when there isn't one", () => {
    expect(quoteEmail(base).text.split("\n")[2]).toMatch(/^Please find attached/);
  });
});

describe("mailer attachments", () => {
  it("sends attachments base64-encoded and the reply-to address through Resend", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "CRM <quotes@example.test>");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendEmail({
      to: "buyer@example.test",
      subject: "Quote",
      text: "x",
      replyTo: "jo@acme.test",
      attachments: [{ filename: "QUO-01001.pdf", content: pdf, contentType: "application/pdf" }],
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(body.reply_to).toBe("jo@acme.test");
    expect(body.attachments).toEqual([
      { filename: "QUO-01001.pdf", content: pdf.toString("base64") },
    ]);
  });

  it("leaves the fields out when there are none", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "CRM <quotes@example.test>");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendEmail({ to: "a@example.test", subject: "Hi", text: "x" });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(body).not.toHaveProperty("attachments");
    expect(body).not.toHaveProperty("reply_to");
  });

  it("the dev file transport writes the attachment next to the message, with a safe file name", async () => {
    const { mkdtemp, readdir, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "mail-"));
    try {
      vi.stubEnv("RESEND_API_KEY", "");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("EMAIL_DEV_DIR", dir);
      await sendEmail({
        to: "buyer@example.test",
        subject: "Quote",
        text: "hello",
        attachments: [
          { filename: "../../evil name.pdf", content: pdf, contentType: "application/pdf" },
        ],
      });
      const files = await readdir(dir);
      expect(files).toHaveLength(2);
      const att = files.find((f) => f.endsWith(".pdf"))!;
      expect(att).not.toMatch(/[/\\ ]/);
      expect((await readFile(join(dir, att))).equals(pdf)).toBe(true);
      expect(
        await readFile(
          join(
            dir,
            files.find((f) => f.endsWith(".txt"))!,
          ),
          "utf8",
        ),
      ).toContain("Attachments:");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
