import { MAX_IMPORT_ROWS } from "@/server/domain/lead-import";
import { EXPORT_LIMIT } from "@/server/entities/export";
import { N } from "../names";
import { h, list, note, p, steps, table, tip, warning, type Article } from "../types";

export const PLANNING: Article[] = [
  {
    slug: "calendar",
    title: "The calendar",
    summary: `See your appointments, tasks with due dates and ${N.visits} in one place.`,
    category: "planning",
    body: [
      p(
        `The [calendar](/app/calendar) shows three things: your **appointments**, your **tasks** on the day they are due, and your **${N.visits}** (colour-coded). Times are in your business's time zone.`,
      ),
      list(
        "Switch between **Month**, **Week**, **Day** and **Agenda** (a simple list) at the top right.",
        "**Click a day** or **drag across a time** to add an appointment. Enter a subject, check the start and end, and choose **Add appointment**.",
        "**Click an item** to see its details and an **Open the record** link.",
        "Completed items are struck through.",
      ),
      note(
        "Managers and the owner get a **Show** drop-down to look at everyone's calendar or one person's. Everyone else sees their own.",
      ),
    ],
    related: ["notes-and-appointments", "dashboards"],
  },
  {
    slug: "dashboards",
    title: "Reading the dashboards",
    summary: "What each tile and chart means, and why you might see less than a colleague.",
    category: "planning",
    body: [
      h("Sales dashboard"),
      table(
        "The Sales dashboard",
        ["Shows", "What it means"],
        [
          [
            `Open pipeline by stage`,
            `How many open ${N.deals} are in each stage, and their total estimated value.`,
          ],
          [
            "Won revenue",
            `Money from ${N.deals} won this calendar quarter, by the date they were won.`,
          ],
          [
            `Open ${N.prospects} by source`,
            `Where your ${N.prospects} came from: web, referral and so on.`,
          ],
          ["My activities", "Your next open items, soonest first."],
        ],
      ),
      h("Service dashboard"),
      table(
        "The Service dashboard",
        ["Shows", "What it means"],
        [
          [`Active ${N.requests} by priority`, "How much open work there is and how urgent."],
          [
            "Past their due time",
            `${N.Requests} still open after their due time, most overdue first. Click one to open it.`,
          ],
          [`Today's ${N.visits} by ${N.member}`, "Who is out today and how many visits each has."],
        ],
      ),
      note(
        "Dashboards only count what you are allowed to see. A salesperson's pipeline shows their own deals; a manager's shows everyone's. A section you have no access to says so.",
      ),
      tip(
        "Every chart has its numbers in a table underneath, so you can read it without the picture.",
      ),
    ],
    related: ["deals", "due-times", "who-can-do-what"],
  },
  {
    slug: "export",
    title: "Exporting to Excel or CSV",
    summary: "Save any list as a spreadsheet.",
    category: "planning",
    body: [
      steps(
        "Open the list and choose the **view** and any **search** you want.",
        "Choose **Export to Excel** for a spreadsheet, or **Export to CSV** for a plain file other programs can read.",
      ),
      list(
        "You get **everything in that view and search**, not just the 25 on screen.",
        "Excel files keep money, dates and numbers as real values, so they sort and add up.",
        "You only get records you are allowed to see.",
        `Each export is recorded in the audit log, because it is a copy of customer data.`,
      ),
      warning(
        `A view with more than ${EXPORT_LIMIT.toLocaleString("en-US")} records is refused rather than cut short. Narrow the view or search and try again.`,
      ),
      note(
        "A spreadsheet is a copy of your customer data. Keep it as private as the app itself, and delete it when you are done.",
      ),
    ],
    related: ["finding-things"],
  },
  {
    slug: "import",
    title: `Importing ${N.prospects} from a spreadsheet`,
    summary: "Bring in a list you already have, with column matching and a report of any problems.",
    category: "planning",
    body: [
      steps(
        `Save your spreadsheet as a **CSV** file. The first row must be the column names.`,
        `Open [${N.Prospects}](/app/prospects) and choose **Import ${N.prospects}**, then choose the file.`,
        "**Match your columns** to the fields: Clinch CRM guesses from the names and you can correct each one.",
        "Check the preview, then import.",
      ),
      list(
        `Up to **${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows** per import. Split bigger files.`,
        "Each row is checked on its own. A row with a problem is skipped and listed by its row number with the reason; the good rows are still added.",
        "Money can be written like 1250, 1,250 or 1,250.00.",
        `Imported ${N.prospects} belong to you, so you see them in *My Open ${N.Prospects}*.`,
      ),
      tip("Try a file of five rows first to check the matching, then import the rest."),
    ],
    related: ["prospects", "first-day"],
  },
];
