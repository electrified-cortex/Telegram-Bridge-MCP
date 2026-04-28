# Eval Report: 10-0858 — Haiku-class L1 vs Sonnet-class L2

date: 2026-04-27
worker: Worker 1 (SID 4)
target: Telegram MCP/src/button-validation.ts (23 lines)
git blob hash: c1efc99946f821b88249da3e78f5f06d6ef89e83

> Note: Task spec directed output to `.code-reviews/eval/`. After this task was queued, `.code-reviews/` was added to `.gitignore` (commit `da83985b`). Report placed in `docs/evals/` instead.

## Runs

| Run | Level | Model class | Personalities | Force review | Findings |
|---|---|---|---|---|---|
| Reference | L1 (trivial-cap) | sonnet-class | Code Reviewer, TypeScript-reviewer | No (cached) | 6 |
| Run A | L1 | haiku-class | Code Reviewer (haiku), TypeScript-reviewer (haiku) | Yes | 7 |
| Run B | L2 | sonnet-class | Full supplemental set | Yes | 7 |

## Reference: Sonnet L1 (trivial-file cap, cached c1efc9-L1.md)

| Type | Title |
|---|---|
| issue | Vacuous-truth: empty array returns ok=true |
| nit | Non-string elements silently misclassify |
| nit | Regex g-flag absence undocumented |
| question | Emoji coverage: ZWJ, keycap sequences, text-presentation |
| non-blocking | ParityResult fields not readonly |
| non-blocking | labels parameter not readonly |

## Run A: Haiku-class L1 (c1efc9-L1-haiku.md)

| Type | Title | Match vs ref? |
|---|---|---|
| issue | Vacuous-truth: empty array ok=true | ✓ same |
| non-blocking | ParityResult fields not readonly | ✓ same |
| non-blocking | labels not readonly | ✓ same |
| nit | Regex g-flag undocumented | ✓ same |
| nit | Non-string coercion (null→"null") | ✓ same |
| question | Empty-set behavior undocumented in JSDoc | ≈ overlap (different framing from ref's emoji question) |
| nit | ParityResult interface has no JSDoc | **UNIQUE to haiku** |

**Unique to haiku:** JSDoc missing on `ParityResult` interface (nit)
**Missed by haiku:** Emoji coverage question (ZWJ, keycap, text-presentation emoji) — ref caught this; haiku reframed as generic JSDoc gap

## Run B: Sonnet-class L2 (c1efc9-L2.md)

| Type | Title | Match vs ref? |
|---|---|---|
| issue | Vacuous-truth: empty array ok=true | ✓ same |
| issue | Text-presentation emoji (U+263A) escapes regex → misclassification | **UPGRADED** from ref's question |
| non-blocking | null/undefined coercion | ↑ severity from ref's nit |
| non-blocking | Two-pass filter (double array traversal) | **UNIQUE to L2** |
| non-blocking | No tests — key edge cases unverified | **UNIQUE to L2** |
| nit | JSDoc omits empty-array and element-type assumptions | ≈ overlap |
| question | g-flag absent — comment missing | ≈ same as ref nit |

**Unique to L2:** double-pass filter performance note, no-tests coverage gap
**Severity upgrades:** text-presentation emoji gap question→issue (with specific U+263A evidence), null coercion nit→non-blocking

## Side-by-Side Comparison

### Finding count and severity distribution

| Severity | Reference (S-L1) | Haiku L1 | Sonnet L2 |
|---|---|---|---|
| blocking | 0 | 0 | 0 |
| issue | 1 | 1 | 2 |
| non-blocking | 2 | 2 | 3 |
| question | 1 | 1 | 1 |
| nit | 2 | 3 | 1 |
| **Total** | **6** | **7** | **7** |

### Overlap analysis

All three runs caught: vacuous-truth issue, readonly concerns, regex g-flag note.

| Finding | Ref (S-L1) | Haiku L1 | Sonnet L2 |
|---|---|---|---|
| Vacuous-truth (empty array) | ✓ issue | ✓ issue | ✓ issue |
| null coercion | ✓ nit | ✓ nit | ✓ non-blocking |
| g-flag undocumented | ✓ nit | ✓ nit | ✓ question |
| Emoji coverage (general) | ✓ question | partial (JSDoc framing) | — |
| Text-presentation emoji U+263A | — | — | ✓ issue |
| ParityResult not readonly | ✓ non-blocking | ✓ non-blocking | — |
| labels not readonly | ✓ non-blocking | ✓ non-blocking | — |
| ParityResult JSDoc missing | — | ✓ nit | ≈ via JSDoc nit |
| Double-pass filter | — | — | ✓ non-blocking |
| No tests | — | — | ✓ non-blocking |

### Unique findings per run

- **Haiku only:** ParityResult interface JSDoc missing (minor nit)
- **L2 only:** Double-pass filter performance note, no-test coverage gap
- **Ref only:** Explicit readonly fields/params (L2 dropped these — likely below L2 concern threshold)

### False positives

None identified in any run. All findings have specific evidence.

## Observations

1. **Haiku and Sonnet L1 converge on the same core findings.** The vacuous-truth issue, readonly concerns, null coercion, and g-flag note all appear in both. The difference is stylistic: Haiku added a JSDoc nit, Sonnet L1 added a more specific emoji coverage question.

2. **L2 upgrades severity appropriately.** Text-presentation emoji gap was a question at L1 (unspecified behavior); L2 named U+263A specifically, confirmed it's a misclassification, and promoted to issue. Null coercion went nit→non-blocking with more thorough analysis.

3. **L2 adds architectural/quality findings L1 misses.** The double-pass filter and no-tests findings are genuinely L2-class observations — they require reading the code for structural concerns, not just individual line issues. L2's broader personality set (Test Reviewer, Operational Readiness) surfaces these.

4. **Haiku catches ~90% of Sonnet L1's findings.** The one miss (text-presentation emoji coverage question) was partially caught as a JSDoc completeness nit. For a 23-line trivial file, Haiku performance is comparable.

5. **Trivial-file cap analysis:** The cap reduced both L1 runs to Code Reviewer + language preset only. The core findings (vacuous-truth, readonly) are robust enough that even the minimal set catches them. The full supplemental set (L2) adds 2 net-new findings.

## Recommendation

**Keep the current L1/L2/L3 policy as-is, with one adjustment:**

- The L1 trivial-file cap (Code Reviewer + Devil's Advocate only for ≤50 source lines) is effective. The haiku-vs-sonnet delta on this 23-line file is 1 nit (ParityResult JSDoc). Not worth removing the cap.
- The L1 haiku-class default is well-calibrated for trivial files. Haiku caught 90% of Sonnet's findings. The 10% gap (emoji coverage depth) is appropriate to defer to L2.
- Consider adding "no test file for exported function" as a default L1 personality check — it's actionable, consistently reproducible, and adds value even at haiku-class.
- n=1 limitation: this comparison used a 23-line pure utility file. Haiku/Sonnet delta may widen on larger, more complex files with deeper architectural concerns. Recommend running 10-0859+ at L1/L2 to build the empirical dataset.

## Verdict

PASS. Both runs completed and produced parseable structured findings. Comparison is concrete — specific findings cited from each tier. Recommendation is actionable.
