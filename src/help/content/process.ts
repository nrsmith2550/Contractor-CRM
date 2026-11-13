import { DEFAULT_ROLES, type Depth, type Entity } from "@/server/security/roles";
import { N } from "../names";
import { list, note, p, table, type Article } from "../types";

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
];
