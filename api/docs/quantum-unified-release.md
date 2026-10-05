# Quantum unified Directus release

Task: https://app.clickup.com/t/123vqc2c1m3

The common release consists of `quantum_directus_api@19.0.3-quantum.9`, `quantum_directus@10.10.8-quantum.9` and
`quantum_directus_app@12.0.3-quantum.9`. Build from `10.10.8-quantum`; the default branch is an older upstream tree.

## Runtime contract

Run Script uses the existing trusted-admin host-process executor. It is not an isolated sandbox: scripts have
host-process authority and must only be authored by trusted administrators. `isolated-vm` and its native Node snapshot
constraint are absent from all three production package manifests and the packed closure. The embedded V2 host retains
its own Flow and marketplace admission restrictions.

Schema cache reads reuse a deeply frozen process-owned object. Shared/local hash and TTL remain authoritative.
`CACHE_SCHEMA_FREEZE_ENABLED=false` returns a new mutable copy to each caller. `CACHE_SCHEMA_SYNC_TIMEOUT` is a positive
integer in milliseconds, default `10000`. The default freeze switch is `true`.

The schema build bus transports `{ schema }`. A failed builder sends null; old ready-only messages, subscription
failures and timeouts enter the bounded retry path. Listeners/timers are cleaned up and publish failure cannot retain
the build lock. Redis schema invalidation is independent of data-cache auto purge.

The consumer patch is now fork-owned: root exports, password-policy literal flags/redaction and get-schema retry
ordering already existed on this base; this release adds regex state reset, schema reuse/freezing, schema transport,
independent invalidation and configurable synchronization timeout. The schema parts of Quantum PR #3124 are included;
its deployment changes are excluded. There are no Directus migration differences from the previous `.2` release.

## Validation and publication

`quantum-embedded.yml` gates embedded tests, environment tests, full builds, documentation, seven database Flow
blackboxes and packed Node 18/22/Bun consumers. Packed consumers cover embedded startup/restart, public CLI, trusted Run
Script, exact sibling dependencies, bundled env defaults and native dependency absence. The Redis smoke uses three
independent processes and a synthetic schema builder; its real waiters exercise schema transport and local invalidation
with auto purge turned off. Actual database bootstrap is covered separately by artifact and blackbox tests.

After successful source CI and Quantum V1/V2 packed-consumer validation, push `quantum-publish/10.10.8-quantum.9` at the
validated source SHA. The tag cannot use an upstream `v*` name. The workflow refuses a source without successful CI.

Packing normalizes manifest key order and archive timestamps so identical source builds can be retried with identical
bytes. Publication records previous latest tags and SHA512 tarball integrities in the `quantum-release-<sha>` artifact.
All three immutable exact versions are published and compared with local tarball bytes before changing any latest tag.
The internal publication tag is removed after immediate latest promotion; it is not a canary trial cycle. If promotion
fails, all previous latest tags are restored. An existing exact version must match bytes; a mismatch requires a new
version.

For rollback, restore each previous latest tag using the release-proof artifact and revert the Quantum consumer's
manifests and lockfile together. Restoring npm tags alone does not affect consumers pinned to exact `.9` versions. Do
not unpublish or overwrite exact versions. No tenant or production rollout is performed by this package release
workflow.
