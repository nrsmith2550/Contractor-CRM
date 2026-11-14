import {
  AREAS,
  AREA_CONTENT,
  EDITIONS,
  PLANS,
  SHARED_CONTENT,
  MAX_SELF_SERVE_USERS,
  USERS_INCLUDED,
  firstYearCents,
  formatPlanUsd,
  monthlyCentsFor,
  type Edition,
} from "@/lib/plans";

/** What buying both single-area plans would cost, to show what the full suite saves. */
const bothSingles = {
  setup: PLANS.deals.setupCents + PLANS.jobs.setupCents,
  monthly: PLANS.deals.monthlyCents + PLANS.jobs.monthlyCents,
};

function Cta({ edition, support }: { edition: Edition; support: string | undefined }) {
  const label = `Get ${PLANS[edition].name}`;
  return support ? (
    <a
      className={`mk-btn ${edition === "complete" ? "mk-btn-primary" : ""}`}
      href={`mailto:${support}?subject=${encodeURIComponent(`${PLANS[edition].name} enquiry`)}`}
    >
      {label}
    </a>
  ) : (
    <a className="mk-btn" href="#contact">
      {label}
    </a>
  );
}

/** The three plans with their prices, and a table of what the first year costs. */
export function PlanCards({ support }: { support: string | undefined }) {
  return (
    <>
      <div className="mk-plans">
        {EDITIONS.map((e) => {
          const p = PLANS[e];
          const best = e === "complete";
          return (
            <article
              key={e}
              className={`mk-plan${best ? " mk-plan-best" : ""}`}
              aria-labelledby={`plan-${e}`}
            >
              {best && <p className="mk-ribbon">Best value</p>}
              <h3 id={`plan-${e}`}>{p.name}</h3>
              <p className="mk-muted">{p.tagline}</p>
              <p className="mk-price">
                <span className="mk-price-num">{formatPlanUsd(p.monthlyCents)}</span>
                <span className="mk-price-unit"> a month</span>
              </p>
              <p className="mk-muted mk-setup">
                plus a one-time {formatPlanUsd(p.setupCents)} setup fee
              </p>
              <ul className="mk-checks">
                {AREAS.filter((a) => p.areas.includes(a)).flatMap((a) =>
                  AREA_CONTENT[a].covers.map((c) => <li key={`${a}-${c}`}>{c}</li>),
                )}
                <li>Customers, people, products and pricing</li>
                <li>Notes, calls, tasks and the calendar</li>
                <li>Up to {USERS_INCLUDED} people signing in</li>
              </ul>
              <Cta edition={e} support={support} />
              {best && (
                <p className="mk-muted mk-save">
                  Saves {formatPlanUsd(bothSingles.setup - p.setupCents)} on setup and{" "}
                  {formatPlanUsd(bothSingles.monthly - p.monthlyCents)} a month compared with buying
                  Deals and Jobs separately.
                </p>
              )}
            </article>
          );
        })}
      </div>

      <h3 className="mk-h3">What is in each plan</h3>
      <div className="mk-table-wrap">
        <table className="mk-table">
          <caption className="mk-sr">What each plan includes</caption>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              {EDITIONS.map((e) => (
                <th scope="col" key={e}>
                  {PLANS[e].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AREAS.flatMap((a) =>
              AREA_CONTENT[a].covers.map((c) => (
                <tr key={`${a}-${c}`}>
                  <th scope="row">{c}</th>
                  {EDITIONS.map((e) => (
                    <td key={e}>
                      {PLANS[e].areas.includes(a) ? (
                        <>
                          <span aria-hidden="true">✓</span>
                          <span className="mk-sr">Included</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="mk-sr">Not included</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              )),
            )}
            {SHARED_CONTENT.map((c) => (
              <tr key={c}>
                <th scope="row">{c}</th>
                {EDITIONS.map((e) => (
                  <td key={e}>
                    <span aria-hidden="true">✓</span>
                    <span className="mk-sr">Included</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mk-h3">What the first year costs</h3>
      <div className="mk-table-wrap">
        <table className="mk-table">
          <caption className="mk-sr">First-year cost of each option</caption>
          <thead>
            <tr>
              <th scope="col">Option</th>
              <th scope="col">Setup, once</th>
              <th scope="col">12 months</th>
              <th scope="col">First year in total</th>
            </tr>
          </thead>
          <tbody>
            {EDITIONS.map((e) => (
              <tr key={e}>
                <th scope="row">{PLANS[e].name}</th>
                <td>{formatPlanUsd(PLANS[e].setupCents)}</td>
                <td>{formatPlanUsd(12 * PLANS[e].monthlyCents)}</td>
                <td>
                  <strong>{formatPlanUsd(firstYearCents(e))}</strong>
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row">Deals and Jobs bought separately</th>
              <td>{formatPlanUsd(bothSingles.setup)}</td>
              <td>{formatPlanUsd(12 * bothSingles.monthly)}</td>
              <td>
                <strong>{formatPlanUsd(bothSingles.setup + 12 * bothSingles.monthly)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3 className="mk-h3">More than {USERS_INCLUDED} people?</h3>
      <p>
        Every plan includes {USERS_INCLUDED} people signing in. Add more for{" "}
        <strong>{formatPlanUsd(PLANS.complete.extraUserCents)} a month each</strong> on{" "}
        {PLANS.complete.name}, or{" "}
        <strong>{formatPlanUsd(PLANS.deals.extraUserCents)} a month each</strong> on{" "}
        {PLANS.deals.name} or {PLANS.jobs.name}, with no extra setup fee, up to{" "}
        {MAX_SELF_SERVE_USERS} people. Need more than that? Get in touch for a quote.
      </p>
      <div className="mk-table-wrap">
        <table className="mk-table">
          <caption className="mk-sr">Monthly price by number of people</caption>
          <thead>
            <tr>
              <th scope="col">People</th>
              {EDITIONS.map((e) => (
                <th scope="col" key={e}>
                  {PLANS[e].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[USERS_INCLUDED, 15, 25, MAX_SELF_SERVE_USERS].map((people) => (
              <tr key={people}>
                <th scope="row">{people === USERS_INCLUDED ? `Up to ${people}` : people}</th>
                {EDITIONS.map((e) => (
                  <td key={e}>{formatPlanUsd(monthlyCentsFor(e, people - USERS_INCLUDED))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mk-muted">
        Prices are in US dollars, a month, plus the one-time setup fee. Adding or removing people
        changes your next bill.
      </p>
    </>
  );
}
