---
Created: 2026-04-09
Status: Completed
Host: local
Priority: 10-418
Source: Operator directive — security audit before v6 merge
Depends: 10-417 (task relocation — ensures no task doc leakage)
---

# Security Audit — Information Leakage Scan on dev Branch

## Objective

Comprehensive security audit of the Telegram MCP `dev` branch scanning for any
information leakage. This is critical — any leaked secrets, internal hostnames,
operator PII, or workspace-internal references in a public repo could be
disastrous.

## Scope

- **Branch:** `dev` (current HEAD after all v6 work merged)
- **Repo:** Telegram MCP (this repo)
- **Focus:** Information leakage, not code quality

## What to Scan For

### Critical (block merge if found)

- Hardcoded API keys, tokens, passwords, or secrets
- Bot tokens (Telegram or otherwise)
- Internal hostnames (private workspace hostnames, IP addresses, LXC IDs)
- Operator PII (names, emails, usernames beyond public GitHub profile)
- File paths containing usernames or private directory structures
- References to private workspace internals
- Session tokens, PINs, or authentication material in logs/comments

### High (fix before merge)

- Overly detailed error messages that reveal internal architecture
- Debug logging that exposes sensitive state
- Comments referencing internal infrastructure or private repos
- Task IDs or internal references that leak organizational structure

### Medium (note and track)

- Dependency versions with known CVEs
- Overly permissive file permissions in scripts
- Missing input sanitization on user-facing parameters

## Procedure

1. **Automated scan:** `grep -rn` for patterns:
   - IP addresses: `\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b`
   - Hostnames: internal domain names, LXC/VM identifiers specific to your infrastructure
   - Secrets: `token|secret|password|api[_-]?key|bearer`
   - Paths: `D:\\|C:\\|/home/|/Users/`
   - PII: operator names, emails (check git log too)
2. **Manual review:** Scan all `src/` files for hardcoded values
3. **Git history scan:** `git log --all --diff-filter=A -- '*.env*' '*.key' '*.pem'`
4. **Subagent verification:** Dispatch Code Reviewer subagent with security focus
   on the full diff (`git diff master..dev`)

## Acceptance Criteria

- [ ] Automated scan completed — all pattern matches reviewed
- [ ] Manual review of src/ completed
- [ ] Git history checked for accidentally committed secrets
- [ ] Subagent security review completed
- [ ] Report filed with findings (even if clean)
- [ ] Any critical/high findings fixed before marking complete
