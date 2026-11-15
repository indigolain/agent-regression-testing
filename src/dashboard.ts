import fs from "node:fs/promises";
import path from "node:path";
import type { EvaluationResult } from "./types.js";

/**
 * One saved run: the results of a single runTests call.
 */
export interface DashboardRun {
  /** Identifies the run; for saved runs, the timestamp in its file name. */
  id: string;
  /** When the run happened (ISO 8601). */
  timestamp: string;
  results: EvaluationResult[];
}

export interface DashboardOptions {
  /** Page title. Defaults to "Agent regression dashboard". */
  title?: string;
  /** How many of the most recent runs to show. Defaults to 30. */
  maxRuns?: number;
}

export interface RunSummary {
  id: string;
  timestamp: string;
  total: number;
  passed: number;
  /** Fraction of test cases that passed, 0..1. */
  passRate: number;
  /** Mean score across test cases, 0..1. */
  averageScore: number;
  /** Number of failed assertions across all test cases. */
  failedAssertions: number;
}

export interface MatrixCell {
  passed: boolean;
  score: number;
}

export interface TestRow {
  testId: string;
  /** One cell per shown run, oldest first; null when the test case didn't run. */
  cells: (MatrixCell | null)[];
}

export interface AssertionFailureSummary {
  testId: string;
  label: string;
  /** Runs in which this assertion failed. */
  failures: number;
  /** Runs in which this assertion was evaluated. */
  evaluated: number;
  /** Id of the most recent run in which it failed. */
  lastFailedRunId: string;
}

export interface DashboardModel {
  title: string;
  /** Shown runs, oldest first. */
  runs: RunSummary[];
  /** Test cases, failing in the latest run first. */
  tests: TestRow[];
  /** Assertions that failed most often, at most ten. */
  topFailingAssertions: AssertionFailureSummary[];
  /** Test cases that passed in the previous run and fail in the latest one. */
  newlyFailing: string[];
}

const DEFAULT_TITLE = "Agent regression dashboard";
const DEFAULT_MAX_RUNS = 30;
const RESULTS_FILE = /^results-(\d+)\.json$/;

/**
 * Loads every `results-<timestamp>.json` file that runTests saved in `outputDir`,
 * oldest first. Files that aren't valid result arrays are skipped with a warning.
 */
