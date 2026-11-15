import { defineConfig } from "vitepress";

export default defineConfig({
  title: "agent-regression-testing",
  description: "Regression testing for AI agents: LLM-as-judge scoring, deterministic assertions and baseline comparison.",
  base: "/agent-regression-testing/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/api" },
      { text: "Changelog", link: "https://github.com/indigolain/agent-regression-testing/blob/main/CHANGELOG.md" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Test Cases & Scoring", link: "/guide/test-cases-and-scoring" },
          { text: "Choosing a Judge", link: "/guide/judges" },
          { text: "Deterministic Assertions", link: "/guide/assertions" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "API", link: "/reference/api" },
          { text: "Configuration", link: "/reference/configuration" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/indigolain/agent-regression-testing" },
      { icon: "npm", link: "https://www.npmjs.com/package/agent-regression-testing" },
    ],
    editLink: {
      pattern: "https://github.com/indigolain/agent-regression-testing/edit/main/docs/:path",
    },
    search: { provider: "local" },
    outline: "deep",
  },
});
