import { N } from "./names";
import { searchArticles } from "./search";
import type { Article, Category, CategoryId } from "./types";
import { CATALOG } from "./content/catalog";
import { CUSTOMERS } from "./content/customers";
import { FIX } from "./content/fix";
import { PLANNING } from "./content/planning";
import { PROCESS } from "./content/process";
import { SALES } from "./content/sales";
import { SERVICE } from "./content/service";
import { START } from "./content/start";
import { TEAM } from "./content/team";

export const CATEGORIES: Category[] = [
  { id: "start", title: "Getting started", blurb: "Set up, sign in and find your way around." },
  { id: "sales", title: "Sales", blurb: `${N.Prospects}, ${N.deals}, quotes and orders.` },
  {
    id: "customers",
    title: `${N.Customers} and ${N.people}`,
    blurb: "Who you work with, and a record of what happened.",
  },
  {
    id: "service",
    title: `${N.Requests}, ${N.jobs} and ${N.visits}`,
    blurb: "Help requests, work on site and the schedule.",
  },
  { id: "catalog", title: "Products and pricing", blurb: "What you sell, and what it costs." },
  {
    id: "planning",
    title: "Calendar, reports and data",
    blurb: "Plan your day, read the numbers, move data in and out.",
  },
  { id: "team", title: "Your team and business", blurb: "People, roles and your logo." },
  { id: "process", title: "How it all works", blurb: "Who can do what, and how work flows." },
  {
    id: "fix",
    title: "Fixing problems",
    blurb: "When something is not working or cannot be found.",
  },
];

export const ARTICLES: Article[] = [
  ...START,
  ...SALES,
  ...CUSTOMERS,
  ...SERVICE,
  ...CATALOG,
  ...PLANNING,
  ...TEAM,
  ...PROCESS,
  ...FIX,
];

export const articleBySlug = (slug: string): Article | undefined =>
  ARTICLES.find((a) => a.slug === slug);

export const articlesIn = (id: CategoryId): Article[] => ARTICLES.filter((a) => a.category === id);

export const categoryOf = (a: Article): Category => CATEGORIES.find((c) => c.id === a.category)!;

/** Where to start, shown first on the help home page. */
export const POPULAR = [
  "first-day",
  "prospects",
  "quotes",
  "jobs",
  "schedule-board",
  "cant-sign-in",
];

export { HELP_FOR_ENTITY } from "./links";

export const search = (q: string): Article[] => searchArticles(ARTICLES, q);