export async function loadRunHistory(outputDir: string): Promise<DashboardRun[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(outputDir);
  } catch {
    return [];
  }

  const runs: DashboardRun[] = [];
  for (const name of entries) {
    const match = RESULTS_FILE.exec(name);
    if (!match) continue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(outputDir, name), "utf-8"));
      if (!Array.isArray(data)) throw new Error("not an array of results");
      runs.push({
        id: match[1],
        timestamp: new Date(Number(match[1])).toISOString(),
        results: data as EvaluationResult[],
      });
    } catch (error) {
      console.warn(
        `Skipping ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return runs.sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Aggregates runs into the numbers the dashboard shows.
 */
export function buildDashboardModel(
  runs: DashboardRun[],
  options: DashboardOptions = {},
): DashboardModel {
  const maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS;
  const shown = [...runs]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-Math.max(1, maxRuns));

  const summaries = shown.map(summarizeRun);

  // Test rows, failing in the latest run first, then passing, then absent.
  const testIds = new Set<string>();
  for (const run of shown) for (const r of run.results) testIds.add(r.testId);
  const latest: DashboardRun | undefined = shown[shown.length - 1];
  const latestStatus = (id: string) => {
    const r = latest?.results.find((x) => x.testId === id);
    return r === undefined ? 2 : r.passed ? 1 : 0;
  };
  const tests: TestRow[] = [...testIds]
    .sort((a, b) => latestStatus(a) - latestStatus(b) || a.localeCompare(b))
    .map((testId) => ({
      testId,
      cells: shown.map((run) => {
        const r = run.results.find((x) => x.testId === testId);
        return r ? { passed: r.passed, score: finiteOr0(r.score) } : null;
      }),
    }));

  // Assertion failure counts, keyed by test case and label.
  const failures = new Map<string, AssertionFailureSummary>();
  for (const run of shown) {
    for (const result of run.results) {
      for (const a of result.assertionResults ?? []) {
        const key = `${result.testId}\u0000${a.label}`;
        const entry = failures.get(key) ?? {
          testId: result.testId,
          label: a.label,
          failures: 0,
          evaluated: 0,
          lastFailedRunId: "",
        };
        entry.evaluated++;
        if (!a.passed) {
          entry.failures++;
          entry.lastFailedRunId = run.id;
        }
        failures.set(key, entry);
      }
    }
  }
  const order = new Map(shown.map((run, i) => [run.id, i]));
  const topFailingAssertions = [...failures.values()]
    .filter((f) => f.failures > 0)
    .sort(
      (a, b) =>
        b.failures - a.failures ||
        (order.get(b.lastFailedRunId) ?? 0) - (order.get(a.lastFailedRunId) ?? 0) ||
        a.testId.localeCompare(b.testId),
    )
    .slice(0, 10);

  const previous: DashboardRun | undefined = shown[shown.length - 2];
  const newlyFailing =
    latest && previous
      ? latest.results
          .filter(
            (r) => !r.passed && previous.results.some((p) => p.testId === r.testId && p.passed),
          )
          .map((r) => r.testId)
      : [];

  return {
    title: options.title ?? DEFAULT_TITLE,
    runs: summaries,
    tests,
    topFailingAssertions,
    newlyFailing,
  };
}

function summarizeRun(run: DashboardRun): RunSummary {
  const total = run.results.length;
  const passed = run.results.filter((r) => r.passed).length;
  return {
    id: run.id,
    timestamp: run.timestamp,
    total,
    passed,
    passRate: total === 0 ? 0 : passed / total,
    averageScore:
      total === 0 ? 0 : run.results.reduce((sum, r) => sum + finiteOr0(r.score), 0) / total,
    failedAssertions: run.results.reduce(
      (sum, r) => sum + (r.assertionResults?.filter((a) => !a.passed).length ?? 0),
      0,
    ),
  };
}

/** Scores of results saved by older versions can be null (NaN in JSON). */
function finiteOr0(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Renders a self-contained HTML dashboard: no external scripts, styles or fonts,
 * so it can be opened offline or uploaded as a CI artifact.
 */
export function generateDashboard(
  runs: DashboardRun[],
  options: DashboardOptions = {},
): string {
  const model = buildDashboardModel(runs, options);
  const shownIds = new Set(model.runs.map((r) => r.id));
  const detail = runs
    .filter((r) => shownIds.has(r.id))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const body =
    model.runs.length === 0
      ? `<main class="wrap"><header class="head"><h1>${esc(model.title)}</h1></header>
<p class="empty">No runs yet. Run your tests with <code>saveResults</code> and an <code>outputDir</code>, then generate the dashboard again.</p></main>`
      : renderBody(model);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="viz-root">
${body}
<div class="tip" id="tip" role="tooltip" hidden></div>
</div>
<script>window.__DASHBOARD__ = ${safeJson({ model, runs: detail })};</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/**
 * Loads the run history in `outputDir` and writes the dashboard next to it.
 * Returns the path written.
 */
export async function writeDashboard(
  outputDir: string,
  options: DashboardOptions & { outPath?: string } = {},
): Promise<string> {
  const runs = await loadRunHistory(outputDir);
  const outPath = options.outPath ?? path.join(outputDir, "dashboard.html");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, generateDashboard(runs, options));
  return outPath;
}

// ---------------------------------------------------------------------------
// Rendering

function renderBody(m: DashboardModel): string {
  const latest = m.runs[m.runs.length - 1];
  const previous = m.runs.length > 1 ? m.runs[m.runs.length - 2] : undefined;
  const failingNow = latest.total - latest.passed;

  return `<main class="wrap">
<header class="head">
  <h1>${esc(m.title)}</h1>
  <p class="sub">${m.runs.length} run${m.runs.length === 1 ? "" : "s"} · latest ${esc(formatDate(latest.timestamp))}</p>
</header>

<section class="summary" aria-label="Latest run">
  <div class="hero">
    <div class="label">Pass rate, latest run</div>
    <div class="hero-value">${pct(latest.passRate)}</div>
    <div class="hero-sub">${latest.passed} of ${latest.total} test cases passed${previous ? ` · ${delta(latest.passRate, previous.passRate)}` : ""}</div>
  </div>
  <div class="tiles">
    ${tile("Average score", pct(latest.averageScore), previous ? delta(latest.averageScore, previous.averageScore) : "")}
    ${tile("Failing test cases", String(failingNow), "", failingNow > 0)}
    ${tile("Failed assertions", String(latest.failedAssertions), "", latest.failedAssertions > 0)}
    ${tile(
      "Newly failing",
      String(m.newlyFailing.length),
      previous
        ? m.newlyFailing.length > 0
          ? esc(m.newlyFailing.join(", "))
          : "vs previous run"
        : "no previous run",
      m.newlyFailing.length > 0,
    )}
  </div>
</section>

<section class="card">
  <h2>Pass rate and average score over time</h2>
  ${renderTrend(m.runs)}
  <details class="table-view">
    <summary>Show as table</summary>
    <table>
      <thead><tr><th>Run</th><th>Date</th><th class="num">Passed</th><th class="num">Pass rate</th><th class="num">Average score</th><th class="num">Failed assertions</th></tr></thead>
      <tbody>${m.runs
        .map(
          (r, i) =>
            `<tr><td>#${i + 1}</td><td>${esc(formatDate(r.timestamp))}</td><td class="num">${r.passed}/${r.total}</td><td class="num">${pct(r.passRate)}</td><td class="num">${pct(r.averageScore)}</td><td class="num">${r.failedAssertions}</td></tr>`,
        )
        .reverse()
        .join("")}</tbody>
    </table>
  </details>
</section>

<div class="split">
  <section class="card">
    <h2>Test cases by run</h2>
    <p class="hint">Each square is one run, oldest on the left. Select one to see its details.</p>
    ${renderMatrix(m)}
  </section>
  <section class="card">
    <h2>Most-failing assertions</h2>
    ${renderFailures(m)}
  </section>
</div>

<section class="card" id="detail" aria-live="polite"></section>
</main>`;
}

function tile(label: string, value: string, sub: string, alert = false): string {
  return `<div class="tile">
    <div class="label">${esc(label)}</div>
    <div class="tile-value">${alert ? '<span class="status-dot bad" aria-hidden="true"></span>' : ""}${value}</div>
    <div class="tile-sub">${sub || "&nbsp;"}</div>
  </div>`;
}

/** Signed change in percentage points, colored by whether up is good. */
function delta(current: number, previous: number): string {
  const d = Math.round((current - previous) * 1000) / 10;
  if (d === 0) return '<span class="delta">no change vs previous run</span>';
  const cls = d > 0 ? "up" : "down";
  const arrow = d > 0 ? "▲" : "▼";
  return `<span class="delta ${cls}">${arrow} ${Math.abs(d).toFixed(1)} pts</span> <span class="delta">vs previous run</span>`;
}

const CHART = { w: 1040, h: 280, left: 44, right: 132, top: 14, bottom: 30 };

function renderTrend(runs: RunSummary[]): string {
  const { w, h, left, right, top, bottom } = CHART;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const x = (i: number) => left + (runs.length === 1 ? plotW / 2 : (i / (runs.length - 1)) * plotW);
  const y = (v: number) => top + (1 - v) * plotH;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (v) =>
        `<line class="grid${v === 0 ? " base" : ""}" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="tick" x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`,
    )
    .join("");

  // X labels: first, last, and a few evenly spaced in between.
  const step = Math.max(1, Math.ceil(runs.length / 6));
  const xLabels = runs
    .map((r, i) =>
      i === 0 || i === runs.length - 1 || (i % step === 0 && runs.length - 1 - i >= step / 2)
        ? `<text class="tick" x="${x(i)}" y="${h - 8}" text-anchor="middle">${esc(formatShortDate(r.timestamp))}</text>`
        : "",
    )
    .join("");

  const series = [
    { key: "passRate", name: "Pass rate", cls: "s1" },
    { key: "averageScore", name: "Average score", cls: "s2" },
  ] as const;

  const lines = series
    .map((s) => {
      const pts = runs.map((r, i) => `${x(i).toFixed(1)},${y(r[s.key]).toFixed(1)}`);
      const path = runs.length > 1 ? `<polyline class="line ${s.cls}" points="${pts.join(" ")}"/>` : "";
      const last = runs[runs.length - 1];
      return `${path}<circle class="dot ${s.cls}" cx="${x(runs.length - 1)}" cy="${y(last[s.key])}" r="4.5"/>`;
    })
    .join("");

  // Direct end labels; nudged apart only when they would overlap.
  const last = runs[runs.length - 1];
  let y1 = y(last.passRate) + 4;
  let y2 = y(last.averageScore) + 4;
  if (Math.abs(y1 - y2) < 14) {
    const mid = (y1 + y2) / 2;
    const passAbove = last.passRate >= last.averageScore;
    y1 = mid + (passAbove ? -7 : 7);
    y2 = mid + (passAbove ? 7 : -7);
  }
  const endLabels =
    `<text class="end" x="${x(runs.length - 1) + 10}" y="${y1}">Pass rate ${pct(last.passRate)}</text>` +
    `<text class="end" x="${x(runs.length - 1) + 10}" y="${y2}">Avg score ${pct(last.averageScore)}</text>`;

  return `<div class="legend" aria-hidden="true">
    <span><i class="key s1"></i>Pass rate</span><span><i class="key s2"></i>Average score</span>
  </div>
  <div class="scroll-x">
  <svg class="trend" id="trend" viewBox="0 0 ${w} ${h}" role="img" aria-label="Pass rate and average score for the last ${runs.length} runs; latest pass rate ${pct(last.passRate)}, average score ${pct(last.averageScore)}">
    ${grid}${xLabels}
    <line class="cross" id="cross" x1="0" x2="0" y1="${top}" y2="${top + plotH}" visibility="hidden"/>
    ${lines}${endLabels}
    <rect class="hit" id="trendHit" x="${left}" y="${top}" width="${plotW}" height="${plotH}" data-left="${left}" data-width="${plotW}" data-n="${runs.length}"/>
  </svg>
  </div>`;
}

function renderMatrix(m: DashboardModel): string {
  const rows = m.tests
    .map((t) => {
      const cells = t.cells
        .map((c, i) => {
          if (!c) return `<td><span class="cell none" aria-label="did not run">·</span></td>`;
          const label = `${t.testId}, run ${i + 1}: ${c.passed ? "passed" : "failed"}, score ${pct(c.score)}`;
          return `<td><button class="cell ${c.passed ? "ok" : "bad"}" data-test="${esc(t.testId)}" data-run="${i}" aria-label="${esc(label)}">${c.passed ? "✓" : "✕"}</button></td>`;
        })
        .join("");
      return `<tr><th scope="row" class="tid" title="${esc(t.testId)}">${esc(t.testId)}</th>${cells}</tr>`;
    })
    .join("");
  const head = m.runs.map((_, i) => `<th class="rn" scope="col">${i + 1}</th>`).join("");
  return `<div class="scroll-x" data-scroll-end><table class="matrix">
    <thead><tr><th class="tid">Test case</th>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderFailures(m: DashboardModel): string {
  if (m.topFailingAssertions.length === 0) {
    return `<p class="empty">No assertion has failed in the shown runs.</p>`;
  }
  const max = Math.max(...m.topFailingAssertions.map((f) => f.failures));
  return `<ol class="bars">${m.topFailingAssertions
    .map(
      (f) => `<li>
      <div class="bar-label"><code>${esc(f.label)}</code><span class="bar-test">${esc(f.testId)}</span></div>
      <div class="bar-row"><span class="bar" style="width:${((f.failures / max) * 100).toFixed(1)}%"></span><span class="bar-value">${f.failures} of ${f.evaluated} runs</span></div>
    </li>`,
    )
    .join("")}</ol>`;
}

function pct(v: number): string {
  return `${Math.round(v * 1000) / 10}%`.replace(/\.0%$/, "%");
}

function formatDate(iso: string): string {
  return iso.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, " UTC");
}

function formatShortDate(iso: string): string {
  return iso.slice(5, 10).replace("-", "/");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON that is safe to embed in a <script> element. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028))
    .join("\\u2028")
    .split(String.fromCharCode(0x2029))
    .join("\\u2029");
}

