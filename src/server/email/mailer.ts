export type Attachment = { filename: string; content: Buffer; contentType: string };
export type Email = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Where replies go (e.g. the salesperson who sent a quote). */
  replyTo?: string;
  attachments?: Attachment[];
};

/** Messages "sent" while no email provider is configured (development and tests). */
const outbox: Email[] = [];
export const getOutbox = (): readonly Email[] => outbox;

/**
 * Sends through Resend when RESEND_API_KEY is set. Without it, non-production environments
 * keep the message in memory (and in EMAIL_DEV_DIR if set) instead of logging it, because
 * emails can contain license keys and reset links. Production without a provider is an error,
 * so a purchase can never silently lose its key.
 */
export async function sendEmail(email: Email): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const from = process.env.EMAIL_FROM;
    if (!from) throw new Error("EMAIL_FROM is not set");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        ...(email.attachments?.length
          ? {
              attachments: email.attachments.map((a) => ({
                filename: a.filename,
                content: a.content.toString("base64"),
              })),
            }
          : {}),
      }),
    });
    if (!res.ok) throw new Error(`Email provider rejected the message (${res.status})`);
    return;
  }

  // EMAIL_DEV_DIR is an explicit opt-in file transport (development and end-to-end tests, which
  // run a production build). Leave it unset in production so a missing provider is an error.
  const dir = process.env.EMAIL_DEV_DIR;
  if (process.env.NODE_ENV === "production" && !dir) throw new Error("RESEND_API_KEY is not set");
  outbox.push(email);
  if (dir) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    const safe = email.to.replace(/[^a-z0-9@.]+/gi, "_");
    const stamp = `${Date.now()}-${safe}`;
    const names = (email.attachments ?? []).map((a) => a.filename.replace(/[^a-z0-9._-]+/gi, "_"));
    await writeFile(
      `${dir}/${stamp}.txt`,
      `${email.subject}\n\n${email.text}\n${names.length ? `\nAttachments: ${names.join(", ")}\n` : ""}`,
    );
    for (const [i, a] of (email.attachments ?? []).entries()) {
      await writeFile(`${dir}/${stamp}-${names[i]}`, a.content);
    }
  }
  console.info(`[mail] (dev, not sent) to=${email.to} subject="${email.subject}"`);
}
