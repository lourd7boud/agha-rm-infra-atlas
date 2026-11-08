# Dependency security remediation — 2026-11-08

Scope: the six-project pnpm workspace on `codex/sales-accounting-compliance`.
The separate `projects-app` manifests, container base images, host runtime,
and deployed server are outside this npm audit.

## Audit progression

| Stage | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial lockfile | 6 | 43 | 35 | 8 | 92 |
| Runtime patches | 2 | 2 | 10 | 3 | 17 |
| Test tooling patches | 0 | 1 | 0 | 0 | 1 |
| Zod 4.6.7 | 0 | 0 | 0 | 0 | 0 |

Counts are findings from `pnpm audit --json`, not counts of independent
exploitable routes. A clean dependency audit is not a complete application audit.

## Changes and compatibility decisions

- Next.js 15.5.21 → 15.5.29, retaining the existing major and application router.
- Sharp 0.34.5 → 0.35.5, including its use by Next.js.
- Multer 2.5, PostCSS 8.5.32, proxy-addr 2.0.8, body-parser 2.4, qs 6.17.1,
  xmldom 0.8.15, source-map-js 1.2.2, and patched nanoid/brace-expansion tracks.
- Replaced unbounded minimum-version overrides with major-bounded ranges.
  Undici stays on patched 7.30.2 rather than selecting version 8 implicitly.
- Vitest and coverage provider 4.1.12, with explicit Vite 7.3.7 dependencies.
  This removes the old vulnerable Tinypool and test-exclude dependency chains.
- Patched esbuild on the existing supported tracks. The legacy Drizzle loader
  still needs an override until its upstream dependency is retired.
- Core and shared contracts use Zod 4.6.7. The existing Anthropic SDK declares
  compatibility with both Zod 3 and 4; its peer now resolves to the same Zod 4.
  No SDK major upgrade or application-wide schema rewrite was needed.

The oversized-collection regression first failed with Zod 3 (10,000 element
validations despite a maximum of 3), then passed with Zod 4 (zero element
validations). It tests the actual vulnerable behavior rather than the version.

## Verification

- Runtime-focused regression: 21 tests passed.
- Test-tooling stage: Core 1,369 tests, Web 158, signing bridge 10, preview 3 passed.
- Zod stage: bounded-collection regression passed.
- All workspace TypeScript checks passed.
- Frozen-lockfile install passed.
- Patched Drizzle and tsx CLI version checks passed.

Final full-suite/build outcomes are recorded in the local release review.
The 29 infrastructure-dependent Core tests and missing authenticated browser
fixtures remain separate release gates; dependency updates do not satisfy them.

## Sources

- [Next.js image optimization advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw)
- [Tinypool advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)
- [Zod collection validation advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [Vitest 4 migration guide](https://v4.vitest.dev/guide/migration)
- [Zod 4 migration guide](https://zod.dev/v4/changelog)
