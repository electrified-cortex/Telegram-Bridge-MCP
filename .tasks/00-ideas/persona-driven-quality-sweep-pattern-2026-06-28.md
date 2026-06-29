---
type: pattern
captured: 2026-06-28
source: TG 80301 (Wave 3 execution, now complete)
status: reusable — apply on future quality passes
---

# Pattern: Persona-Driven Quality Sweep

## What it is

Instead of a generic "find bugs" prompt, each quality agent gets a strong personality /
persona that defines its quality bar. The persona IS the filter — no separate verification
needed. Proven effective on TMCP Wave 3 PR.

## Personas (battle-tested)

### Unit Test Snob
Sonnet agent. Maximally critical of test quality. "The only thing that would satiate it
is absolute perfection." Reviews all test files. Looks for: raw string literals instead
of constants, behavior asserted over content, redundant setup, dead assertions.

### Minimalist
Sonnet agent. "Hates seeing sloth." Hunts bloat and redundancy across all files. Applies
to source AND tests. Asks: does this need to exist? Can it be half as long?

### TypeScript Quality Snob
Sonnet agent, source files only. Extremely high TS quality bar. "Anything even remotely
outside what it would expect to see → this has got to change." Looks for:
- Loose typing (any, unknown without guard, implicit returns)
- Non-idiomatic patterns
- Readability issues

### Docs ↔ Service Messages Drift Auditor
Compares inline service message strings against docs. Flags where they've diverged.

## When to apply

- Before major releases / after large feature batches
- When code quality debt has accumulated
- As a final sweep before a PR is merged

## How to run

Fan out one agent per file cluster per persona. Each agent returns findings.
Synthesize into a single PR. No separate verification pass — the persona standard IS the bar.
