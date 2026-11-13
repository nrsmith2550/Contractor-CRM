import { MAX_LOGO_BYTES } from "@/server/domain/branding";
import { INVITE_TTL_MS } from "@/server/auth/invitations";
import { TIERS } from "@/lib/tiers";
import { DEFAULT_ROLES } from "@/server/security/roles";
import { N } from "../names";
import { h, list, note, steps, table, tip, warning, type Article } from "../types";

const days = (ms: number) => Math.round(ms / 86_400_000);

/** One plain sentence per standard role, kept next to the real role names so a rename shows up here. */
const ROLE_SENTENCE: Record<string, string> = {
  "System Administrator":
    "Everything, including users, settings and roles. The business owner has this role.",
  "Sales Manager": `Sales, ${N.products} and pricing for everyone; can look at service work.`,
  Salesperson: `Their own ${N.prospects}, ${N.deals}, quotes and orders; all ${N.customers} and ${N.people}; can look at ${N.products}.`,
  "Customer Service Rep": `${N.Requests}, ${N.jobs} and ${N.visits} for everyone (including scheduling); can see and update ${N.customers}.`,
  "Field Technician": `Their own ${N.visits}; can see ${N.jobs} and ${N.customers}. Adds parts and captures signatures.`,
  "Read-only": "Can look at everything, change nothing.",
};

export const TEAM: Article[] = [
  {
    slug: "users-roles",
    title: "Adding people and choosing their role",
    summary: "Invite your team and give each person only what they need.",
    category: "team",
    who: "The owner (System Administrator).",
    body: [
      steps(
        "Open [Settings, Users](/app/settings/users).",
        "Under **Invite a user**, enter their email and choose a **role**.",
        "They get an email with a link to set a password and join.",
      ),
      list(
        `The invitation link lasts **${days(INVITE_TTL_MS)} days**. If it lapses, invite them again.`,
        "Each active person uses one **seat**. A pending invitation holds a seat too, until it is accepted or expires.",
        `Seats come with your license: ${Object.values(TIERS)
          .map((t) => `${t.label} ${t.seatLimit}`)
          .join(", ")}.`,
      ),
      h("The standard roles"),
      table(
        "The six standard roles",
        ["Role", "What they can do"],
        DEFAULT_ROLES.map((r) => [r.name, ROLE_SENTENCE[r.name] ?? ""]),
      ),
      tip("See [Who can do what](/app/help/who-can-do-what) for the full table."),
      warning(
        "Give people the lowest role that lets them do their job. You can always raise it later.",
      ),
    ],
    related: ["who-can-do-what", "seats-license"],
  },
  {
    slug: "branding",
    title: "Your logo and business details",
    summary: "Put your logo on your quotes.",
    category: "team",
    who: "Administrators.",
    body: [
      steps(
        "Open [Settings, Branding](/app/settings/branding).",
        `Choose a **PNG or JPEG** file, under ${Math.round(MAX_LOGO_BYTES / 1024)} KB. It uploads straight away.`,
        "It now appears at the top of your quote PDFs. Use **Remove logo** to take it off.",
      ),
      note(
        "The file is checked by its contents, not just its name, so a renamed file of another type is refused.",
      ),
    ],
    related: ["quotes", "first-day"],
  },
];
