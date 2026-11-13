import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { incident, securityRole } from "@/db/schema";
import { localDate } from "@/lib/board";
import { zonedToUtc } from "@/lib/tz";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { createAccount, createContact } from "@/server/domain/accounts";
import { addActivity, addNote, completeActivity } from "@/server/domain/activities";
import { createBooking, setBookingStatus } from "@/server/domain/bookings";
import { createProduct, createTaxRate } from "@/server/domain/catalog";
import { convertToWorkOrder, createCase, resolveCase, setCaseStatus } from "@/server/domain/cases";
import { buildCtx, type Ctx } from "@/server/domain/context";
import { createLead, disqualifyLead, markLeadContacted } from "@/server/domain/leads";
import {
  closeAsLost,
  createOpportunity,
  moveStage,
  updateOpportunity,
} from "@/server/domain/opportunities";
import { activateQuote, addLine, createQuote, winQuote } from "@/server/domain/quotes";
import { createCharacteristic, createResource } from "@/server/domain/resources";
import { addLabour, addPart } from "@/server/domain/work-order-lines";
import { createWorkOrder } from "@/server/domain/work-orders";
import { mintLicense } from "@/server/licensing/mint";
import type { Email } from "@/server/email/mailer";

// A realistic demo business ("Summit Plumbing & Heating"): a few people in different roles,
// customers, a sales pipeline, quotes and orders, support cases, jobs, a crew and a schedule.
// Everything goes through the same domain functions the app uses, so it obeys every rule (stage
// requirements, numbering, permissions, audit) and the data is exactly what a real business
// would have. Dates are relative to "now", so the dashboards and calendar look alive whenever it
// is run. Each run creates a NEW business; nothing existing is touched.

export type DemoOptions = {
  ownerEmail: string;
  password: string;
  /** Domain for the staff addresses, e.g. "demo-ab12cd.example". Must be unique per run. */
  emailDomain: string;
  companyName?: string;
  ownerName?: string;
  timeZone?: string;
  /** Shifts the dated items (visits, tasks, close dates). Winning a deal still stamps the real date. */
  now?: Date;
  /** Called at the start of each phase. May be async; the seed waits for it. */
  log?: (message: string) => void | Promise<void>;
};

export type DemoResult = {
  tenantId: string;
  companyName: string;
  licenseKey: string;
  people: { role: string; name: string; email: string }[];
  counts: Record<string, number>;
};

const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function must<T extends { ok: boolean }>(label: string, r: T): Extract<T, { ok: true }> {
  if (!r.ok) {
    const f = r as unknown as { code?: string; message?: string };
    throw new Error(`Demo seed failed at "${label}": ${f.code ?? "?"} ${f.message ?? ""}`);
  }
  return r as Extract<T, { ok: true }>;
}

const rand = () => randomBytes(3).toString("hex");
const DAY = 86_400_000;

const STAFF = [
  { role: "Sales Manager", name: "Taylor Brooks" },
  { role: "Salesperson", name: "Morgan Lee" },
  { role: "Customer Service Rep", name: "Casey Nguyen" },
  { role: "Field Technician", name: "Riley Ortiz" },
  { role: "Field Technician", name: "Sam Patel" },
] as const;

const CUSTOMERS = [
  ["Maple Street Apartments", "Property management", "customer"],
  ["Harbor View Dental", "Healthcare", "customer"],
  ["Cedar Ridge School District", "Education", "customer"],
  ["Fernandez Family Bakery", "Food service", "customer"],
  ["Brightside Daycare", "Childcare", "customer"],
  ["Oakwood Property Management", "Property management", "customer"],
  ["Riverbend Brewing Co.", "Food service", "customer"],
  ["Lakeshore Fitness", "Fitness", "customer"],
  ["Pine & Co. Law Offices", "Professional services", "prospect"],
  ["Greenfield Community Church", "Non-profit", "prospect"],
  ["Northgate Medical Group", "Healthcare", "prospect"],
  ["Sunrise Senior Living", "Healthcare", "prospect"],
] as const;

const PEOPLE = [
  ["Dana", "Whitfield", "Property manager"],
  ["Luis", "Ramirez", "Owner"],
  ["Priya", "Natarajan", "Office manager"],
  ["Greg", "Holloway", "Facilities director"],
  ["Mei", "Chen", "Practice manager"],
  ["Tom", "Okafor", "Operations"],
  ["Hannah", "Berg", "Director"],
  ["Marcus", "Reed", "Owner"],
] as const;

