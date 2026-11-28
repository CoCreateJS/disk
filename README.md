# CoCreate Disk

`@cocreate/disk` provides one composable `execute` interface backed by the
local filesystem in Node.js and the Origin Private File System in browsers.
The package owns disk I/O; callers own their data model and map operations to
relative file paths.

See the [architecture](specifications/architecture.md) and [API contract](specifications/api.md).

## Initialize

```js
import Disk from '@cocreate/disk';

const disk = await Disk.init({ directory: '/var/lib/cocreate/db' });
server.disk = disk;
```

In a browser, omit `directory` or provide a relative path within OPFS:

```js
const disk = await Disk.init({ directory: 'CoCreateDB' });
```

The package's conditional exports select the server or browser implementation.
Explicit `@cocreate/disk/server` and `@cocreate/disk/client` imports are also
available.

## Execute operations

```js
await disk.execute({
    operation: 'write',
    kind: 'file',
    path: 'branches/root.json',
    data: JSON.stringify({ uuid: 'root' })
});

const contents = await disk.execute({
    operation: 'read',
    kind: 'file',
    path: 'branches/root.json'
});
```

Supported file operations are `read`, `write`, `delete`, `cancel`, and `has`;
`list` and `clear` use `kind: 'directory'`. Paths are relative to the configured
disk directory. The server implementation rejects paths that escape that
directory. Errors reject `execute()` and are left to the caller's existing
error and retry flow.

Database-specific concepts such as branches, leaves, and configuration remain
in CoCreate DB. DB adapts those concepts to file paths and calls `disk.execute`.

## Queue ownership

Each initialized Disk exposes `execute(request)` and an adapter-owned `queue`.
Writes and deletes enter this queue automatically and run with at most 16
concurrent file operations by default (`init({ concurrency })` can override it).
Pending versions for the same path coalesce, and writes to that path serialize.
Reads observe stored files without draining pending writes.

DB requests can include `kind: 'leaf' | 'branch' | 'config' | 'roots'`, a `primary`
group UUID, a resource `uuid`, and `organization_id`, along with the relative
`path` and serialized `data`. Generic callers can use `kind: 'file'`.

```js
const request = {
    operation: 'write', kind: 'leaf', primary: primaryUuid, uuid,
    path: `${organizationId}/leaves/${uuid}.json`, data: serializedFile
};
const completion = disk.execute(request);
console.log(disk.queue[primaryUuid]?.leaves[uuid]);
await disk.execute({ ...request, operation: 'cancel' });
await completion;
```

`cancel` removes pending work; `delete` removes a stored file. A writer that has
already taken a request finishes normally. Queue entries cover both pending and
in-flight work and disappear only after completion. They are for inspection;
use `execute` to change queued work. Disk does not call Persistence or know about
servers/workers. DB supplies the same serialized changes to its independent
Persistence adapter.
