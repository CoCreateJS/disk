# Architecture

`@cocreate/disk` provides the runtime-specific storage primitive behind one
small interface: `disk.execute({ operation, kind, path, data })`. Node uses the
local filesystem; browser builds use the Origin Private File System. Conditional
package exports select `src/server.js` or `src/client.js` without making callers
choose a second API.

Initialization creates a per-instance object and keeps runtime handles in that
instance's closure. The module does not maintain a global disk registry or
define higher-level database concepts. Callers choose paths and map their own
resources to file and directory operations.

CoCreate DB owns its config, branch, and leaf semantics. Its adapter maps those
resources to paths and invokes the attached Disk instance. Tree continues to
consume a single disk object with an `execute` method.

Operations throw on failures. Retry policy, logging, replication, and recovery
remain with the caller and the surrounding CoCreate primitives.
