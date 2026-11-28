# API

Both package entry points expose the same API:

```js
import Disk from '@cocreate/disk';

const disk = await Disk.init({ directory });
await disk.execute({ operation, kind, path, data });
```

`init(options)` returns an instance with `execute(request)` and `queue`. Each instance owns
its configured directory and runtime handles; there is no shared module-level
storage state.

## Initialization options

| Option | Server default | Browser default | Description |
| --- | --- | --- | --- |
| `concurrency` | `16` | `16` | Maximum in-flight writes/deletes per Disk instance. |
| `directory` | `~/.cocreate/db` | `CoCreateDB` | Root directory for this disk instance. Browser paths are relative to OPFS. |

## Execute request

| Field | Required | Description |
| --- | --- | --- |
| `operation` | Yes | `read`, `write`, `delete`, `cancel`, `has`, `list`, or `clear`. |
| `kind` | Yes | Use `file`, `leaf`, `branch`, `config`, or `roots` for file operations; `directory` for `list` and `clear`. |
| `path` | For file operations; optional for `list` | Relative file or directory path under the configured root. |
| `data` | For `write` | String or supported file data to write. |
| `primary` | Optional | Queue group; defaults to the path for generic file callers. DB supplies the primary branch UUID. |
| `uuid` | Optional | Resource key within the queue group; defaults to the path. |
| `organization_id` | Optional | Caller context; filesystem placement is determined by `path`. |

`read` returns file contents as text. `has` returns a boolean. `list` returns
entry names. `write`, `delete`, and `clear` return `true`. Missing files return
`false` from `has`, empty directories return an empty list, and deleting a
missing file succeeds. Other failures reject the returned promise.

## Runtime entry points

- Node/default: `@cocreate/disk` or `@cocreate/disk/server`
- Browser: `@cocreate/disk` or `@cocreate/disk/client`

## Queue lifecycle

`queue` is a plain object keyed by `primary`. Each group contains `leaves`,
`branches` and `files` objects keyed by `uuid`; config/roots/generic file requests
use `files`. A non-enumerable `size` counts the group's unique resource entries.
Each entry shows the latest request for that resource, covering pending and
in-flight work. Consumers must keep one consistent primary/kind/UUID identity
for a given path. Requests and queued data must not be mutated by consumers.

Normal writes/deletes resolve when I/O finishes. Replacing a pending request
settles it with `{ superseded: true }`; cancellation settles pending work with
`{ cancelled: true }`. `cancel` itself returns `{ cancelled, inFlight }`, and
never removes a stored file or aborts a write already taken by the writer.
Pending entries coalesce; in-flight requests retain the data they already took.
A group disappears only after all its requests complete. Failures reject and
leave work visible without automatic retries. The host owns recovery policy.

`clear` waits for earlier queued work, clears storage, then allows later requests.
Other reads/has/list calls observe the currently stored state rather than waiting
for all queued writes. Different files have no transactional ordering guarantee.
