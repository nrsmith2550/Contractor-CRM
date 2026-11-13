import { REQUIRED_TO_LEAVE, STAGE_PROBABILITY } from "@/server/domain/bpf";
import { N } from "../names";
import { flow, list, note, p, steps, table, tip, warning, h, type Article } from "../types";

const need = (stage: keyof typeof REQUIRED_TO_LEAVE) =>
  REQUIRED_TO_LEAVE[stage].map((r) => r.label).join(", ");

export const SALES: Article[] = [
  {
    slug: "prospects",
    title: `Working with ${N.prospects}`,
    summary: `Add a ${N.prospect}, follow up, and close it if it goes nowhere.`,
    category: "sales",
    body: [
      p(
        `A ${N.prospect} is someone who might buy but has not yet. Keep them here until you know. When they say yes, [turn them into a ${N.customer}](/app/help/turn-into-customer).`,
      ),
      h("Add a prospect"),
      steps(
        `Open [${N.Prospects}](/app/prospects) and choose **+ New**.`,
        "Fill in at least a **last name**. The topic fills itself from the company and last name if you leave it blank.",
        "Add what you know: company, email, phone, **source** (web, phone, referral, trade show, email, other), **rating** (hot, warm, cold) and the estimated value.",
        "Choose **Save**.",
      ),
      h("Follow up"),
      list(
        "**Mark contacted** once you have reached out. It is only offered while the prospect is new.",
        "Add a note from the timeline at the bottom of the record: see [Notes, calls, tasks and appointments](/app/help/notes-and-appointments).",
        "Use the views at the top of the list: *My Open Prospects*, *All Open Prospects*, *Prospects Added This Week*, *Closed Prospects*.",
      ),
      h("When it goes nowhere"),
      steps(
        "Open the prospect and choose **Close prospect**.",
        "Pick a reason: lost to someone else, could not reach them, no longer interested, or cancelled.",
        "Choose **Confirm close**. It moves to *Closed Prospects*.",
      ),
      tip("Changed your mind? Open a closed prospect and choose **Reactivate**."),
      note(
        `Salespeople see and change their own ${N.prospects}. Sales managers and the owner see everyone's. See [Who can do what](/app/help/who-can-do-what).`,
      ),
    ],
    related: ["turn-into-customer", "import", "duplicates"],
  },
  {
    slug: "turn-into-customer",
    title: `Turning a ${N.prospect} into a ${N.customer}`,
    summary: `One click creates the ${N.customer}, the ${N.person} and a ${N.deal}.`,
    category: "sales",
    body: [
      steps(
        `Open the ${N.prospect}.`,
        "Choose **Turn into a customer**.",
        `You are taken to the new ${N.deal}, ready to work.`,
      ),
      p("In one step Clinch CRM creates:"),
      list(
        `a **${N.customer}** from the company (or the person's name if there is no company),`,
        `a **${N.person}** from the name, email and phone,`,
        `a **${N.deal}** to track the sale, with the estimated value carried over.`,
      ),
      p(`The ${N.prospect} stays on file, marked *Turned into a customer*.`),
      warning(
        `If a ${N.customer} or ${N.person} that looks the same already exists, you are shown the possible matches. Use the existing one, or continue and create a new one. This keeps your list free of doubles. See [A duplicate warning appeared](/app/help/duplicates).`,
      ),
    ],
    related: ["deals", "duplicates", "prospects"],
  },
  {
    slug: "deals",
    title: `${N.Deals} and the ${N.progressBar}`,
    summary: `Track a possible sale from first talk to won or lost.`,
    category: "sales",
    body: [
      p(
        `A ${N.deal} is a sale you are working on. The **${N.progressBar}** at the top shows where it is. Each stage asks for a few facts before you can move on, so nothing is forgotten.`,
      ),
      table(
        `What each stage needs before you can move on`,
        ["Stage", "You need to fill in", "Typical chance of winning"],
        [
          ["Qualify", need("qualify"), `${STAGE_PROBABILITY.qualify}%`],
          ["Develop", need("develop"), `${STAGE_PROBABILITY.develop}%`],
          ["Propose", need("propose"), `${STAGE_PROBABILITY.propose}%`],
          ["Close", "Close it as won or lost (below)", `${STAGE_PROBABILITY.close}%`],
        ],
      ),
      p(
        "The chance of winning is a starting guess for each stage. You can change it. The pipeline totals use it.",
      ),
      h("Move a deal along"),
      steps(
        "Open the deal and fill in the facts for the current stage.",
        "Choose **Move to develop** (or the next stage). If something is missing, you are told exactly what.",
      ),
      note("Stages go one at a time forward. Going back is always allowed."),
      h("Win or lose"),
      list(
        "**Close as won:** enter the actual revenue and date. The customer becomes a *Current customer*.",
        "**Close as lost:** give a reason (and the competitor if you know). It stays on record for next time.",
        "**Reopen** brings a closed deal back to work on.",
      ),
      tip(
        `Won a quote? [Winning the quote](/app/help/quotes) can close the ${N.deal} as won for you and creates the order.`,
      ),
    ],
    related: ["deal-products", "quotes", "pipeline"],
  },
  {
    slug: "deal-products",
    title: `Adding ${N.products} to a ${N.deal}`,
    summary: `List what the ${N.customer} is likely to buy and the revenue works itself out.`,
    category: "sales",
    body: [
      steps(
        `Open the ${N.deal}, find **${N.Products}** and choose **Add ${N.product}**.`,
        `Pick the ${N.product}, or **Write-in (not in your list)** for something one-off.`,
        "Set the quantity and, if you need to, the price.",
      ),
      list(
        `While a ${N.deal} has lines, its **estimated revenue** is their total. You do not type it in.`,
        `When you make a quote from the ${N.deal}, the lines are copied across.`,
        "Remove a line with the **Remove** button beside it.",
      ),
    ],
    related: ["quotes", "products-services"],
  },
  {
    slug: "quotes",
    title: "Making and sending a quote",
    summary: "Build a quote, send it, revise it, and turn it into an order when it is won.",
    category: "sales",
    body: [
      flow(
        "The life of a quote",
        { title: "Draft", text: "You build it. You can change anything." },
        { title: "Active", text: "Locked and ready to send as a PDF or email." },
        { title: "Won", text: "Accepted. An order is created." },
        { title: "Lost", text: "Declined. Kept on record." },
      ),
      h("Build the quote"),
      steps(
        `From a ${N.deal}, choose **+ New quote**, or open [New quote](/app/quotes/new) for a stand-alone one. The ${N.customer} details are copied from the ${N.deal}.`,
        `Give it a name and, if you like, choose a ${N.pricingList} so its prices come from there. Without one, each item's list price is used.`,
        `Add lines: pick a ${N.product}, or write one in. Set the quantity. The unit price and tax rate fill in from the item and can be changed.`,
        "Add a **discount** (a percentage or a fixed amount, not both) and **freight** if needed. Totals update as you go, to the cent.",
      ),
      h("Send it"),
      steps(
        "Choose **Activate quote**. It is now locked so what you send cannot change underneath the customer.",
        "Choose **Download PDF**, or **Email quote** to send it from here.",
      ),
      note(
        "Email and PDF are only available once a quote is active. If emailing fails, see [My quote email did not send](/app/help/quote-email).",
      ),
      h("Changes, wins and losses"),
      list(
        "**Revise** makes a new draft copy (the number gets -R1, -R2...) and marks the old one revised. Edit the copy and activate it.",
        "**Close as won** creates the order. Tick *Also close the deal as won* to close the deal in the same step.",
        "**Close as lost** records that it was declined.",
      ),
    ],
    related: ["orders", "pricing-lists", "tax-rates", "deals"],
  },
  {
    slug: "orders",
    title: "Orders: what happens when a quote is won",
    summary: "An order is the confirmed sale, created for you from the won quote.",
    category: "sales",
    body: [
      p(
        "When you close a quote as won, an order is created with the same lines and totals. It is a record of what was agreed and cannot be edited, so it always matches what the customer accepted.",
      ),
      list(
        "Find orders under [Orders](/app/orders). Each links back to its quote.",
        "If the quote came from a deal and you ticked the box, the deal is closed as won with the order total as the actual revenue.",
        "Need to change something? Do it before activating the quote, or revise and win a new one.",
      ),
    ],
    related: ["quotes"],
  },
  {
    slug: "pipeline",
    title: "The pipeline board",
    summary: `See all your open ${N.deals} by stage and move them.`,
    category: "sales",
    body: [
      p(
        `The [Pipeline](/app/pipeline) shows a column for each stage with a card for every open ${N.deal}. Totals show how much is in each stage.`,
      ),
      list(
        "Drag a card to another column, or use its **Move to** menu, to change its stage.",
        `A ${N.deal} missing the facts a stage needs will not move, and you are told what to fill in.`,
        "Open any card to work on the deal itself.",
      ),
      note(`Salespeople see their own ${N.deals}; managers see everyone's.`),
    ],
    related: ["deals"],
  },
];
