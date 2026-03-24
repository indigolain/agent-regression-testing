import { init } from "./init.js";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "init") {
    const outputDir = args[1] ?? process.cwd();
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
  } else {
    console.log("Usage: agent-regression-testing <command>\n");
    console.log("Commands:");
    console.log("  init [dir]  Scaffold config and test case files");
    process.exit(1);
  }
}

main();
