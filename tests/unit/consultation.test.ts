import { describe, expect, it } from "vitest";
import { bestTimeLabel, consultationSchema, phoneDigits } from "@/lib/consultation";
import { consultationConfirmEmail, consultationNotifyEmail } from "@/server/email/templates";

const good = {
  name: "Pat Jones",
  email: "  Pat@Example.COM ",
  phone: "(412) 555-0100",
  business: "Jones Heating",
  trade: "hvac",
  teamSize: "2-5",
  bestTime: "weekday_evenings",
  timeZone: "America/New_York",
};

describe("consultation request rules", () => {
  it("accepts a complete request and tidies the email", () => {
    const r = consultationSchema.safeParse(good);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("pat@example.com");
  });

  it("needs a phone number with at least ten digits", () => {
    expect(phoneDigits("+1 (412) 555-0100")).toBe("14125550100");
    expect(consultationSchema.safeParse({ ...good, phone: "555-0100" }).success).toBe(false);
    expect(consultationSchema.safeParse({ ...good, phone: "+1 412 555 0100" }).success).toBe(true);
  });

  it("rejects unknown choices and over-long messages", () => {
    expect(consultationSchema.safeParse({ ...good, trade: "wizardry" }).success).toBe(false);
    expect(consultationSchema.safeParse({ ...good, timeZone: "Europe/Paris" }).success).toBe(false);
    expect(consultationSchema.safeParse({ ...good, message: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("consultation emails", () => {
  it("replies to the visitor and cannot be tricked by line breaks or markup", () => {
    const m = consultationNotifyEmail({
      to: "support@example.test",
      appUrl: "https://gantrycrm.com/",
      request: {
        name: "Evil\r\nBcc: x@y.z",
        email: "pat@example.com",
        phone: "4125550100",
        business: "<b>Jones</b>",
        trade: "HVAC",
        teamSize: "Just me",
        bestTime: bestTimeLabel("saturdays"),
        timeZone: "Eastern",
        message: "<script>alert(1)</script>",
      },
    });
    expect(m.replyTo).toBe("pat@example.com");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>Jones</b>");
    expect(m.text).toContain("https://gantrycrm.com/admin/consultations");
  });

  it("tells the visitor when we will call", () => {
    const m = consultationConfirmEmail({
      to: "pat@example.com",
      name: "Pat",
      phone: "4125550100",
      bestTime: "Weekday evenings",
      timeZone: "Eastern",
      supportEmail: "support@gantrycrm.com",
    });
    expect(m.text).toContain("4125550100");
    expect(m.text).toContain("weekday evenings");
    expect(m.text).toContain("two business days");
  });
});