// ---------------------------------------------------------------------------
// Page assets. Colors follow a validated categorical/status palette; dark mode
// uses its own steps rather than an automatic inversion.

const STYLES = `
.viz-root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --ring: rgba(11,11,11,0.10);
  --s1: #2a78d6; --s2: #eb6834; --good: #0ca30c; --bad: #d03b3b; --none: #e1e0d9;
  --up: #006300; --down: #d03b3b; --code-bg: #f0efec;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
    --s1: #3987e5; --s2: #d95926; --none: #2c2c2a; --up: #0ca30c; --down: #e66767; --code-bg: #262624;
  }
}
:root[data-theme="dark"] .viz-root {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
  --s1: #3987e5; --s2: #d95926; --none: #2c2c2a; --up: #0ca30c; --down: #e66767; --code-bg: #262624;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
.viz-root { background: var(--page); color: var(--ink); min-height: 100vh;
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 28px 16px 48px; }
h1 { font-size: 22px; margin: 0; font-weight: 650; }
h2 { font-size: 15px; margin: 0 0 12px; font-weight: 600; }
.sub, .hint, .label, .tile-sub, .hero-sub { color: var(--ink-2); }
.sub { margin: 4px 0 0; }
.hint { margin: -6px 0 12px; font-size: 13px; }
.head { margin-bottom: 20px; }
code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; background: var(--code-bg); padding: 1px 5px; border-radius: 4px; }
.card, .hero, .tile { background: var(--surface); border-radius: 12px; box-shadow: 0 0 0 1px var(--ring); }
.card { padding: 18px 20px; margin-top: 16px; min-width: 0; }
.summary { display: grid; grid-template-columns: minmax(220px, 1fr) 3fr; gap: 16px; }
.hero { padding: 18px 20px; }
.hero-value { font-size: 52px; font-weight: 650; line-height: 1.1; margin: 6px 0 4px; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.tile { padding: 16px 18px; min-width: 0; }
.label { font-size: 13px; }
.tile-value { font-size: 28px; font-weight: 600; margin: 6px 0 2px; display: flex; align-items: center; gap: 8px; }
.tile-sub { font-size: 12.5px; overflow-wrap: anywhere; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.status-dot.bad { background: var(--bad); }
.delta.up { color: var(--up); font-weight: 600; }
.delta.down { color: var(--down); font-weight: 600; }
.legend { display: flex; gap: 18px; font-size: 13px; color: var(--ink-2); margin-bottom: 6px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.key { width: 14px; height: 2px; border-radius: 1px; display: inline-block; }
.key.s1 { background: var(--s1); } .key.s2 { background: var(--s2); }
.scroll-x { overflow-x: auto; }
svg.trend { width: 100%; min-width: 640px; max-width: ${CHART.w}px; height: auto; display: block; }
.grid { stroke: var(--grid); stroke-width: 1; } .grid.base { stroke: var(--axis); }
.tick { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.end { fill: var(--ink-2); font-size: 12px; }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.line.s1 { stroke: var(--s1); } .line.s2 { stroke: var(--s2); }
.dot { stroke: var(--surface); stroke-width: 2; }
.dot.s1 { fill: var(--s1); } .dot.s2 { fill: var(--s2); }
.cross { stroke: var(--axis); stroke-width: 1; }
.hit { fill: transparent; cursor: crosshair; }
.table-view { margin-top: 10px; font-size: 13px; }
.table-view summary { cursor: pointer; color: var(--ink-2); }
table { border-collapse: collapse; }
.table-view table { width: 100%; margin-top: 8px; }
.table-view th, .table-view td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--grid); }
.num { text-align: right !important; font-variant-numeric: tabular-nums; }
.split { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; }
.split .card { margin-top: 16px; }
.matrix th, .matrix td { padding: 2px; }
.matrix .rn { font-size: 11px; color: var(--muted); font-weight: 400; width: 24px; }
.matrix .tid { text-align: left; font-weight: 500; padding-right: 12px; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.matrix thead .tid { color: var(--muted); font-weight: 400; font-size: 12px; }
.matrix .tid { position: sticky; left: 0; z-index: 1; background: var(--surface); }
.cell { width: 22px; height: 22px; border-radius: 4px; border: 0; display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff; padding: 0; cursor: pointer; }
.cell.ok { background: var(--good); } .cell.bad { background: var(--bad); }
.cell.none { background: var(--none); color: var(--muted); cursor: default; }
.cell[aria-pressed="true"] { outline: 2px solid var(--ink); outline-offset: 2px; }
.cell:focus-visible { outline: 2px solid var(--s1); outline-offset: 2px; }
.bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.bar-label { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; font-size: 13px; }
.bar-label code { overflow-wrap: anywhere; }
.bar-test { color: var(--muted); font-size: 12px; }
.bar-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.bar { height: 10px; background: var(--s1); border-radius: 0 4px 4px 0; min-width: 4px; flex: none; max-width: calc(100% - 96px); }
.bar-value { font-size: 12px; color: var(--ink-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
.empty { color: var(--ink-2); }
.tip { position: fixed; z-index: 10; pointer-events: none; background: var(--surface); color: var(--ink);
  box-shadow: 0 0 0 1px var(--ring), 0 8px 24px rgba(0,0,0,.18); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; max-width: 280px; }
.tip b { font-weight: 600; }
.tip .row { display: flex; align-items: center; gap: 6px; }
#detail h2 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.badge { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: #fff; border-radius: 999px; padding: 2px 10px; }
.badge.ok { background: var(--good); } .badge.bad { background: var(--bad); }
.meta { color: var(--ink-2); font-weight: 400; font-size: 13px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.detail-grid h3 { font-size: 13px; margin: 14px 0 6px; color: var(--ink-2); font-weight: 600; }
.detail-grid pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--code-bg); border-radius: 8px; padding: 10px 12px; margin: 0;
  font: 12.5px/1.5 ui-monospace, "SF Mono", Menlo, monospace; }
.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.checks li { display: grid; grid-template-columns: 18px 1fr; gap: 6px; }
.checks .icon { font-weight: 700; }
.checks .icon.ok { color: var(--good); } .checks .icon.bad { color: var(--bad); }
.checks .why { color: var(--ink-2); font-size: 12.5px; }
.tools { margin: 0; padding-left: 18px; }
.tools li { margin-bottom: 4px; overflow-wrap: anywhere; }
@media (max-width: 860px) {
  .summary, .split, .detail-grid { grid-template-columns: 1fr; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;

const SCRIPT = `
(function () {
  var data = window.__DASHBOARD__;
  var model = data.model, runs = data.runs;
  if (!model.runs.length) return;
  var tip = document.getElementById("tip");

  // On narrow screens, start the matrix scrolled to the latest runs.
  Array.prototype.forEach.call(document.querySelectorAll("[data-scroll-end]"), function (s) {
    s.scrollLeft = s.scrollWidth;
  });

  function pct(v) { return (Math.round(v * 1000) / 10).toString().replace(/\\.0$/, "") + "%"; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function showTip(nodes, x, y) {
    tip.replaceChildren.apply(tip, nodes);
    tip.hidden = false;
    var r = tip.getBoundingClientRect();
    var left = Math.min(x + 14, window.innerWidth - r.width - 8);
    var top = y + 14 + r.height > window.innerHeight ? y - r.height - 10 : y + 14;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
  }
  function hideTip() { tip.hidden = true; }

  // Trend chart crosshair and tooltip.
  var hit = document.getElementById("trendHit");
  var cross = document.getElementById("cross");
  if (hit) {
    var svg = document.getElementById("trend");
    var left = +hit.dataset.left, width = +hit.dataset.width, n = +hit.dataset.n;
    function onMove(ev) {
      var pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      var p = pt.matrixTransform(svg.getScreenCTM().inverse());
      var i = n === 1 ? 0 : Math.round(((p.x - left) / width) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      var x = n === 1 ? left + width / 2 : left + (i / (n - 1)) * width;
      cross.setAttribute("x1", x); cross.setAttribute("x2", x);
      cross.setAttribute("visibility", "visible");
      var r = model.runs[i];
      var head = el("div"); head.appendChild(el("b", "", "Run " + (i + 1)));
      head.appendChild(document.createTextNode(" · " + r.timestamp.replace("T", " ").slice(0, 16) + " UTC"));
      function line(cls, label, value) {
        var d = el("div", "row"); var k = el("i", "key " + cls); d.appendChild(k);
        d.appendChild(document.createTextNode(label + " " + value)); return d;
      }
      showTip([head, line("s1", "Pass rate", pct(r.passRate) + " (" + r.passed + "/" + r.total + ")"),
        line("s2", "Average score", pct(r.averageScore)),
        el("div", "", r.failedAssertions + " failed assertion" + (r.failedAssertions === 1 ? "" : "s"))],
        ev.clientX, ev.clientY);
    }
    hit.addEventListener("mousemove", onMove);
    hit.addEventListener("mouseleave", function () { cross.setAttribute("visibility", "hidden"); hideTip(); });
  }

  // Matrix cells: tooltip and drill-down.
  function findResult(runIndex, testId) {
    return runs[runIndex].results.find(function (r) { return r.testId === testId; });
  }
  var cells = Array.prototype.slice.call(document.querySelectorAll("button.cell"));
  cells.forEach(function (c) {
    c.addEventListener("mouseenter", function (ev) {
      var i = +c.dataset.run, r = findResult(i, c.dataset.test);
      var head = el("div"); head.appendChild(el("b", "", c.dataset.test));
      showTip([head, el("div", "", "Run " + (i + 1) + " · " + (r.passed ? "✓ passed" : "✕ failed") + " · score " + pct(r.score || 0))],
        ev.clientX, ev.clientY);
    });
    c.addEventListener("mouseleave", hideTip);
    c.addEventListener("click", function () { select(+c.dataset.run, c.dataset.test); });
  });

  var detail = document.getElementById("detail");
  function checkList(items) {
    var ul = el("ul", "checks");
    items.forEach(function (it) {
      var li = el("li");
      li.appendChild(el("span", "icon " + (it.ok ? "ok" : "bad"), it.ok ? "✓" : "✕"));
      var body = el("div");
      body.appendChild(el("div", "", it.text));
      if (it.why) body.appendChild(el("div", "why", it.why));
      li.appendChild(body); ul.appendChild(li);
    });
    return ul;
  }
  function select(runIndex, testId) {
    var r = findResult(runIndex, testId);
    cells.forEach(function (c) {
      c.setAttribute("aria-pressed", String(+c.dataset.run === runIndex && c.dataset.test === testId));
    });
    detail.replaceChildren();
    var h = el("h2"); h.appendChild(document.createTextNode(testId));
    h.appendChild(el("span", "badge " + (r.passed ? "ok" : "bad"), r.passed ? "✓ Passed" : "✕ Failed"));
    h.appendChild(el("span", "meta", "Run " + (runIndex + 1) + " · " + runs[runIndex].timestamp.replace("T", " ").slice(0, 16) + " UTC · score " + pct(r.score || 0)));
    detail.appendChild(h);

    var grid = el("div", "detail-grid"), left = el("div"), right = el("div");
    left.appendChild(el("h3", "", "Question")); left.appendChild(el("pre", "", r.question));
    left.appendChild(el("h3", "", "Response")); left.appendChild(el("pre", "", r.response || "(no response)"));
    if (r.toolCalls && r.toolCalls.length) {
      left.appendChild(el("h3", "", "Tool calls"));
      var ol = el("ol", "tools");
      r.toolCalls.forEach(function (t) {
        var li = el("li"); li.appendChild(el("code", "", t.name));
        if (t.args !== undefined) li.appendChild(document.createTextNode(" " + JSON.stringify(t.args)));
        ol.appendChild(li);
      });
      left.appendChild(ol);
    }
    if (r.assertionResults && r.assertionResults.length) {
      right.appendChild(el("h3", "", "Assertions"));
      right.appendChild(checkList(r.assertionResults.map(function (a) {
        return { ok: a.passed, text: a.label + (a.required ? "" : " (optional)"), why: a.message };
      })));
    }
    if (r.criteriaResults && r.criteriaResults.length) {
      right.appendChild(el("h3", "", "Criteria"));
      right.appendChild(checkList(r.criteriaResults.map(function (c) {
        return { ok: c.met, text: c.criterion, why: c.reasoning };
      })));
    }
    if (r.keywordMatches && r.keywordMatches.length) {
      right.appendChild(el("h3", "", "Keywords"));
      right.appendChild(checkList(r.keywordMatches.map(function (k) { return { ok: k.found, text: k.keyword }; })));
    }
    right.appendChild(el("h3", "", "Response length"));
    var lenText = r.responseLength + " characters";
    if (typeof r.minResponseLength === "number") lenText += " (minimum " + r.minResponseLength + ")";
    right.appendChild(el("div", "", lenText));
    grid.appendChild(left); grid.appendChild(right); detail.appendChild(grid);
  }

  // Start on the first failing test case of the latest run, or the first one.
  var last = runs.length - 1;
  var first = model.tests.find(function (t) { var c = t.cells[last]; return c && !c.passed; })
    || model.tests.find(function (t) { return t.cells[last]; });
  if (first) select(last, first.testId);
})();
`;
