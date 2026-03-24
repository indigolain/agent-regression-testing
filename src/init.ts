import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG_YML = `# agent-regression-testing configuration
# See: https://github.com/indigolain/agent-regression-testing

scoringWeights:
  criteria: 0.6
  keywords: 0.3
  length: 0.1

passThreshold: 0.7
regressionThreshold: 0.2

retryConfig:
  maxRetries: 3
  initialDelay: 2000
  backoffMultiplier: 2
  retryOnStatusCodes:
    - 429

interCallDelay: 500

saveResults: true
outputDir: .
testCasesPath: ./test-cases.json
baselinePath: ./baseline.json
`;

const DEFAULT_TEST_CASES_JSON = `[
  {
    "id": "example-1",
    "category": "general",
    "question": "What can you help me with?",
    "expectedCriteria": [
      "Describes available capabilities",
      "Is polite and professional"
    ],
    "keywords": ["help"],
    "minResponseLength": 50
  }
]
`;

export interface InitOptions {
  /** Directory to write config files into. Defaults to cwd. */
  outputDir?: string;
  /** Override the config file name. Defaults to "agent-regression/config.yml". */
  configPath?: string;
  /** Override the test cases file name. Defaults to "agent-regression/test-cases.json". */
  testCasesPath?: string;
  /** Skip writing if files already exist. Defaults to true. */
  skipExisting?: boolean;
}

export interface InitResult {
  created: string[];
  skipped: string[];
}

/**
 * Scaffolds default config and test case files for agent-regression-testing.
 */
export async function init(options?: InitOptions): Promise<InitResult> {
  const base = options?.outputDir ?? process.cwd();
  const skipExisting = options?.skipExisting ?? true;

  const configPath = path.resolve(
    base,
    options?.configPath ?? "agent-regression/config.yml",
  );
  const testCasesPath = path.resolve(
    base,
    options?.testCasesPath ?? "agent-regression/test-cases.json",
  );

  const created: string[] = [];
  const skipped: string[] = [];

  for (const [filePath, content] of [
    [configPath, DEFAULT_CONFIG_YML],
    [testCasesPath, DEFAULT_TEST_CASES_JSON],
  ] as const) {
    if (skipExisting && (await fileExists(filePath))) {
      skipped.push(filePath);
      continue;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    created.push(filePath);
  }

  return { created, skipped };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
