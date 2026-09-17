# Embedded Flow policy

`quantum_directus_api@19.0.3-quantum.7` adds the optional public factory option `flows: { enabled: false }`. Omitting it
preserves the enabled behavior of `.6`. The option is validated, copied and frozen before runtime initialization. It is
fixed before extensions initialize and cannot be changed within a manager lifetime.

A disabled runtime does not query Flow definitions, register operations or Flow triggers, subscribe to the Flow bus, or
publish reload events. Local reload is a no-op and incoming reload messages are ignored. Direct operation,
webhook/manual and internal execution paths reject with `FORBIDDEN`. Closing remains idempotent; failed startup retains
the existing rollback ownership. Programmatic extension hooks continue to work independently of database-defined Flow
triggers.

This policy does not edit database definitions or change another process. Hosts must separately block management HTTP
routes when Flow administration is outside their scope. The Quantum V2 host always supplies `enabled: false` and exposes
no switch to enable it. V1 remains on its independently patched `.2` package.

`quantum_directus_api@19.0.3-quantum.8` closes a gap in the disabled policy: the extension manager no longer scans and
imports the built-in `operations` modules when Flows are disabled. A disabled `FlowManager` discarded those
registrations anyway, but the scan itself required the package's `operations` directory next to the manager, which a
bundled consumer artifact does not ship, so an enabled embedded Directus failed to bootstrap with `ENOENT`. Enabled
runtimes keep loading built-in operations exactly as before. `FlowManager.isEnabled` exposes the fixed policy for such
callers; an unconfigured manager counts as enabled. Starting with `.8`, API-only releases run through the generic
`quantum-api-publish.yml` workflow: the `quantum-api-publish/<version>` tag names the version, the tagged commit must be
in the `10.10.8-quantum` history, and no per-release workflow copy or manual source SHA is needed.

Validation: `pnpm --filter quantum_directus_api test:embedded`, including `flows-disabled.test.ts`, `embedded.test.ts`,
`app.test.ts` and the existing Flow scheduling/lifecycle and programmatic hook suites. Consumer validation uses all
active trigger types in a disposable PostgreSQL-compatible database.
