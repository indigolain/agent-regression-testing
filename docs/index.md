---
layout: home

hero:
  name: agent-regression-testing
  text: Regression tests for AI agents
  tagline: Score agent responses with an LLM judge, assert on the tools and state they touch, and catch regressions against a baseline.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/indigolain/agent-regression-testing

features:
  - title: LLM-as-judge
    details: Check responses against plain-language criteria, with a text judge or a structured judge that scores every criterion in one call.
    link: /guide/judges
  - title: Deterministic assertions
    details: Assert which tools the agent called, with which arguments and in what order, which skill it triggered, and what changed in your database.
    link: /guide/assertions
  - title: Baseline regressions
    details: Compare each run against a saved baseline and fail CI when scores drop or assertions stop passing.
    link: /guide/test-cases-and-scoring#baselines-and-regressions
  - title: Bring your own models
    details: Inject your agent and judge as plain functions. Thresholds, weights and file paths live in a YAML config.
    link: /reference/configuration
---
