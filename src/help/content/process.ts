import { DEFAULT_ROLES, type Depth, type Entity } from "@/server/security/roles";
import { nextBookingStatuses, BOOKING_STATUSES } from "@/server/domain/booking-status";
import { SLA_HOURS } from "@/server/domain/sla";
import { nextStatuses, WO_STATUSES } from "@/server/domain/work-order-status";
import { N } from "../names";
import { flow, h, list, note, p, steps, table, tip, type Article } from "../types";

const say = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const nextWords = (xs: readonly string[]) =>
  xs.length ? xs.map(say).join(", ") : "Nothing: final";

/** What each area is called on screen, in the order people think of them. */
const AREAS: [Entity, string][] = [
  ["lead", N.Prospects],
  ["account", N.Customers],
  ["contact", N.People],
  ["opportunity", N.Deals],
  ["quote", "Quotes"],
  ["order", "Orders"],
  ["case", N.Requests],
  ["work_order", N.Jobs],
  ["booking", N.Visits],
  ["product", N.Products],
  ["price_list", N.Pricing],
  ["activity", "Appointments"],
  ["note", "Notes"],
  ["user", "Users"],
  ["security_role", "Roles"],
];

type Priv = Partial<Record<string, Depth>> | undefined;

/** One plain word for what a role can do with an area, from its real privileges. */
export function accessWord(p: Priv): string {
  if (!p?.read) return "No access";
  if (p.read === "organization") {
    if (p.write === "organization") return "Full";
    if (p.write === "user") return "View all, change own";
    return "View all";
  }
  return p.write ? "Own only" : "View own";
}

