# Spike: node_modules Pre-staging for TMCP Worktrees

**Date:** 2026-04-26  
**Status:** Draft — awaiting operator decision  
**Task:** 20-0841

---

## Executive Summary

pnpm 10 on this machine already uses NTFS hardlinks from its content-addressable store (`<pnpm-global-store>`) for all package files, and uses Windows Junctions (not symlinks) for the virtual-store → top-level package links. Candidate 3 (pnpm store reuse) is already largely realized by pnpm's architecture: a fresh `pnpm install --frozen-lockfile` in a new worktree when all packages are in the global store is almost entirely a relinking operation, not a download. Candidate 1 (shared virtual store via `--virtual-store-dir`) is already used organically by several existing worktrees and is the fastest option; the main risk is concurrent `pnpm install` runs corrupting the shared `.pnpm` directory. **The recommended path is Candidate 1 (explicit shared virtual store) with a mutex guard on Overseer-side install, or Candidate 4 (Overseer hook on worktree-create) which hides the round-trip from Workers entirely.**

---

## Observed Reality (Pre-investigation Findings)

Before evaluating candidates, key facts were established by inspecting existing worktrees:

| Finding | Detail |
|---|---|
| pnpm version | 10.0.0 (pinned in `package.json`) |
| Global store | `<pnpm-global-store>` (content-addressed, 256 hash buckets) |
| Link mechanism | NTFS **Junctions** for virtual-store entries; **hardlinks** for actual package files within `.pnpm` |
| `.npmrc` | `frozen-lockfile=true`, `ignore-scripts=true` |
| `onlyBuiltDependencies` | `esbuild`, `onnxruntime-node`, `protobufjs`, `sharp` — these 4 run post-install scripts; `ignore-scripts=true` normally suppresses all others |
| Virtual store packages | 326 entries in `node_modules/.pnpm` |
| Top-level hoisted packages | 14 direct packages in `node_modules/` |
| Native binaries present | `esbuild.exe` (win32-x64), `onnxruntime-node` NAPI v3 win32/x64, `opusscript` WASM (no `.node` file — WASM is portable) |
| Developer Mode | Not confirmed active (registry key returned empty — may be off) |

**Two distinct worktree install patterns already exist in the repo:**

- **Group A** (10-774, 10-777, 10-0514, 10-0517, 15-782, 10-0823): `virtualStoreDir` points to **main repo's** `node_modules/.pnpm`. Top-level Junctions point into the main repo's `.pnpm`. These share hardlinks: `zod/package.json` has **inode 844424930937442, Links: 12**, same inode as the main checkout.
- **Group B** (15-0832, 20-0822, release-7.2): `virtualStoreDir` points to their **own** `node_modules/.pnpm`. Top-level Junctions point locally. Files have `Links: 1` (isolated, though still hardlinked *from the global store* when originally installed).
- **Outliers** (10-774, 10-777): Isolated copies with `Links: 1` — these appear to have been installed with an older pnpm version or without access to the global store.

---

## Candidate 1: Symlink / Junction Shared node_modules

### Mechanism
Configure new worktrees' pnpm to point `virtualStoreDir` at the main repo's `node_modules/.pnpm` via `.npmrc`:
```
virtual-store-dir=../../node_modules/.pnpm
```
Or pass `--virtual-store-dir` at install time. pnpm will create its Junction-based top-level `node_modules/` within the worktree, all pointing into the shared `.pnpm`.

### Observed Status
**Already in use organically** for Group A worktrees. The main checkout's `.pnpm` is the de-facto shared virtual store for ~8 active worktrees.

### Pros
- Zero additional disk cost (no duplication of package files)
- Fastest possible setup: only Junction creation required, no file I/O
- pnpm natively supports `--virtual-store-dir`; the `.modules.yaml` tracks this correctly
- No Developer Mode required — Junctions work without elevated privileges on Windows

### Cons
- **Concurrent install risk**: if two Workers or Overseer trigger `pnpm install` simultaneously against the shared `.pnpm`, the directory can be corrupted (pnpm is not designed for concurrent multi-writer access to a single virtual store)
- If the main branch's lockfile diverges from a worktree's branch (e.g., a worktree adds a new dependency), the shared virtual store becomes stale/incorrect for that worktree
- Deleting the main checkout's `node_modules` would break all sharing worktrees

### Security Posture
No additional surface. All packages originate from the same lockfile + global store. The shared virtual store does not introduce new write paths.

### Windows Caveats
- Junctions do not require Developer Mode or SeCreateSymbolicLinkPrivilege
- Junction targets are absolute paths; if the repo is moved, all Junctions break
- NTFS junction semantics: they are transparent to most tools but `robocopy` and `xcopy /E` will dereference them, potentially duplicating large trees

