# Architecture

`@cocreate/disk` provides the runtime-specific storage primitive behind one
small interface: `disk.execute({ operation, kind, path, data })`. Shared request validation, path rules and the per-instance queue live in
`src/core.js`; Node uses the local filesystem,
and browser builds use the Origin Private File System. Conditional package
exports select `src/server.js` or `src/client.js` without making callers choose
a second API.

Initialization creates a per-instance object and keeps runtime handles in that
instance's closure. The module does not maintain a global disk registry or
define higher-level database concepts. Callers choose paths and map their own
resources to file and directory operations.

CoCreate DB owns its config, branch, and leaf semantics. Its adapter maps those
resources to paths and invokes the attached Disk instance. Tree continues to
consume a single disk object with an `execute` method.

Operations throw on failures. Retry policy, logging, replication, and recovery
remain with the caller and the surrounding CoCreate primitives.


Disk owns a public `queue` and the independent writer behind `execute`. Queue
entries group pending and in-flight file requests by primary UUID and resource
UUID, keeping same-path operations serial while allowing different files to run
concurrently. Pending replacement and cancellation do not affect a request that
is already being written. Failed work remains visible until the host handles it.
DB owns indexing and file layout; it submits resolved data to Disk and its own
Persistence adapter independently. Neither storage adapter schedules the other.
