import { writeDashboard } from "./dashboard.js";
import { parseArgs } from "./args.js";
import { init } from "./init.js";

const USAGE = `Usage: agent-regression-testing <command>

Commands:
  init [dir]                 Scaffold config and test case files
  dashboard [dir] [options]  Build an HTML dashboard from the results saved in dir
                             (default: current directory)

Dashboard options:
  --out <file>    Where to write the dashboard (default: <dir>/dashboard.html)
  --title <text>  Page title
  --max-runs <n>  Number of most recent runs to show (default: 30)`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "init") {
    const outputDir = rest[0] ?? process.cwd();
    const { created, skipped } = await init({ outputDir });

    for (const file of created) {
      console.log(`  created ${file}`);
    }
    for (const file of skipped) {
      console.log(`  skipped ${file} (already exists)`);
    }

    if (created.length > 0) {
      console.log("\nDone! Edit config.yml and test-cases.json to get started.");
    } else {
      console.log("\nNothing to do — all files already exist.");
    }
  } else if (command === "dashboard") {
    const { positional, options } = parseArgs(rest);
    const unknown = Object.keys(options).filter((k) => !["out", "title", "max-runs"].includes(k));
    if (unknown.length > 0) {
      throw new Error(`Unknown option: --${unknown[0]}\n\n${USAGE}`);
    }
    let maxRuns: number | undefined;
    if (options["max-runs"] !== undefined) {
      maxRuns = Number(options["max-runs"]);
      if (!Number.isInteger(maxRuns) || maxRuns < 1) {
        throw new Error("--max-runs must be a positive integer");
      }
    }
    const outPath = await writeDashboard(positional[0] ?? process.cwd(), {
      outPath: options.out,
      title: options.title,
      maxRuns,
    });
    console.log(`Dashboard written to ${outPath}`);
  } else {
    console.log(USAGE);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
