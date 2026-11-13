import { TIERS } from "@/lib/tiers";
import { INVITE_TTL_MS } from "@/server/auth/invitations";
import { LOGIN_LIMIT } from "@/server/auth/rate-limit";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { N } from "../names";
import { h, list, note, p, steps, tip, type Article } from "../types";

export const FIX: Article[] = [
  {
    slug: "cant-sign-in",
    title: "I can't sign in",
    summary: "Work through the usual causes, from a typo to turned-off access.",
    category: "fix",
    body: [
      steps(
        "Check the **email**. It must be the address you were invited with.",
        `Check the **password**. It is at least ${MIN_PASSWORD_LENGTH} characters, and capital letters count. Check Caps Lock.`,
        "Still no? Choose **Forgot your password?** on the sign-in page and use the link in the email. Look in spam if it does not arrive.",
      ),
      h("What the message means"),
      list(
        `**Too many attempts. Try again in 15 minutes.** After ${LOGIN_LIMIT.max} wrong tries in ${LOGIN_LIMIT.windowSeconds / 60} minutes, signing in pauses. Wait, or use the reset link.`,
        "**Your access has been turned off.** Your administrator turned your sign-in off. Ask them.",
        "**This license isn't active.** The business's license needs attention. Tell your administrator, who can contact support.",
      ),
      h("I never got my invitation"),
      p(
        `Ask your administrator to invite you again from Settings, Users. Invitations last ${Math.round(INVITE_TTL_MS / 86_400_000)} days and go to one specific email address.`,
      ),
    ],
    related: ["signing-in", "users-roles"],
  },
  {
    slug: "cant-find-record",
    title: "I can't find a record",
    summary: "Why a customer, prospect or job might not be on your screen, and how to find it.",
    category: "fix",
    body: [
      steps(
        "Look at the **view** drop-down above the list. Many lists start on *My* records or *Open* ones. Switch to *All* or *Closed*.",
        "Clear the **Search this view** box and choose **Apply**.",
        "Try the **search box at the top**. It looks across prospects, customers, people, deals, products, support requests and jobs.",
      ),
      h("It might be someone else's"),
      list(
        `Salespeople see their own ${N.prospects}, ${N.deals}, quotes and orders. Ask a sales manager or the owner to look, or to give it to you.`,
        `Technicians see their own ${N.visits}.`,
        `Some roles do not have an area at all: for example ${N.requests} are not part of a salesperson's role.`,
      ),
      h("It might have moved on"),
      list(
        `A ${N.prospect} you turned into a ${N.customer} is now under ${N.Customers} and ${N.Deals}.`,
        "Resolved, cancelled, won and lost records move to their own views.",
      ),
      tip("Spelling matters in search: try fewer words, or part of a name or number."),
    ],
    related: ["finding-things", "who-can-do-what"],
  },
  {
    slug: "duplicates",
    title: "A duplicate warning appeared",
    summary: `What it means when turning a ${N.prospect} into a ${N.customer}, and what to choose.`,
    category: "fix",
    body: [
      p(
        `When you choose **Turn into a customer**, Clinch CRM checks whether a ${N.customer} or ${N.person} already exists with the same **company name**, **email** or **phone number**. If it finds one it shows you the possible matches instead of creating a double.`,
      ),
      list(
        `**Same one?** Use the existing ${N.customer} or ${N.person}. Everything stays in one place.`,
        "**Different?** (two shops with the same name in different towns) continue and create a new one.",
      ),
      note(
        "Phone numbers are compared ignoring spaces, dashes and brackets, and names ignoring capitals and punctuation.",
      ),
    ],
    related: ["turn-into-customer", "customers"],
  },
  {
    slug: "seats-license",
    title: "Seat limits and license messages",
    summary: "How many people can sign in, and what to do when you reach the limit.",
    category: "fix",
    who: "The owner.",
    body: [
      p(
        `Your license allows a number of people to be active at once (a **seat** each): ${Object.values(
          TIERS,
        )
          .map((t) => `${t.label} ${t.seatLimit}`)
          .join(", ")}.`,
      ),
      list(
        "See the count on [Settings, Users](/app/settings/users): *X of Y seats in use*.",
        "A pending invitation holds a seat until it is accepted or expires.",
        "If you are at the limit, you cannot invite more people until a seat is free or you move to a larger license.",
        "To move to a larger license, contact support.",
      ),
    ],
    related: ["users-roles"],
  },
  {
    slug: "quote-email",
    title: "My quote email did not send",
    summary: "Why sending can fail, and the quick way round it.",
    category: "fix",
    body: [
      list(
        "The quote must be **active**. Drafts cannot be emailed: choose **Activate quote** first.",
        "A quote that has been **revised** cannot be sent. Send the latest revision.",
        '**"You\'ve sent a lot of quotes in the last hour"** is a safety limit. Wait a while and try again.',
        "**\"The email couldn't be sent. Check the email settings\"** means the business's email sending is not set up or is being refused. Your administrator needs to check it.",
      ),
      tip("In the meantime choose **Download PDF** and send it from your own email."),
      p(
        "When a quote email is sent, a note of it (who it went to and the PDF attached) is added to the timeline, so you can see it went.",
      ),
    ],
    related: ["quotes"],
  },
  {
    slug: "faq",
    title: "Common questions",
    summary: "Quick answers to the questions people ask most.",
    category: "fix",
    body: [
      list(
        `**Can I undo a change?** Most edits can be changed back by editing again. Closed ${N.prospects} can be reactivated, closed ${N.deals} reopened and ${N.requests} reactivated. A *posted* ${N.job} and an active quote are locked on purpose.`,
        "**Can others see what I wrote?** Notes can be seen by everyone who can see that record.",
        "**Can I get my data out?** Yes. Every list has **Export to Excel** and **Export to CSV**.",
        "**Can I use it on my phone?** Yes. The screens adapt to a phone, and technicians have a simple [My visits](/app/my-visits) screen.",
        "**Is my data kept apart from other businesses?** Yes. Each business's data is separated by the database itself, not just by the screens.",
        "**What time zone is used?** The one you chose when you activated. Dates and times everywhere follow it.",
        `**Who can see the ${N.Schedule}?** Anyone who can see ${N.jobs}. Only dispatchers can change it.`,
      ),
    ],
    related: ["welcome", "who-can-do-what"],
  },
];