### Recommendation
**Conditional use** — already deployed organically; formalize with explicit `.npmrc` setting `virtual-store-dir` pointing to the main repo, plus a Overseer-level mutex preventing concurrent installs. Add a guard: if worktree branch diverges in lockfile hash, fall back to local install.

---

## Candidate 2: Hardlink-Based Copy at Worktree-Create Time

### Mechanism
At worktree-create time, Overseer runs a script that hardlinks (`robocopy /MIR /SL` or similar) the main repo's `node_modules` tree into the new worktree. Junction targets are rewritten to point locally.

### Pros
- Worktree is fully self-contained (no dependency on main checkout's node_modules)
- No concurrent-write risk after copy
- Hardlinks for actual files cost no additional disk space for package content

### Cons
- **Junctions cannot be hardlinked** — they must be recreated. A hardlink copy of `node_modules` will copy the Junction *target contents*, not the Junction pointer, unless `robocopy /SL` (copy symbolic links as-is) is used. Windows junctions and `/SL` interact poorly.
- Recreating 326 Junctions programmatically requires iterating the entire `.pnpm` tree and calling `cmd /c mklink /J` for each — complex, brittle script
- pnpm reads `.modules.yaml` to validate install state; copied `.modules.yaml` will have absolute paths pointing to the old worktree location, causing pnpm to think it needs to reinstall
- Package file hardlinks *do* survive (same inode), but `.modules.yaml` path mismatch triggers pnpm validation failure

### Security Posture
Same as Candidate 1. No new attack surface. However, a buggy copy script that references wrong paths could silently leave a broken `node_modules` that appears present but fails at runtime.

### Windows Caveats
- `robocopy` with `/SL` does not reliably replicate Windows Junctions as Junctions — it copies junction targets as real directories
- NTFS hardlinks are per-volume; the worktree must be on the same drive as the source (confirmed: all worktrees are on `D:`)
- Re-signing `.modules.yaml` with correct `virtualStoreDir` is mandatory but complex

### Recommendation
**Avoid** — the Junction recreation problem makes this approach fragile and requires reimplementing significant pnpm internals. The risk of a silently-broken `node_modules` is high.

---

## Candidate 3: pnpm Store Reuse (Status Quo + Timing Analysis)

### Mechanism
The global pnpm store at `<pnpm-global-store>` already contains all package files as content-addressed blobs. When `pnpm install --frozen-lockfile` runs in a new worktree, pnpm does **not** re-download packages that are already in the store — it only hardlinks them into the local `node_modules/.pnpm` and creates Junctions.

### Observed Evidence
- The store has 256 hash-bucket directories, each with ~330 files = ~85k content-addressed files stored
- Files in Group B worktrees (isolated `.pnpm`) have `Links: 1`, confirming they were hardlinked from the global store at install time (not downloaded)
- The 326 packages in `.pnpm` have all content already in the global store

### Actual Cost of a Fresh Install (Store Hot)
The round-trip is not download latency — it is:
1. pnpm reads `pnpm-lock.yaml` (3,463 lines)
2. Validates store integrity for each of ~326 packages
3. Creates hardlinks: ~85k files
4. Creates 326 Junctions in `node_modules/.pnpm`
5. Creates 14 top-level Junctions in `node_modules/`
6. Writes `.modules.yaml` and `.pnpm-workspace-state.json`

On local NVMe/SSD this is typically 5–30 seconds. The Overseer round-trip overhead is not the install itself but the **coordination lag** (Worker blocks → DMs Overseer → Overseer acts → Worker resumes).

### Pros
- Zero implementation cost — already works
- No script maintenance burden
- pnpm validates install integrity automatically
- Supports lockfile divergence correctly per-worktree

### Cons
- Still requires an explicit Overseer action per worktree (the coordination round-trip)
- Workers cannot self-service (policy: Workers cannot run `pnpm install`)

### Security Posture
Strongest posture of all candidates. Each install is independently validated against the lockfile and store checksums.

### Windows Caveats
- None additional — this is exactly what pnpm is designed to do
- `ignore-scripts=true` in `.npmrc` means post-install scripts are suppressed globally; `onlyBuiltDependencies` allowlist overrides this for esbuild/onnxruntime-node/protobufjs/sharp

### Recommendation
**Use as fallback** when lockfile diverges. Combined with Candidate 4, the actual round-trip is eliminated for the common case.

---

## Candidate 4: Worktree-Create Hook (Overseer Automation)

### Mechanism
Overseer wraps `git worktree add` in a script that immediately runs `pnpm install --frozen-lockfile` (or the shared-virtual-store variant) before handing the worktree path to a Worker. Workers never wait — they receive a ready worktree.

### Feasibility Assessment
- `claim.ps1` (`tasks/.engine/claim-task/claim.ps1`) is the canonical task-claiming script. It does `git mv` + `git commit` but does **not** create worktrees.
- Worktree creation appears to be manual Overseer/operator work (no `worktree-add` wrapper script found in `tasks/.engine/` or `tools/`)
- Git has no native `post-worktree-add` hook. A wrapper script is required.
- Overseer's tool list includes `execute` — it can run arbitrary scripts, including a `New-Worktree.ps1` wrapper

### Implementation Shape
```powershell
# New-Worktree.ps1 (Overseer-level, not Worker-level)
param([string]$Branch, [string]$Path)
git -C $RepoRoot worktree add $Path $Branch
# Option A: shared virtual store (fast, ~2s)
pnpm --dir $Path install --frozen-lockfile --virtual-store-dir ../../node_modules/.pnpm
# Option B: isolated install (safe, ~15s)
pnpm --dir $Path install --frozen-lockfile
```

### Pros
- Eliminates Worker wait entirely — worktree arrives pre-staged
- Single enforcement point: all worktrees created via the wrapper get node_modules automatically
- Lockfile-divergence is handled naturally (install reads the worktree's lockfile)
- No policy change needed — Overseer already owns worktree creation

### Cons
- Requires authoring and maintaining a wrapper script
- Adds ~5–30s to worktree creation time (acceptable; Overseer is non-blocking)
- Must be documented so future Overseers don't bypass it with bare `git worktree add`

### Security Posture
Equivalent to Candidate 3 (each install is validated). Overseer retains exclusive `pnpm install` authority. No Worker self-service.

### Windows Caveats
- `pnpm --dir <path>` is the correct flag for running pnpm in a different directory without `cd`
- The `GIT_INDEX_FILE` safety rule applies: always `unset GIT_INDEX_FILE` before any git operation inside the script
- Path separators: use forward slashes or `Join-Path` — pnpm on Windows handles both

### Recommendation
**Use** — this is the cleanest solution. It keeps the current security policy intact, eliminates Worker round-trips, and requires only a small Overseer-level script. Pair with Option A (shared virtual store) for speed or Option B (isolated) for safety; see Decision Needed section.

---

## Candidate 5: CI-Style Cache Tarball

### Mechanism
After a fresh install, tar + compress the `node_modules` directory. Store the archive named by lockfile hash. On worktree-create, check if cache exists → extract; else fall back to fresh install.

### Pros
- Cache restore is faster than relinking if archive is on local disk (no pnpm validation overhead)
- Portable: archive can be shared across machines or CI systems

### Cons
- **Native binaries**: `esbuild.exe`, `onnxruntime-node` NAPI v3, and `protobufjs` compiled files are platform-specific and must match the OS+arch. Archive is not portable across platforms.
- **Junctions are not preserved by tar** — standard tar on Windows does not capture NTFS Junction points. Extraction produces plain directories, breaking pnpm's `node_modules` structure. pnpm would then fail to validate the install.
- Cache invalidation requires computing and comparing lockfile hashes on every worktree-create — adds script complexity.
- Archive size for 326 packages (even compressed) is likely 200–500MB. Each new lockfile version requires a new archive.
- 7-Zip on Windows can preserve NTFS reparse points, but this is non-standard and tooling support varies.
- pnpm's `.modules.yaml` contains absolute paths; a restored archive from a different path would have stale paths.

### Security Posture
Weaker than Candidates 3/4: a cached archive might contain packages from a superseded lockfile if invalidation logic fails. An attacker who can write to the cache directory can substitute packages.

### Windows Caveats
- Junction preservation in archives requires 7-Zip with specific flags (`7z a -snl`) — not available in standard Windows tar
- Even if Junctions are preserved, extracted absolute Junction targets may be wrong if repo path differs
- `ignore-scripts=true` is set, but native binaries (`esbuild.exe`, NAPI `.node` files) are pre-compiled — they survive extraction correctly as long as the platform matches

### Recommendation
**Avoid** — the Junction-preservation problem makes this approach unreliable on Windows without significant tooling investment. The disk cost is high and cache invalidation is a maintenance burden.

---

## Candidate 6: Accept Current Friction (No Change)

### Mechanism
Status quo: Workers block and DM Overseer when they encounter a worktree without `node_modules`. Overseer runs `pnpm install`. Worker resumes.

### Pros
- Zero implementation cost
- Maximum install integrity (each install independently validated)
- No scripts to maintain or audit

### Cons
- One coordination round-trip per new worktree (typically 1–5 minutes of wall-clock delay)
- Workers sit idle during the wait, consuming session lifetime
- Overseer must context-switch to handle the request
- As task throughput scales (more concurrent Workers, more worktrees), this friction multiplies

### Security Posture
Best possible — each install is fully validated, no pre-staging scripts, no shared state.

### Recommendation
**Accept as interim** while Candidate 4 is implemented. Not viable long-term at scale.

---

## Top Recommendation

**Per-repo `setup-worktree.ps1` (or bash equivalent) on the Worker permissions allowlist, backed by Candidate 1 (shared virtual store) for speed.**

Following operator guidance (2026-04-26), the framing shifts from an Overseer-exclusive hook to a Worker-accessible sanctioned script. Workers can self-service worktree setup without an Overseer round-trip, because the script itself is pre-approved and audited — Workers do not gain `pnpm install` authority generally, only the right to invoke this specific, controlled entry point.

Rationale:
1. Workers can self-service: a pre-approved `setup-worktree.ps1` on the permissions allowlist eliminates the coordination round-trip without broadening Worker privileges. The script is the enforcement boundary, not the agent role.
2. Candidate 1 is already working organically for ~8 of the active worktrees, proving it is safe and functional on this machine. Formalizing it in the script adds the `.npmrc virtual-store-dir` flag and makes it intentional rather than accidental.
3. The shared virtual store approach (`--virtual-store-dir ../../node_modules/.pnpm`) means worktree setup is ~2 seconds (only Junction creation; all package content is already hardlinked), vs 15–30s for a full isolated install.
4. The main risk (concurrent installs corrupting the shared `.pnpm`) is mitigated by the fact that Workers run sequentially per task. A file-lock inside the script can guard against the rare case of concurrent worktree setup across multiple active Workers.
5. A lockfile-hash check can fall back to isolated install for worktrees on branches with dependency changes.
6. The script is repo-specific (JS/TS repos only). Non-JS repos do not need or receive this script.

**If operator prefers maximum isolation**, the script can use Option B (isolated install per worktree). Cost is ~15–30s per worktree setup, paid by the Worker during task startup rather than requiring Overseer intervention.

---

## Operator Guidance (2026-04-26)

The operator provided the following direction via voice message:

- **Workers should self-service worktree setup** via a pre-approved `setup-worktree` script. The goal is fluid, frictionless `pnpm build` / `pnpm lint` / `pnpm test` inside a worktree — no Overseer round-trip required.
- **The script is repo-specific** — only JavaScript/TypeScript repositories need this. It is not a workspace-wide tool applied to every repo.
- **Placement:** a per-repo script (e.g., `tools/setup-worktree.ps1` in the TMCP repo) or a workspace-level tool. The operator suggested a `tools/` location within the repo as the leading option.
- **Permissions allowlist:** the script would be explicitly added to the Worker permissions allowlist, making it a sanctioned, audited entry point. Workers do not gain general `pnpm install` authority — only the right to invoke this specific script.
- **Framing shift for Candidate 4:** the original write-up positioned worktree setup as an Overseer-owned hook. The operator's intent is to make this Worker-accessible, removing the coordination bottleneck entirely. The script is the enforcement boundary.

---

## Decision Needed

The following operator decisions are required before implementation:

1. **Shared virtual store vs. isolated per-worktree?**
   - Shared (Option A): ~2s setup, slight concurrent-install risk, less disk
   - Isolated (Option B): ~15–30s setup, fully independent, more disk (~50–150MB per worktree for hardlinks; actual bytes on disk ~0 extra since hardlinks)
   - *Recommended: Shared (Option A), given Overseer serializes installs*

2. **Where does the wrapper script live?**
   - **Leading suggestion (per operator):** `tools/setup-worktree.ps1` (or `tools/setup-worktree.sh`) within the TMCP repo — per-repo, co-located with other repo tooling
   - Alternative: workspace-level tool (e.g., `<workspace-root>/tools/setup-worktree.ps1`) for shared use across JS/TS repos
   - Prior suggestion: `tasks/.engine/worktree-create/New-Worktree.ps1` alongside `claim.ps1` (Overseer-owned; now lower priority given Worker self-service framing)

3. **Should existing worktrees without node_modules be back-filled?**
   - Worktrees currently lacking node_modules: 20-0841 (this task), 10-0831, 10-0835, 15-783, 30-470, and others
   - One-time Overseer batch install can cover these

4. **Lockfile-divergence policy?**
   - If a worktree branch modifies `pnpm-lock.yaml`, the shared virtual store will not have the new packages
   - Policy options: (a) always fall back to isolated install if lockfile hash differs from main; (b) always use isolated; (c) accept that package-adding tasks must request Overseer for an isolated install

5. **Mutex / serialization guard?**
   - If Overseer ever spawns multiple sub-agents that could simultaneously trigger worktree-creates, a file-lock or sequential queue is needed for installs against the shared virtual store
   - Is concurrent worktree creation a current or anticipated scenario?
