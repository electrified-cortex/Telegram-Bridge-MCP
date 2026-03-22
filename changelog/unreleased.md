# [Unreleased]

## Added

- `import_profile` tool — apply profile data inline without reading from disk; accepts same structure as profile JSON files
- Code Reviewer agent — adversarial sub-agent that reviews changed files for bugs, security issues, and yellow flags
- Task Runner now includes a mandatory review loop: dispatches Code Reviewer after implementation, iterates fixes until clean (max 3 rounds)

## Changed

- Default voice speed updated from 1.25x to 1.1x in Overseer, Worker, and Curator profiles