const PRODUCTS = [
  ["SVC-CALL", "Service call (first hour)", "service", 12500],
  ["SVC-HOUR", "Labour hour", "service", 9500],
  ["SVC-DRAIN", "Drain cleaning", "service", 18500],
  ["SVC-TUNE", "AC tune-up", "service", 14900],
  ["SVC-BOILER", "Boiler inspection", "service", 22000],
  ["WH-40", "Water heater, 40 gal", "product", 118000],
  ["PIPE-CU10", "Copper pipe, 10 ft", "product", 4200],
  ["FLT-16", "Furnace filter, 16x25", "product", 1850],
  ["THERM-S", "Smart thermostat", "product", 17900],
  ["FAUCET-K", "Kitchen faucet", "product", 21900],
] as const;

const LEADS = [
  ["Alvarez", "Alvarez Residence", "web", "hot", 450000],
  ["Brennan", "Brennan Auto Repair", "referral", "warm", 800000],
  ["Cho", "Cho's Noodle House", "web", "warm", 320000],
  ["Dubois", "Dubois Dental", "trade_show", "hot", 1500000],
  ["Evans", "Evans Storage", "web", "cold", 90000],
  ["Fischer", "Fischer Bakery", "referral", "warm", 270000],
  ["Gupta", "Gupta Realty", "phone", "warm", 600000],
  ["Hughes", "Hughes Landscaping", "web", "cold", 120000],
  ["Ibarra", "Ibarra Tire & Lube", "referral", "hot", 940000],
  ["Jensen", "Jensen Orthodontics", "trade_show", "warm", 1100000],
  ["Kowalski", "Kowalski Deli", "web", "cold", 60000],
  ["Lindqvist", "Lindqvist Salon", "phone", "warm", 210000],
  ["Mbeki", "Mbeki Imports", "web", "cold", 80000],
  ["Novak", "Novak Pharmacy", "referral", "hot", 760000],
] as const;

