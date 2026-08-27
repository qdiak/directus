---
description: Migrate API extensions that request the removed sandbox runtime.
contributors: Nils Twelker, Kevin Lewis, Esther Agbaje
---

# Sandboxed API Extensions Are Not Supported

Directus no longer includes a sandbox runtime for API Extensions, Hybrid Extensions, or server-side Bundle entries. When
a Hook, Endpoint, or Operation manifest requests the sandbox runtime, startup stops with this error:

```text
Sandboxed API extensions are not supported.
```

This startup failure is intentional and applies regardless of `EXTENSIONS_MUST_LOAD`. It prevents a package from
silently running with broader permissions than its manifest requested.

Marketplace packages that request the sandbox runtime are also rejected in every Marketplace trust mode. The deprecated
`MARKETPLACE_TRUST=sandbox` value is only an alias for `MARKETPLACE_TRUST=app`; it emits a startup warning and does not
restore sandbox execution.

## Migration

Remove sandboxed API extensions before upgrading. If an extension is still required, review its complete source and
dependency chain, remove the sandbox request, and deploy it only if you are prepared to trust it with the full
permissions of the Directus backend process.

There is no automatic or permission-preserving migration from the former Sandbox SDK. Replace Sandbox SDK calls with
normal extension APIs only after the extension has passed that security review.
