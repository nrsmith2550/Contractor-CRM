import { N } from "../names";
import { list, note, p, steps, tip, type Article } from "../types";

export const CATALOG: Article[] = [
  {
    slug: "products-services",
    title: `${N.Products}`,
    summary: `List what you sell, with prices, so quotes and jobs are quick and consistent.`,
    category: "catalog",
    who: "Sales managers and the owner add and change them. Salespeople can look.",
    body: [
      p(
        `A ${N.product} is anything you sell: a physical product, or a service such as an hour of labour. Add each one once and use it on every quote, ${N.deal} and ${N.job}.`,
      ),
      steps(
        `Open [${N.Products}](/app/products) and choose **+ New**.`,
        "Enter a **SKU** (your own short code, unique) and a **name**.",
        "Choose the **type**: product or service.",
        "Set the **list price**. Optionally add a **standard cost** (what it costs you) and a **tax rate**.",
        "Choose **Save**.",
      ),
      list(
        "Prices are in dollars and cents. Totals on quotes are worked out to the cent.",
        "The SKU must be different for every item; you are told if one is already used.",
        "The tax rate you choose here is applied to this item on every quote line, and can be changed on a single line.",
      ),
      tip(
        `For something one-off that is not worth adding, use **Write-in (not in your list)** on the quote.`,
      ),
    ],
    related: ["pricing-lists", "tax-rates", "quotes"],
  },
  {
    slug: "pricing-lists",
    title: `${N.Pricing}: special prices for quotes`,
    summary: `Charge a different price for some customers without changing your list prices.`,
    category: "catalog",
    who: "Sales managers and the owner.",
    body: [
      p(
        `A ${N.pricingList} sets the price of ${N.products} for the quotes that use it, for example a trade price or a contract price. Without one, each item's list price is used.`,
      ),
      steps(
        `Open [${N.Pricing}](/app/pricing) and fill in **New ${N.pricingList}** with a name.`,
        "Open the list, choose a product or service and enter the **price**, then **Save price**.",
        `When you make a quote, choose the ${N.pricingList}. Items on it use its price; others fall back to their list price.`,
      ),
      note(
        "Changing a price on a list does not change quotes that are already active: they stay as sent.",
      ),
    ],
    related: ["products-services", "quotes"],
  },
  {
    slug: "tax-rates",
    title: "Tax rates",
    summary: "Set up sales tax once and have it applied to the right lines.",
    category: "catalog",
    who: "Sales managers and the owner.",
    body: [
      steps(
        "Open [Settings, Tax rates](/app/settings/tax-rates).",
        "Under **Add a tax rate**, enter a name (for example *State sales tax*) and the **rate as a percentage** (for example 8.25).",
        `Choose the rate on each ${N.product} that should be taxed.`,
      ),
      list(
        "On a quote, each line is taxed at its item's rate. A line can be changed or left untaxed.",
        "Totals show the tax, so what the customer sees adds up.",
      ),
    ],
    related: ["products-services", "quotes"],
  },
];