export async function seedDemo(o: DemoOptions): Promise<DemoResult> {
  const log = async (m: string) => void (await o.log?.(m));
  const now = o.now ?? new Date();
  const tz = o.timeZone ?? "America/New_York";
  const companyName = o.companyName ?? "Summit Plumbing & Heating";
  const ymd = (days: number) => localDate(new Date(now.getTime() + days * DAY), tz);
  /** A local wall-clock time on a day relative to today, as a UTC instant. */
  const at = (days: number, hhmm: string) => zonedToUtc(`${ymd(days)}T${hhmm}`, tz)!.toISOString();

  // ── The business and its people ──────────────────────────────────────────────────────────
  await log("Creating the business and its owner…");
  const { key } = await mintLicense({ tier: "team" });
  const act = await activateLicense({
    licenseKey: key,
    companyName,
    ownerName: o.ownerName ?? "Jordan Rivers",
    ownerEmail: o.ownerEmail,
    password: o.password,
    confirmPassword: o.password,
    timeZone: tz,
    currency: "USD",
    ip: `demo-seed-${rand()}`,
  });
  if (!act.ok) throw new Error(`Demo seed failed at "activation": ${act.code}`);
  const tenantId = act.tenantId;
  const owner = await buildCtx(tenantId, act.userId);

  await log("Adding the team…");
  const people = [
    { role: "System Administrator", name: o.ownerName ?? "Jordan Rivers", email: o.ownerEmail },
  ];
  const ctxByName: Record<string, Ctx> = {};
  for (const s of STAFF) {
    const email = `${s.name.split(" ").join(".").toLowerCase()}@${o.emailDomain}`;
    const [role] = await withTenant(tenantId, (tx) =>
      tx.select({ id: securityRole.id }).from(securityRole).where(eq(securityRole.name, s.role)),
    );
    const mail: Email[] = [];
    await inviteUser(
      { tenantId, inviterId: act.userId, email, roleId: role!.id },
      { send: async (e) => void mail.push(e), appUrl: "https://demo.invalid" },
    );
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail[0]!.text)?.[1];
    if (!token) throw new Error(`Demo seed failed at "invite ${s.name}": no token`);
    const accepted = await acceptInvitation({
      token,
      values: { fullName: s.name, password: o.password, confirmPassword: o.password },
      ip: `demo-seed-${rand()}`,
    });
    if (!accepted.ok) throw new Error(`Demo seed failed at "accept ${s.name}": ${accepted.code}`);
    ctxByName[s.name] = await buildCtx(tenantId, accepted.userId);
    people.push({ role: s.role, name: s.name, email });
  }
  const manager = ctxByName["Taylor Brooks"]!;
  const sales = ctxByName["Morgan Lee"]!;
  const support = ctxByName["Casey Nguyen"]!;
  const riley = ctxByName["Riley Ortiz"]!;
  const sam = ctxByName["Sam Patel"]!;

  // ── Catalog ─────────────────────────────────────────────────────────────────────────────
  await log("Building the catalog…");
  const tax = must(
    "tax rate",
    await createTaxRate(owner, { name: "PA sales tax", rateBp: 600 }),
  ).taxRate;
  const prod: Record<string, string> = {};
  for (const [sku, name, type, cents] of PRODUCTS) {
    const p = must(
      `product ${sku}`,
      await createProduct(owner, {
        sku,
        name,
        productType: type,
        listPriceCents: cents,
        ...(type === "product" ? { taxRateId: tax.id } : {}),
      }),
    ).product;
    prod[sku] = p.id;
  }

  // ── Customers and people ────────────────────────────────────────────────────────────────
  await log("Adding customers…");
  const accounts: { id: string; name: string; contactId: string }[] = [];
  for (const [i, [name, industry, rel]] of CUSTOMERS.entries()) {
    const a = must(
      `account ${name}`,
      await createAccount(i % 2 ? sales : manager, {
        name,
        industry,
        relationshipType: rel,
        phone: `412-555-01${String(10 + i)}`,
        city: "Pittsburgh",
        state: "PA",
        paymentTerms: "Net 30",
      }),
    ).account;
    const [first, last, title] = PEOPLE[i % PEOPLE.length]!;
    const c = must(
      `contact ${first}`,
      await createContact(i % 2 ? sales : manager, {
        firstName: first,
        lastName: `${last}`,
        jobTitle: title,
        parentAccountId: a.id,
        email: `${first}.${last}.${i}@${o.emailDomain}`.toLowerCase(),
        businessPhone: `412-555-02${String(10 + i)}`,
        preferredContactMethod: i % 3 ? "email" : "phone",
      }),
    ).contact;
    accounts.push({ id: a.id, name, contactId: c.id });
  }

  // ── Leads ───────────────────────────────────────────────────────────────────────────────
  await log("Adding prospects…");
  const leadIds: string[] = [];
  const leadOwner: Ctx[] = [];
  for (const [i, [last, company, source, rating, value]] of LEADS.entries()) {
    const who = i % 3 ? sales : manager;
    const l = must(
      `lead ${last}`,
      await createLead(who, {
        firstName: ["Sam", "Pat", "Chris", "Alex", "Jamie"][i % 5],
        lastName: last,
        companyName: company,
        email: `${last.toLowerCase()}@${o.emailDomain}`,
        phone: `412-555-03${String(10 + i)}`,
        leadSource: source,
        rating,
        estValueCents: value,
        city: "Pittsburgh",
        state: "PA",
      }),
    ).lead;
    leadIds.push(l.id);
    leadOwner.push(who);
  }
  for (const [i, id] of leadIds.slice(0, 6).entries()) {
    must("contacted", await markLeadContacted(leadOwner[i]!, id));
  }
  must("disqualify", await disqualifyLead(leadOwner[4]!, leadIds[4]!, "cannot_contact"));
  must("disqualify", await disqualifyLead(leadOwner[10]!, leadIds[10]!, "no_longer_interested"));

  // ── Opportunities, quotes and orders ────────────────────────────────────────────────────
  await log("Building the pipeline…");
  const deals = [
    ["Water heater replacement, Maple St", 0, 118000, 14, 0],
    ["Annual maintenance contract", 1, 480000, 30, 0],
    ["Boiler overhaul", 2, 2400000, 45, 1],
    ["Kitchen remodel plumbing", 3, 850000, 21, 1],
    ["Backflow testing programme", 4, 360000, 10, 2],
    ["Restroom retrofit", 5, 1900000, 35, 2],
    ["Emergency generator hookup", 6, 640000, 7, 3],
    ["New-build rough-in", 7, 3200000, 28, 3],
  ] as const;
  const oppIds: string[] = [];
  const oppOwner: Ctx[] = [];
  for (const [name, ai, cents, closeIn, stage] of deals) {
    const who = ai % 2 ? sales : manager;
    const a = accounts[ai]!;
    const opp = must(
      `opportunity ${name}`,
      await createOpportunity(who, {
        name,
        customerAccountId: a.id,
        estRevenueCents: cents,
        estCloseDate: ymd(closeIn),
      }),
    ).opportunity;
    oppIds.push(opp.id);
    oppOwner.push(who);
    const full = {
      customerContactId: a.contactId,
      budgetCents: Math.round(cents * 1.1),
      purchaseTimeframe: "This quarter",
      proposalDelivered: true,
    };
    if (stage >= 1) {
      must("move", await moveStage(who, opp.id, "develop"));
      must("details", await updateOpportunity(who, opp.id, full));
    }
    if (stage >= 2) must("move", await moveStage(who, opp.id, "propose"));
    if (stage >= 3) must("move", await moveStage(who, opp.id, "close"));
  }

  // Two won through the quote -> order flow, so "won this quarter" has real revenue.
  const wonDeals = [
    [
      "Furnace install, Oakwood",
      5,
      [
        ["WH-40", 4],
        ["SVC-HOUR", 42],
        ["PIPE-CU10", 30],
      ],
    ],
    [
      "Fixture upgrade, Riverbend",
      6,
      [
        ["FAUCET-K", 14],
        ["SVC-HOUR", 28],
        ["PIPE-CU10", 24],
      ],
    ],
  ] as const;
  let orders = 0;
  for (const [name, ai, lines] of wonDeals) {
    const a = accounts[ai]!;
    const opp = must(
      `won opp ${name}`,
      await createOpportunity(manager, {
        name,
        customerAccountId: a.id,
        estRevenueCents: 1,
        estCloseDate: ymd(-3),
      }),
    ).opportunity;
    const q = must(
      `quote ${name}`,
      await createQuote(manager, {
        name,
        opportunityId: opp.id,
        customerAccountId: a.id,
        customerContactId: a.contactId,
        paymentTerms: "Net 30",
      }),
    ).quote;
    for (const [sku, qty] of lines) {
      must("line", await addLine(manager, q.id, { productId: prod[sku], quantity: qty }));
    }
    must("activate", await activateQuote(manager, q.id));
    must("win", await winQuote(manager, q.id, { closeOpportunity: true }));
    orders++;
  }
  // One sent (active) quote and one draft, and one lost deal with a reason.
  const sales2 = oppOwner[2]!; // whoever owns the boiler deal
  const sent = must(
    "sent quote",
    await createQuote(sales2, {
      name: "Boiler overhaul: proposal",
      opportunityId: oppIds[2],
      customerAccountId: accounts[2]!.id,
      customerContactId: accounts[2]!.contactId,
      discountPercentBp: 500,
    }),
  ).quote;
  must("line", await addLine(sales2, sent.id, { productId: prod["SVC-BOILER"], quantity: 3 }));
  must("line", await addLine(sales2, sent.id, { productId: prod["SVC-HOUR"], quantity: 18 }));
  must("activate", await activateQuote(sales2, sent.id));
  const draftBy = oppOwner[5]!;
  const draft = must(
    "draft quote",
    await createQuote(draftBy, {
      name: "Restroom retrofit: draft",
      opportunityId: oppIds[5],
      customerAccountId: accounts[5]!.id,
      freightCents: 4500,
    }),
  ).quote;
  must("line", await addLine(draftBy, draft.id, { productId: prod["FAUCET-K"], quantity: 6 }));
  const lost = must(
    "lost opp",
    await createOpportunity(sales, {
      name: "Warehouse heating",
      customerAccountId: accounts[1]!.id,
      estRevenueCents: 1_400_000,
      estCloseDate: ymd(-10),
    }),
  ).opportunity;
  must("lost", await closeAsLost(sales, lost.id, { reason: "Went with a cheaper bid" }));

  // ── Service: crew, support cases, jobs and the schedule ────────────────────────────────
  await log("Setting up the crew…");
  const skill: Record<string, string> = {};
  for (const n of ["Licensed plumber", "Gas fitter", "HVAC certified"]) {
    skill[n] = must(`skill ${n}`, await createCharacteristic(owner, { name: n })).characteristic.id;
  }
  const rRiley = must(
    "resource Riley",
    await createResource(owner, {
      name: "Riley Ortiz",
      userId: riley.userId,
      color: "#0f6cbd",
      skillIds: [skill["Licensed plumber"]!, skill["Gas fitter"]!],
    }),
  ).resource;
  const rSam = must(
    "resource Sam",
    await createResource(owner, {
      name: "Sam Patel",
      userId: sam.userId,
      color: "#107c10",
      skillIds: [skill["Licensed plumber"]!, skill["HVAC certified"]!],
    }),
  ).resource;
  const rVan = must(
    "resource van",
    await createResource(owner, {
      name: "Van 2 (drain crew)",
      resourceType: "crew",
      color: "#bc4b09",
    }),
  ).resource;

  await log("Creating support cases and jobs…");
  const caseDefs = [
    ["No hot water, Brightside Daycare", 4, "urgent", "phone"],
    ["Leaking faucet in unit 3B", 0, "normal", "web"],
    ["Furnace making noise", 1, "high", "phone"],
    ["Slow drain in kitchen", 3, "normal", "email"],
    ["Request: annual boiler inspection", 5, "low", "email"],
    ["Low water pressure, second floor", 2, "high", "phone"],
    ["Quote follow-up question", 6, "low", "email"],
    ["Toilet running constantly", 7, "normal", "web"],
  ] as const;
  const caseIds: string[] = [];
  for (const [title, ai, priority, origin] of caseDefs) {
    const k = must(
      `case ${title}`,
      await createCase(support, {
        title,
        customerAccountId: accounts[ai]!.id,
        customerContactId: accounts[ai]!.contactId,
        priority,
        origin,
        caseType: "problem",
        description: "Reported by the customer; see the timeline for updates.",
      }),
    ).case;
    caseIds.push(k.id);
  }
  const jobFromCase = async (i: number, minutes: number) =>
    must(
      `job from case ${i}`,
      await convertToWorkOrder(support, caseIds[i]!, { estDurationMin: minutes }),
    ).workOrder;
  const jobHeater = await jobFromCase(0, 120);
  const jobFurnace = await jobFromCase(2, 90);
  const jobPressure = await jobFromCase(5, 60);
  const standalone = async (
    title: string,
    type: "repair" | "maintenance" | "installation" | "inspection",
    ai: number,
    min: number,
  ) =>
    must(
      `job ${title}`,
      await createWorkOrder(support, {
        title,
        workOrderType: type,
        serviceAccountId: accounts[ai]!.id,
        priority: "normal",
        estDurationMin: min,
        city: "Pittsburgh",
        state: "PA",
      }),
    ).workOrder;
  const jobTune = await standalone("Spring AC tune-up, Lakeshore Fitness", "maintenance", 7, 60);
  const jobInstall = await standalone("Install water heater, Maple St", "installation", 0, 180);
  const jobInspect = await standalone("Boiler inspection, Cedar Ridge", "inspection", 2, 120);
  const jobDone = await standalone("Replace kitchen faucet, Harbor View", "repair", 1, 60);
  await standalone("Unscheduled: gutter drain check", "inspection", 3, 45); // left for the "waiting to schedule" pane

  // Support cases move on: some resolved, one waiting on the customer, one past its due time.
  must(
    "resolve",
    await resolveCase(support, caseIds[1]!, { resolution: "Replaced the cartridge." }),
  );
  must(
    "resolve",
    await resolveCase(support, caseIds[6]!, { resolution: "Sent the quote summary." }),
  );
  must(
    "resolve",
    await resolveCase(support, caseIds[7]!, { resolution: "Replaced the flapper valve." }),
  );
  must("hold", await setCaseStatus(support, caseIds[4]!, "waiting_on_customer"));
  await withTenant(tenantId, (tx) =>
    tx
      .update(incident)
      .set({ slaDueAt: new Date(now.getTime() - 3 * 3_600_000) })
      .where(eq(incident.id, caseIds[3]!)),
  ); // an open case that is already late, so the SLA tile has something to show

  await log("Scheduling visits…");
  const book = async (
    job: { id: string },
    r: { id: string },
    day: number,
    from: string,
    to: string,
  ) =>
    must(
      `booking ${job.id}`,
      await createBooking(owner, {
        workOrderId: job.id,
        resourceId: r.id,
        startAt: at(day, from),
        endAt: at(day, to),
      }),
    ).booking;
  await book(jobHeater, rRiley, 0, "08:00", "10:00");
  await book(jobFurnace, rRiley, 0, "13:00", "14:30");
  await book(jobPressure, rSam, 0, "09:30", "10:30");
  await book(jobTune, rSam, 1, "10:00", "11:00");
  await book(jobInstall, rRiley, 1, "08:00", "11:00");
  await book(jobInspect, rVan, 2, "09:00", "11:00");

  // A finished visit from yesterday: travelled, worked, parts and labour logged, customer signed.
  const done = await book(jobDone, rRiley, -1, "09:00", "10:00");
  for (const status of ["travelling", "in_progress"]) {
    must(status, await setBookingStatus(riley, done.id, status));
  }
  must("part", await addPart(riley, jobDone.id, { productId: prod["FAUCET-K"], quantity: 1 }));
  must(
    "labour",
    await addLabour(support, jobDone.id, {
      description: "Replace faucet and test",
      minutes: 55,
      hourlyRateCents: 9500,
      resourceId: rRiley.id,
    }),
  );
  must(
    "complete",
    await setBookingStatus(riley, done.id, "completed", {
      signatureDataUrl: SIGNATURE,
      signedByName: "Mei Chen",
      notes: "Replaced the faucet; no leaks after a 10-minute test.",
    }),
  );

  // ── Activities and notes ────────────────────────────────────────────────────────────────
  await log("Adding activities…");
  const tasks = [
    [sales, "Call Dubois Dental back", 1, "high"],
    [sales, "Send maintenance contract draft", 2, "normal"],
    [manager, "Review boiler overhaul proposal", 1, "normal"],
    [manager, "Approve parts order", 3, "low"],
    [support, "Follow up: waiting on customer approval", 2, "normal"],
    [owner, "Review this month's profit report", 2, "normal"],
    [owner, "Renew the contractor's licence", 9, "high"],
    [owner, "Order truck stock: copper fittings", 4, "low"],
  ] as const;
  for (const [who, subject, days, priority] of tasks) {
    must(
      "task",
      await addActivity(who, { activityType: "task", subject, dueAt: at(days, "15:00"), priority }),
    );
  }
  must(
    "appointment",
    await addActivity(manager, {
      activityType: "appointment",
      subject: "Site walk-through, Sunrise Senior Living",
      scheduledStart: at(1, "13:00"),
      scheduledEnd: at(1, "14:30"),
      regardingType: "account",
      regardingId: accounts[11]!.id,
    }),
  );
  must(
    "appointment",
    await addActivity(oppOwner[2]!, {
      activityType: "appointment",
      subject: "Quote review with Cedar Ridge",
      scheduledStart: at(3, "10:00"),
      scheduledEnd: at(3, "11:00"),
      regardingType: "opportunity",
      regardingId: oppIds[2]!,
    }),
  );
  const call = must(
    "call",
    await addActivity(leadOwner[1]!, {
      activityType: "phone_call",
      subject: "Intro call with Brennan Auto Repair",
      direction: "outgoing",
      regardingType: "lead",
      regardingId: leadIds[1]!,
    }),
  );
  must("complete", await completeActivity(leadOwner[1]!, call.activity.id));
  must(
    "note",
    await addNote(manager, {
      regardingType: "opportunity",
      regardingId: oppIds[2]!,
      body: "Facilities director wants the work done over the summer break. Budget approved at the board meeting.",
    }),
  );
  must(
    "note",
    await addNote(support, {
      regardingType: "case",
      regardingId: caseIds[0]!,
      body: "Customer says the daycare has no hot water for hand-washing. Treat as urgent; dispatching Riley.",
    }),
  );

  const counts = {
    people: people.length,
    products: PRODUCTS.length,
    accounts: accounts.length,
    contacts: accounts.length,
    leads: LEADS.length,
    opportunities: deals.length + wonDeals.length + 1,
    quotes: wonDeals.length + 2,
    orders,
    cases: caseDefs.length,
    jobs: 8,
    resources: 3,
  };
  await log("Done.");
  return { tenantId, companyName, licenseKey: key, people, counts };
}
