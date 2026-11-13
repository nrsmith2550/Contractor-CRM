import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { RESET_TTL_MS } from "@/server/auth/reset";
import { SESSION_TTL_MS } from "@/server/auth/session";
import { LOGIN_LIMIT } from "@/server/auth/rate-limit";
import { N } from "../names";
import { flow, list, note, p, steps, table, tip, warning, type Article } from "../types";

const minutes = (ms: number) => Math.round(ms / 60_000);
const days = (ms: number) => Math.round(ms / 86_400_000);

export const START: Article[] = [
  {
    slug: "welcome",
    title: "Welcome to Clinch CRM",
    summary: "What Clinch CRM is for, the main areas, and where to find help.",
    category: "start",
    body: [
      p(
        `Clinch CRM keeps everything about your customers in one place: who they are, what you've offered them, what they've bought, what they've asked for, and the work you've done for them. It is built for small businesses, contractors and small brands, so the words are plain and each step is short.`,
      ),
      flow(
        "How a customer moves through Clinch CRM",
        { title: N.Prospect, text: "Someone who might buy. You add them, follow up, and decide." },
        {
          title: `${N.Customer} and ${N.deal}`,
          text: `When they say yes, one click turns the ${N.prospect} into a ${N.customer}, a ${N.person} and a ${N.deal}.`,
        },
        { title: "Quote", text: `You price the ${N.deal} and send a quote by email or as a PDF.` },
        { title: "Order", text: "When they accept, winning the quote creates the order." },
        {
          title: `${N.Job} and ${N.visit}`,
          text: `For work on site, you create a ${N.job} and schedule a ${N.visit} for a ${N.member}.`,
        },
      ),
      table(
        "The main areas and what they are for",
        ["Area", "What it is for", "Where"],
        [
          ["Sales", `${N.Prospects}, ${N.deals}, quotes, orders and the pipeline.`, "Menu, Sales"],
          [
            "Service",
            `${N.Requests}, ${N.jobs}, the ${N.Schedule}, ${N.members} and ${N.visits}.`,
            "Menu, Service",
          ],
          [
            `${N.Customers} and ${N.people}`,
            "Everyone you do business with.",
            "Menu, Customers and people",
          ],
          [
            `${N.Products} and pricing`,
            "What you sell and what it costs.",
            "Menu, Products and pricing",
          ],
          ["My work", "The dashboards and your calendar.", "Menu, My work"],
          ["Settings", "Your team, tax rates, logo and service options.", "Menu, bottom"],
        ],
      ),
      tip(
        'Stuck? Use the **Help** link at the top of any screen. Search it in plain words, like "send a quote" or "can\'t sign in".',
      ),
    ],
    related: ["first-day", "finding-things", "words-we-use"],
  },
  {
    slug: "first-day",
    title: "Your first day: set up in about 30 minutes",
    summary: "The order to set things up in, so you can send your first quote the same day.",
    category: "start",
    who: "The business owner (System Administrator) does the setup steps.",
    body: [
      p("Do these in order. You can come back to any of them later."),
      steps(
        "**Activate your license.** Open the activation page, enter the license key from your purchase email, then your business name, your name, email, a password and your time zone. You are signed in as the owner.",
        "**Add your logo** under [Settings, Branding](/app/settings/branding). It appears on your quotes.",
        "**Set your tax rates** under [Settings, Tax rates](/app/settings/tax-rates), if you charge sales tax.",
        `**Add what you sell.** Under [${N.Products}](/app/products), add each product or service with its price. See [Products and services](/app/help/products-services).`,
        "**Invite your team** under [Settings, Users](/app/settings/users). Choose a role for each person. See [Adding people and choosing their role](/app/help/users-roles).",
        `**Bring in the people you already know.** [Import ${N.prospects} from a spreadsheet](/app/help/import), or add ${N.customers} one at a time.`,
        `**If you send people out to work,** add your ${N.members} under [${N.Members}](/app/team) and the skills they have under [Service settings](/app/settings/service).`,
        `**Send your first quote.** Start from a ${N.deal} or from [New quote](/app/quotes/new). See [Making and sending a quote](/app/help/quotes).`,
      ),
      note(
        "Your time zone was set when you activated. Dates and times everywhere (the calendar, due times, today's visits) use it.",
      ),
    ],
    related: ["users-roles", "import", "quotes"],
  },
  {
    slug: "signing-in",
    title: "Signing in, passwords and staying secure",
    summary: "How signing in works, what to do if you forget your password, and the rules.",
    category: "start",
    body: [
      steps(
        "Go to the sign-in page and enter your email and password.",
        "If it is your first time with a temporary password, you will be asked to choose a new one.",
        "Use **Sign out** (top right) when you are done on a shared computer.",
      ),
      h2("Passwords"),
      list(
        `Passwords must be at least **${MIN_PASSWORD_LENGTH} characters**. A few random words work well and are easy to remember.`,
        "Passwords are stored in a scrambled form that nobody, including us, can read back.",
        "One email address can only belong to one person's sign-in across the whole product.",
      ),
      h2("If you forget your password"),
      steps(
        "On the sign-in page choose **Forgot your password?** and enter your email.",
        `Open the email and use the link within **${minutes(RESET_TTL_MS)} minutes**. It works once.`,
        "Choose a new password. Everywhere you were signed in is signed out.",
      ),
      note(
        "For your protection the page says the same thing whether or not the email is known to us. If no email arrives, check spam, and check you used the address you were invited with.",
      ),
      h2("Limits you may notice"),
      list(
        `After **${LOGIN_LIMIT.max} wrong attempts in ${LOGIN_LIMIT.windowSeconds / 60} minutes**, signing in pauses for ${LOGIN_LIMIT.windowSeconds / 60} minutes. This stops other people guessing your password.`,
        `You stay signed in while you keep using the app, for up to ${days(SESSION_TTL_MS)} days.`,
      ),
    ],
    related: ["cant-sign-in", "users-roles"],
  },
  {
    slug: "finding-things",
    title: "Finding things: the menu, search and lists",
    summary: "How to get around, search everything, and filter a list.",
    category: "start",
    body: [
      h2("The menu"),
      p(
        "The menu on the left is grouped by what you are doing: **My work**, **Sales**, **Service**, **Customers and people**, **Products and pricing** and **Settings**. You only see what your role allows.",
      ),
      h2("Search everything"),
      p(
        `The search box at the top looks across ${N.prospects}, ${N.customers}, ${N.people}, ${N.deals}, ${N.products}, ${N.requests} and ${N.jobs} at once, and shows only what you are allowed to see.`,
      ),
      h2("Working with a list"),
      list(
        "**View** (the drop-down): the same list filtered a useful way, such as *My Open Prospects* or *Closed Prospects*.",
        "**Search this view**, then **Apply**: narrows the list to matching words.",
        "Lists show 25 at a time; use **Next** and **Previous** at the bottom.",
        "**+ New** adds a record. **Export to Excel** and **Export to CSV** save what you are looking at.",
      ),
      tip(
        "If a record you expect is missing, check the view first. Many lists start on *My* records or *Open* ones. See [I can't find a record](/app/help/cant-find-record).",
      ),
    ],
    related: ["export", "cant-find-record"],
  },
  {
    slug: "appearance",
    title: "Light, dark and match-my-device",
    summary: "Change how the screens look, including a dark mode.",
    category: "start",
    body: [
      steps("Find **Theme** in the top bar.", "Choose **Light**, **Dark** or **Match device**."),
      list(
        "**Match device** follows your computer or phone: dark at night if your device does.",
        "The choice is remembered on this device and also applies on the sign-in page.",
        "Everything stays easy to read in both: colours are checked for contrast.",
      ),
    ],
  },
  {
    slug: "words-we-use",
    title: "The words we use, and what they replace",
    summary: "A short dictionary, including the names other CRM products use for the same things.",
    category: "start",
    body: [
      p(
        "Clinch CRM uses plain words. If you have used other CRM or field-service software, this table matches their names to ours.",
      ),
      table(
        "Our words and the names other software uses",
        ["We say", "Other software may say", "What it means"],
        [
          [N.Prospect, "Lead", "Someone who might buy, before you have done any business."],
          [
            N.Customer,
            "Account, company, client",
            "A business or person you do business with, or hope to.",
          ],
          [N.Person, "Contact", "An individual at a customer."],
          [N.Deal, "Opportunity", "A possible sale you are working on."],
          ["Quote / Order", "Quote / Sales order", "A priced offer / the confirmed sale."],
          [
            N.Request,
            "Case, ticket, incident",
            "A customer asking for help or reporting a problem.",
          ],
          [N.Job, "Work order", "A piece of work to be done, usually on site."],
          [N.Member, "Resource, technician", "A person, crew or piece of equipment you send out."],
          [
            N.Visit,
            "Booking, appointment (on a job)",
            "A scheduled time for a team member to do a job.",
          ],
          [N.ProgressBar, "Business process flow", "The stage bar at the top of a deal."],
          [
            "Turn into a customer",
            "Qualify",
            `Converting a ${N.prospect} into a ${N.customer}, ${N.person} and ${N.deal}.`,
          ],
          [N.Pricing, "Price lists", "Special prices for the products and services on a quote."],
        ],
      ),
      warning(
        "Your old record numbers (LEAD-, WO-, CAS-) were renamed to match: PROS-, JOB-, REQ-, and so on. The digits did not change.",
      ),
    ],
  },
];

function h2(text: string) {
  return { type: "h" as const, text };
}
