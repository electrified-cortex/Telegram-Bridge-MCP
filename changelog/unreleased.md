# [Unreleased]

<!-- Add entries here as work is merged. Format: -->
<!-- - Type: description -->

## Fixed

- `.github/workflows/ci.yml`: Bumped `pnpm/action-setup` from v6.0.1 to v6.0.2; v6.0.1 had a PATH ordering bug where the bootstrap pnpm (v11.0.0-rc.2) shadowed the installed version, causing `ERR_PNPM_BROKEN_LOCKFILE` on valid lockfiles
