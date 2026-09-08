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

Validation: `pnpm --filter quantum_directus_api test:embedded`, including `flows-disabled.test.ts`, `embedded.test.ts`,
`app.test.ts` and the existing Flow scheduling/lifecycle and programmatic hook suites. Consumer validation uses all
active trigger types in a disposable PostgreSQL-compatible database.
