import { SLA_HOURS } from "@/server/domain/sla";
import { N } from "../names";
import { flow, h, list, note, p, steps, table, tip, type Article } from "../types";

export const SERVICE: Article[] = [
  {
    slug: "support-requests",
    title: `Handling a ${N.request}`,
    summary: `Log a problem or question, work it, and close it.`,
    category: "service",
    who: "Customer service reps and the owner create and change them. Sales managers can look.",
    body: [
      p(
        `A ${N.request} is a customer asking for help or reporting a problem. Each one gets a due time based on its priority, so nothing is forgotten. See [Due times](/app/help/due-times).`,
      ),
      h(`Log a ${N.request}`),
      steps(
        `Open [${N.Requests}](/app/support-requests) and choose **+ New**.`,
        `Give it a title and pick the ${N.customer} and ${N.person}.`,
        "Choose the **priority** (low, normal, high, urgent), the **type** (question, problem, request) and how it came in (phone, email, web).",
        "Choose **Save**. The due time starts counting.",
      ),
      h("Work it"),
      list(
        "**Put on hold** or **Waiting on customer** when you cannot move it forward. The due clock keeps running.",
        `**Turn into a job** if someone needs to go out. See [${N.Jobs}](/app/help/jobs).`,
        "**Resolve request:** describe how it was resolved (required) and, if you bill for it, the billable minutes. Then **Confirm resolve**.",
        "**Cancel request** if it was raised by mistake.",
      ),
      note(
        `You cannot resolve or cancel a ${N.request} while its ${N.jobs} are still open: finish or cancel them first, and you are told which ones.`,
      ),
      tip(
        "**Reactivate** a resolved or cancelled request if the problem comes back. Its due clock starts again from now.",
      ),
    ],
    related: ["due-times", "jobs", "customers"],
  },
  {
    slug: "due-times",
    title: "Due times: how long a request should take",
    summary:
      "Each support request has a due time from its priority, with a colour-coded countdown.",
    category: "service",
    body: [
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
      p(
        "The time is counted from when the request was created. Change the priority and it is worked out again from the original time.",
      ),
      table(
        "What the badge on a request means",
        ["Badge", "Meaning"],
        [
          ["Time left, green", "On track."],
          ["Time left, orange", "Due soon: less than a quarter of the time is left."],
          [
            "Breached, red",
            "Past its due time and still open. It also appears on the Service dashboard.",
          ],
          ["SLA met", "Resolved on or before the due time. This never changes later."],
          ["SLA missed", "Resolved after the due time."],
          ["Cancelled", "No due time applies."],
        ],
      ),
      tip(
        "Check [the Service dashboard](/app/dashboards/service) each morning for requests already past their due time.",
      ),
    ],
    related: ["support-requests", "dashboards"],
  },
  {
    slug: "jobs",
    title: `${N.Jobs}: from request to finished work`,
    summary: `Plan, schedule, complete and finish a piece of work.`,
    category: "service",
    who: "Customer service reps and the owner create and change jobs. Technicians can see them and work their own visits.",
    body: [
      flow(
        `The life of a ${N.job}`,
        { title: "Unscheduled", text: "Created, waiting for a time." },
        { title: "Scheduled", text: `A ${N.visit} is booked.` },
        { title: "In progress", text: "The team member has started." },
        { title: "Completed", text: "Work done and signed off." },
        { title: "Posted", text: "Final. It feeds invoicing and can no longer change." },
      ),
      h(`Create a ${N.job}`),
      steps(
        `From a ${N.request}, choose **Turn into a job**, or open [${N.Jobs}](/app/jobs) and choose **+ New**.`,
        `Give it a title, the ${N.customer}, the **job type** (repair, maintenance, installation, inspection) and the priority.`,
        "Add instructions for the team, the **service address**, the estimated minutes and, if the customer is only free at certain times, the **time window**.",
        "Choose **Save**. It appears in *Unscheduled Jobs* until you book a visit.",
      ),
      h("Rules worth knowing"),
      list(
        `A ${N.job} can be edited until it is completed. After that it is locked, apart from reopening it if the work was not really finished.`,
        "A cancelled job can be reinstated. A **posted** job is final.",
        `If a ${N.visit} is cancelled the ${N.job} goes back to *Unscheduled*.`,
        `Jobs that need particular skills (for example *HVAC certified*) can say so; the ${N.Schedule} warns you if you book someone without them.`,
      ),
    ],
    related: ["scheduling-visits", "parts-and-labour", "technician-visits"],
  },
  {
    slug: "scheduling-visits",
    title: `Scheduling a ${N.visit}`,
    summary: `Give a ${N.job} to a ${N.member} at a time, and understand the warnings.`,
    category: "service",
    who: "Customer service reps and the owner (the people who dispatch).",
    body: [
      steps(
        `Open the ${N.job} and find **${N.Visits}**.`,
        `Choose the ${N.member}, then the **start** and **end**.`,
        "Choose **Book**.",
      ),
      p(
        "You can also drag an unscheduled job straight onto the [Schedule](/app/schedule). See [Using the Schedule](/app/help/schedule-board).",
      ),
      h("Warnings"),
      p("You can still go ahead when there is a warning, but you are told so you can decide:"),
      list(
        `The ${N.member} **is already booked** at that time.`,
        "The time is **outside their working hours**.",
        `The ${N.member} **doesn't have a skill** the ${N.job} needs.`,
        "The time is **outside the customer's time window**.",
      ),
      h("Rules"),
      list(
        `A ${N.job} has one active ${N.visit} at a time. To change it, move or cancel the existing one first.`,
        `A ${N.visit} must end after it starts and cannot be longer than 14 days.`,
        `**Cancel ${N.visit}** returns the ${N.job} to *Unscheduled*. Once work has started a ${N.visit} cannot be moved.`,
      ),
    ],
    related: ["schedule-board", "team-members", "jobs"],
  },
  {
    slug: "schedule-board",
    title: `Using the ${N.Schedule}`,
    summary: `See everyone's day at a glance, and move work by dragging.`,
    category: "service",
    who: "Everyone who can see jobs can look. Dispatchers (customer service reps, the owner) can change it.",
    body: [
      p(
        `The [${N.Schedule}](/app/schedule) shows a row for each ${N.member} and their ${N.visits} across **Day**, **Week** or **Month**. It refreshes itself every 30 seconds, so it stays current without you reloading.`,
      ),
      h("Moving things"),
      list(
        `**Drag** a ${N.visit} to move it, or onto another row to give it to someone else. It snaps to 15 minutes in Day view, 30 in Week and an hour in Month.`,
        "**Drag the edges** to make it shorter or longer.",
        `**Drag an unscheduled ${N.job}** from the pane below onto a ${N.member} and time to book it for its estimated length.`,
        `**Right-click** a ${N.visit} (or press Enter on it) for a menu: open the ${N.job}, change its status or cancel it.`,
      ),
      h("Without a mouse"),
      list(
        `Tab to a ${N.visit}. **Arrow keys** move it, **Shift + arrows** resize it, **Up/Down** change the row, **Enter** opens the menu.`,
      ),
      h("Filtering"),
      p(`Use the skills drop-down to show only ${N.members} who have a skill.`),
      note(
        "Warnings appear after each change, in the same words as when you schedule from the job.",
      ),
    ],
    related: ["scheduling-visits", "team-members"],
  },
  {
    slug: "team-members",
    title: `${N.Members}, working hours and skills`,
    summary: `Set up the people, crews and equipment you send out.`,
    category: "service",
    who: "Only administrators change team members.",
    body: [
      p(
        `A ${N.member} is anyone or anything you can book a ${N.visit} for: a person, a crew or a piece of equipment.`,
      ),
      steps(
        `Open [${N.Members}](/app/team) and fill in **Add a ${N.member}**.`,
        "Enter a name and the type (person, crew, equipment).",
        "For a person, link their **sign-in** so they see their own visits on their phone.",
        "Pick a colour (it shows on the schedule), set **working hours** for each day, and tick their **skills**.",
      ),
      p(
        "Skills are created under [Service settings](/app/settings/service) (for example *HVAC certified* or *Gas fitter*). Add each once, then tick it on the people who have it.",
      ),
      tip("Working hours matter: scheduling outside them still works but shows a warning."),
    ],
    related: ["technician-visits", "scheduling-visits"],
  },
  {
    slug: "technician-visits",
    title: "For technicians: running a visit from your phone",
    summary: "See your day, tell the office you are on the way, and finish with a signature.",
    category: "service",
    who: "Field technicians use this. Their sign-in must be linked to a team member.",
    body: [
      steps(
        "Sign in on your phone and open **[My visits](/app/my-visits)**. It shows your visits, in time order.",
        "Tap **I'm on my way** when you leave. (If you change your mind, **Not on my way after all** puts it back.)",
        "Tap **Start work** when you arrive. If you are already on site you can start directly.",
        "Do the work. Add the parts you used to the job.",
        "Tap **Finish visit**, add any notes and, if the customer will sign, type their name and have them sign with a finger. A signature is optional.",
        "Tap **Complete visit**. The visit and the job are marked completed.",
      ),
      list(
        "The customer's name, address, any instructions and the time are on each card.",
        "You see your own visits only, not colleagues'.",
        "The signature is saved with the visit as proof of the work.",
      ),
      note("Technicians record the parts they used. The office records labour time."),
    ],
    related: ["parts-and-labour", "jobs"],
  },
  {
    slug: "parts-and-labour",
    title: "Recording parts and labour on a job",
    summary: "Add what was used and the time spent so the job total is right.",
    category: "service",
    body: [
      steps(
        `Open the ${N.job}.`,
        `Under parts, pick a ${N.product}, set the quantity and add it. The price comes from the list price and can be changed.`,
        "Under labour, describe the work, the minutes and the hourly rate, and who did it.",
      ),
      list(
        `The **${N.Job} totals** add up parts and labour.`,
        "Technicians can add parts to their own visits. The office records labour.",
        "Parts and labour can be changed only while the job is still open.",
      ),
    ],
    related: ["jobs", "technician-visits"],
  },
];
