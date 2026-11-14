import { N } from "../names";
import { h, list, note, p, steps, table, tip, warning, type Article } from "../types";

export const CUSTOMERS: Article[] = [
  {
    slug: "customers",
    title: `${N.Customers}`,
    summary: `Add and keep up the businesses and people you work with.`,
    category: "customers",
    body: [
      p(
        `A ${N.customer} is a business or person you do business with, or hope to. Quotes, ${N.deals}, ${N.requests} and ${N.jobs} are all attached to a ${N.customer}, so everything about them is in one place.`,
      ),
      h("Add a customer"),
      steps(
        `Open [${N.Customers}](/app/customers) and choose **+ New**.`,
        `Enter the **${N.customer} name**. Add phone, website, industry and address if you have them.`,
        `Set the **relationship**: *Potential customer*, *Current customer*, *Vendor* or *Partner*.`,
        "Choose **Save**.",
      ),
      h("Useful fields"),
      list(
        `**Main ${N.person}:** the one to call first. Pick from the people you have added.`,
        `**Parent ${N.customer}:** for a branch or a company that belongs to a larger one.`,
        "**Payment terms** and **credit limit:** for your own reference and on quotes.",
      ),
      h("Views"),
      list(
        "*All Customers*, *Current Customers* and *Potential Customers* narrow the list.",
        `A ${N.customer} turns into a *Current customer* automatically when you win a ${N.deal}.`,
      ),
      note(
        "Everyone who works with customers sees all customers, so no one has to ask who already knows whom. Technicians can look but not change.",
      ),
    ],
    related: ["people", "turn-into-customer"],
  },
  {
    slug: "people",
    title: `${N.People}`,
    summary: `The individuals at your customers, and how to reach them.`,
    category: "customers",
    body: [
      steps(
        `Open [${N.People}](/app/people) and choose **+ New**.`,
        `Enter a last name, then choose the **${N.customer}** they belong to.`,
        "Add job title, email, mobile and business phone, and how they prefer to be contacted.",
        "Choose **Save**.",
      ),
      tip(
        `You can also add a ${N.person} when you [turn a ${N.prospect} into a ${N.customer}](/app/help/turn-into-customer): it is done for you.`,
      ),
      list(
        `Pick the right ${N.person} on a ${N.deal} (the decision-maker), a quote or a ${N.request}.`,
        "Email addresses are checked to make sure they are valid.",
      ),
    ],
    related: ["customers", "turn-into-customer"],
  },
  {
    slug: "notes-and-appointments",
    title: "Notes, calls, tasks and appointments",
    summary:
      "Keep a running record on any customer, log calls, set reminders and put meetings on the calendar.",
    category: "customers",
    body: [
      h("Notes"),
      p(
        `Every record has a **timeline** at the bottom: ${N.prospects}, ${N.customers}, ${N.deals}, ${N.requests} and ${N.jobs}. It shows what happened, newest first.`,
      ),
      steps(
        "Scroll to the timeline and type in **Add a note**.",
        "Choose **Add note**. Your name and the time are saved with it.",
      ),
      tip(
        "Write what you would want to know if a colleague took over tomorrow: what was said, what was promised, what is next.",
      ),
      h("Log a call"),
      steps(
        "On the record, above the timeline, choose **Call**.",
        "Say what the call was about, and whether you called them or they called you. Add notes if you like.",
        "Choose **Log call**. It goes on the timeline with the date and time.",
      ),
      h("Add a task"),
      p(
        "A task is something you need to do, with a due date. Choose **Task** above the timeline, say what needs doing, pick a due date and a priority, and choose **Add task**.",
      ),
      list(
        "A task that is past its due date shows **Overdue** on the timeline.",
        "When it is done, choose **Mark done**. It stays on the timeline, marked as completed.",
        "Your open tasks show on your dashboard and on the [calendar](/app/calendar) on the day they are due.",
      ),
      h("Appointments"),
      p(
        "Appointments are meetings or calls with a time. Add them on the [calendar](/app/calendar): click a day, or drag across a time, enter a subject and the start and end, and choose **Add appointment**. See [The calendar](/app/help/calendar).",
      ),
      warning(
        "Notes can be seen by everyone who can see the record. Keep private things (passwords, card numbers) out of them.",
      ),
    ],
    related: ["calendar"],
  },
  {
    slug: "linked-records",
    title: "Jumping between linked records",
    summary: `Click through from a ${N.customer} to their ${N.jobs}, orders and more, and back again.`,
    category: "customers",
    body: [
      p(
        "Records that belong together are linked, and every link is clickable. Open any record and look for **Related records** under its title.",
      ),
      table(
        "What you will find on each kind of record",
        ["Open a...", "...and you can click through to"],
        [
          [
            N.Customer,
            `${N.people}, ${N.deals}, quotes, orders, ${N.requests}, ${N.jobs}, ${N.visits}, and the ${N.prospect} they came from`,
          ],
          [N.Person, `Their ${N.customer}, ${N.deals}, quotes, orders and ${N.requests}`],
          [N.Prospect, `The ${N.customer}, ${N.person} and ${N.deal} it was turned into`],
          [
            N.Deal,
            `The ${N.customer} and ${N.person}, the ${N.prospect} it came from, its quotes and orders`,
          ],
          [
            "Quote",
            `The ${N.customer}, ${N.person} and ${N.deal}, its orders, and other versions of the quote`,
          ],
          ["Order", `The quote it came from, the ${N.customer}, ${N.person} and ${N.deal}`],
          [N.Request, `The ${N.customer} and ${N.person}, and its ${N.jobs}`],
          [N.Job, `Its ${N.request}, its ${N.visits} and its ${N.customer}`],
          [
            N.Visit,
            `Its ${N.job}, ${N.request} and ${N.customer}, and the job's other ${N.visits}`,
          ],
        ],
      ),
      steps(
        `Open a ${N.customer} from [${N.Customers}](/app/customers).`,
        "Under **Related records**, find the group you want, for example **Jobs**.",
        "Click a name to open it. Its own **Related records** let you keep going, or go straight back.",
      ),
      h("From a form"),
      p(
        `When a ${N.customer} or ${N.person} is filled in on a form, such as on a ${N.request}, an **Open** link sits beside it. Choose it to go straight to that record.`,
      ),
      note(
        "You only see links to records your role allows you to open. A group with nothing in it is left out, and the number beside each heading counts what is in it.",
      ),
    ],
    related: ["customers", "who-can-do-what", "finding-things"],
  },
];
