import { useEffect, useRef, useState } from "react";
import {
  staffProviderCostReportV1Schema,
  type StaffProviderCostReportV1,
} from "@cloudmarkup/api-contract";
import type { CloudMarkupQueryRuntime } from "../../api/index.js";

/** No shared query cache or automatic fetch. Every page checks server authority. */
export function StaffProviderCostReport({
  runtime,
  organizationId,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly organizationId: string;
}) {
  const [from, setFrom] = useState(""),
    [until, setUntil] = useState("");
  const [report, setReport] = useState<StaffProviderCostReportV1 | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function read(query: { from: string; until: string; cursor?: string }) {
    const attempt = ++generation.current;
    setBusy(true);
    setReport(null);
    setError("");
    try {
      const response = await runtime.client.request(
        "staff.provider-costs.get",
        { path: { organizationId }, query },
      );
      const value = staffProviderCostReportV1Schema.parse(response.data);
      if (
        value.organizationId !== organizationId ||
        value.cohort.from !== query.from ||
        value.cohort.until !== query.until
      )
        throw Error("Report scope mismatch");
      if (generation.current === attempt) setReport(value);
    } catch {
      if (generation.current === attempt)
        setError(
          "This report is unavailable. Current staff permission and explicit access to this organization are required.",
        );
    } finally {
      if (generation.current === attempt) setBusy(false);
    }
  }
  return (
    <section className="feature-card" aria-label="Internal provider costs">
      <h2>Internal provider costs</h2>
      <p>
        Known provider usage for this organization. Missing or conflicting
        evidence is not a zero cost. Customer credit balances are separate.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void read({
            from: from + "T00:00:00.000Z",
            until: until + "T00:00:00.000Z",
          });
        }}
      >
        <label>
          Start date (UTC)
          <input
            type="date"
            required
            value={from}
            onChange={(event) => {
              setFrom(event.currentTarget.value);
            }}
          />
        </label>
        <label>
          End date (UTC, exclusive)
          <input
            type="date"
            required
            value={until}
            onChange={(event) => {
              setUntil(event.currentTarget.value);
            }}
          />
        </label>
        <button
          className="button button--secondary"
          type="submit"
          disabled={busy}
        >
          Read provider costs
        </button>
      </form>
      {busy ? (
        <p role="status">Checking access and reading one cost page.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {report ? (
        <>
          <p>
            Interval: {report.cohort.from} to {report.cohort.until}. Page
            snapshot: <time dateTime={report.asOf}>{report.asOf}</time>.
          </p>
          <p>
            Known cost on this page:{" "}
            {report.knownProviderCostMicros === null
              ? "Unknown"
              : "USD " +
                (
                  BigInt(report.knownProviderCostMicros) / 1_000_000n
                ).toString() +
                "." +
                (BigInt(report.knownProviderCostMicros) % 1_000_000n)
                  .toString()
                  .padStart(6, "0")}
            .
          </p>
          <p>
            {report.evidenceComplete
              ? "This page has no unresolved cost evidence."
              : "This page is incomplete; unresolved or conflicting usage remains."}{" "}
            Pages have separate snapshots; their sums are not an exact total
            expenditure for the interval.
          </p>
          <ul aria-label="Provider usage records">
            {report.records.map((record) => (
              <li key={record.reservationId}>
                {record.reservationId}: {record.accountingStatus}; provider cost{" "}
                {record.providerCostMicros ?? "unknown"} micro-USD; original
                pricing {record.pricingVersionId}.
              </li>
            ))}
          </ul>
          {report.nextCursor === null ? null : (
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => {
                if (report.nextCursor !== null)
                  void read({ ...report.cohort, cursor: report.nextCursor });
              }}
            >
              Next cost page
            </button>
          )}
        </>
      ) : null}
    </section>
  );
}
