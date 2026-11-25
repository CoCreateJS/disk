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

Supported operations are `read`, `write`, `delete`, and `has` for `kind: 'file'`;
`list` and `clear` use `kind: 'directory'`. Paths are relative to the configured
disk directory. The server implementation rejects paths that escape that
directory. Errors reject `execute()` and are left to the caller's existing
error and retry flow.

Database-specific concepts such as branches, leaves, and configuration remain
in CoCreate DB. DB adapts those concepts to file paths and calls `disk.execute`.