export const PROCESS: Article[] = [
  {
    slug: "who-can-do-what",
    title: "Who can do what",
    summary: "What each role can see and change, from the actual settings.",
    category: "process",
    body: [
      p(
        "Every person has a role. The role decides what they can see and change. This table is produced from the real role settings, so it is always what the product does.",
      ),
      table(
        "Access by role and area",
        ["Area", ...DEFAULT_ROLES.map((r) => r.name)],
        AREAS.map(([entity, label]) => [
          label,
          ...DEFAULT_ROLES.map((r) => accessWord(r.privileges[entity])),
        ]),
      ),
      list(
        "**Full:** see everyone's and change them.",
        "**Own only:** only records you created or that were given to you.",
        "**View all, change own:** see everyone's, change your own.",
        "**View all:** look but not change. **No access:** the area is not shown.",
      ),
      note(
        "These six roles come with every business. They are checked every time, on the server, not just by hiding buttons, so a person cannot get to something by typing a web address.",
      ),
    ],
    related: ["users-roles", "cant-find-record"],
  },
  {
    slug: "how-it-works",
    title: "How the program works, start to finish",
    summary: "The whole journey from a first enquiry to finished, paid-for work.",
    category: "process",
    body: [
      p(
        `Everything in the program follows one journey. You do not have to use every step: stop wherever your business stops.`,
      ),
      flow(
        "From first enquiry to finished work",
        { title: N.Prospect, text: "Someone who might buy. You log them and make contact." },
        {
          title: `${N.Customer} and ${N.person}`,
          text: `When they are serious, **Turn into a customer**. You keep one record for the business and one for the person.`,
        },
        { title: N.Deal, text: "What you are trying to sell, with a stage and an expected value." },
        { title: "Quote", text: "A priced offer with lines, tax and a PDF you can email." },
        { title: "Order", text: "Created when the quote is won." },
        {
          title: N.Job,
          text: "The work you will do. It can come from a support request or on its own.",
        },
        { title: N.Visit, text: `A team member booked on the ${N.Schedule} to do the work.` },
      ),
      p(
        `Alongside this, a ${N.request} records a customer asking for help, with a due time. A ${N.request} can result in a ${N.job}.`,
      ),
      note(
        `Every record keeps its history: who created or changed it and when. Notes, calls, tasks and appointments are attached to the record they are about, so the story of a ${N.customer} is in one place.`,
      ),
    ],
    related: ["sales-process", "service-process", "record-lifecycles", "who-can-do-what"],
  },
  {
    slug: "sales-process",
    title: "The sales process",
    summary: `From ${N.prospect} to won ${N.deal} and an order, with who does what.`,
    category: "process",
    body: [
      steps(
        `A salesperson adds a [${N.prospect}](/app/help/prospects) and marks them contacted after the first call.`,
        `When they are interested, **Turn into a customer**. The program makes the ${N.customer}, the ${N.person} and a ${N.deal}, and warns you first if it finds likely duplicates. See [Duplicates](/app/help/duplicates).`,
        `Move the ${N.deal} through its stages: Qualify, Develop, Propose, Close. See [The deal pipeline](/app/help/pipeline).`,
        `At Propose, build a [quote](/app/help/quotes) from your products. Edit it while it is a draft, then activate it and email the PDF.`,
        `If the customer says yes, mark the quote **won**. The program creates the [order](/app/help/orders) and can close the ${N.deal} as won in the same step.`,
        `If they say no, mark the quote **lost** and close the ${N.deal} as lost with a reason, so you can see why you lose work.`,
      ),
      tip(
        `Closed ${N.prospects} and lost ${N.deals} are kept, not deleted. You can reactivate or reopen them if things change.`,
      ),
    ],
    related: ["quote-lifecycle", "pipeline", "dashboards"],
  },
  {
    slug: "service-process",
    title: "The service process",
    summary: `From a ${N.request} to a finished ${N.job}, and who does each part.`,
    category: "process",
    body: [
      steps(
        `A customer service rep logs a [${N.request}](/app/help/support-requests). Its priority sets how long you have.`,
        `If someone needs to go out, **Turn into a job** to create a [${N.job}](/app/help/jobs) with a description and the parts and labour expected.`,
        `A dispatcher books a [visit](/app/help/scheduling-visits) for a ${N.member} on the [${N.Schedule}](/app/help/schedule-board). The program stops two visits overlapping for the same person.`,
        `The ${N.member} opens [My Visits](/app/help/technician-visits), sets off, starts and completes the visit.`,
        `Record [parts and labour](/app/help/parts-and-labour). When the work is complete, the ${N.job} is completed, then posted.`,
        `Resolve the ${N.request}, describing how it was fixed.`,
      ),
      note(
        `A ${N.request} cannot be resolved while any of its ${N.jobs} are still open. This keeps you from closing something that is not finished.`,
      ),
    ],
    related: ["record-lifecycles", "due-times", "who-can-do-what"],
  },
  {
    slug: "record-lifecycles",
    title: "Statuses and what they allow",
    summary: `The steps a ${N.job}, ${N.visit}, ${N.request}, quote and ${N.prospect} go through.`,
    category: "process",
    body: [
      p(
        "Each kind of record moves through fixed steps. The program only offers the next steps that make sense, so work cannot jump to a wrong state. These tables come from the program's own rules.",
      ),
      h(N.Job),
      table(
        `What a ${N.job} can move to`,
        ["Status", "Can move to"],
        WO_STATUSES.map((st) => [say(st), nextWords(nextStatuses(st))]),
      ),
      list(
        "A completed or posted job can no longer be edited. A posted job feeds invoicing and is final.",
      ),
      h(N.Visit),
      table(
        `What a ${N.visit} can move to`,
        ["Status", "Can move to"],
        BOOKING_STATUSES.map((st) => [say(st), nextWords(nextBookingStatuses(st))]),
      ),
      h(`${N.Request}`),
      table(
        "Time allowed by priority",
        ["Priority", "Due within"],
        [
          ["Urgent", `${SLA_HOURS.urgent} hours`],
          ["High", `${SLA_HOURS.high} hours`],
          ["Normal", `${SLA_HOURS.normal} hours`],
          ["Low", `${SLA_HOURS.low} hours`],
        ],
      ),
      h(N.Prospect),
      list(
        "**New**, then **Contacted**, then turned into a customer or **Closed** with a reason.",
        "A prospect that has been turned into a customer or closed cannot be edited. Reactivate a closed one to work it again.",
      ),
    ],
    related: ["quote-lifecycle", "jobs", "technician-visits"],
  },
  {
    slug: "quote-lifecycle",
    title: "The life of a quote",
    summary: "Draft, active, won, lost or revised, and what each lets you do.",
    category: "process",
    body: [
      table(
        "Quote statuses",
        ["Status", "Meaning", "What you can do"],
        [
          ["Draft", "Being written", "Edit lines and details; activate it"],
          [
            "Active",
            "Sent or ready to send",
            "Mark won, mark lost, or revise it. Lines are locked.",
          ],
          ["Revised", "Replaced by a newer copy", "Nothing: look at the new draft instead"],
          ["Won", "The customer said yes", "An order has been created"],
          ["Lost", "The customer said no", "Nothing: kept for your records"],
        ],
      ),
      p(
        "Locking an active quote means the customer is never looking at a different price than the one you hold. To change one, **revise** it: the old one is kept as Revised and a new draft is made with a new number.",
      ),
    ],
    related: ["quotes", "orders", "quote-email"],
  },
  {
    slug: "day-in-the-life",
    title: "A day in the life, by role",
    summary: "What each kind of person does in the program on a normal day.",
    category: "process",
    body: [
      h("Owner or administrator (System Administrator)"),
      list(
        "Looks at the dashboard for open deals, requests and visits.",
        "Adds people and chooses their role. See [Users and roles](/app/help/users-roles).",
        "Sets pricing, tax rates and the logo.",
      ),
      h("Sales manager and salesperson"),
      list(
        `Works through "My Open ${N.Prospects}", logging notes after each call.`,
        `Turns good ${N.prospects} into ${N.customers} and moves ${N.deals} through the pipeline.`,
        "Builds and emails quotes. A salesperson sees their own records; a sales manager sees everyone's.",
      ),
      h("Customer service rep"),
      list(
        `Logs ${N.requests} as they come in and watches the due-time badges.`,
        `Turns problems into ${N.jobs} and books ${N.visits}.`,
      ),
      h("Field technician"),
      list(
        `Opens My Visits on a phone, sees the day's ${N.visits} and addresses.`,
        "Sets off, starts, adds parts and labour, and completes each visit.",
      ),
      h("Read-only"),
      list(
        "Can look at everything allowed but not change anything. Good for an accountant or investor.",
      ),
      tip("What each role can reach in detail is on [Who can do what](/app/help/who-can-do-what)."),
    ],
    related: ["who-can-do-what", "first-day"],
  },
  {
    slug: "your-data",
    title: "Where your data lives and who can see it",
    summary: "How your business is kept separate, protected and recorded.",
    category: "process",
    body: [
      list(
        "**Your business is separate.** Every record belongs to your business and the database itself refuses to show it to anyone else. This does not depend on a screen hiding something.",
        "**Roles are checked on the server.** A person cannot reach something by typing a web address if their role does not allow it.",
        "**Passwords are never stored.** Only a scrambled form that cannot be turned back is kept.",
        "**Changes are recorded.** The program keeps who changed what and when.",
        "**Your data can be exported.** See [Export to Excel](/app/help/export).",
      ),
      note(
        "Your license key activates your business and decides how many people (seats) you can add. See [Seats and your license](/app/help/seats-license).",
      ),
    ],
    related: ["who-can-do-what", "seats-license", "export"],
  },
];
