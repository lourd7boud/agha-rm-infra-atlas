# Preserved parser worktree diffs — 2026-11-08

These are snapshots of all tracked uncommitted edits in the four older Claude
worktrees at the time of review. Source worktrees and branches were left intact.
The patches are historical review evidence; they are not runtime modules or
instructions to apply them to the current release.

All four variants concern ordinary/NBSP/narrow-NBSP whitespace normalization in
portal response/guarantee text and French-formatted MAD amounts. One includes
fixture and regression-test edits. Equivalent runtime behavior and the money
regression were already integrated in commit `8f5ec39` and remain in the current
release. No unfinished independent feature was found in these diffs.

Each patch is captured with `git diff --binary` against its recorded base below.
Reverse check against the unchanged source worktree verifies that the snapshot
matches its current tracked edits. Nothing was restored, reset or deleted there.

| Worktree | Branch | Base commit | Patch |
| --- | --- | --- | --- |
| jovial-tu-deaac2 | claude/epic-babbage-9608b8 | `569269206d02dd4f835df4232a71b675d976b3e9` | [snapshot](jovial-tu-deaac2.patch) |
| priceless-lovelace-f57465 | claude/busy-solomon-b5cf0a | `d12308642e89ab1cf6ea8803251e52beab188d4a` | [snapshot](priceless-lovelace-f57465.patch) |
| silly-bohr-38dc7d | claude/goofy-hellman-c13b62 | `0565a2946480be88195b09bbd7ae7d45a4864244` | [snapshot](silly-bohr-38dc7d.patch) |
| xenodochial-jang-265caa | claude/focused-tu-fbb0c3 | `9fd67806aa519545239930e787e754908cbacf70` | [snapshot](xenodochial-jang-265caa.patch) |

Generated dependencies, build output, ignored local environment files and other
secrets are not part of these patches. The working application source is in the
main checkout; keep using its frozen lockfile for reproducible installs.
