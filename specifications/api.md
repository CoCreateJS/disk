# API

Both package entry points expose the same API:

```js
import Disk from '@cocreate/disk';

const disk = await Disk.init({ directory });
await disk.execute({ operation, kind, path, data });
```

`init(options)` returns an instance with `execute(request)`. Each instance owns
its configured directory and runtime handles; there is no shared module-level
storage state.

## Initialization options

| Option | Server default | Browser default | Description |
| --- | --- | --- | --- |
| `directory` | `~/.cocreate/db` | `CoCreateDB` | Root directory for this disk instance. Browser paths are relative to OPFS. |

## Execute request

| Field | Required | Description |
| --- | --- | --- |
| `operation` | Yes | `read`, `write`, `delete`, `has`, `list`, or `clear`. |
| `kind` | Yes | Use `file` for file operations, or `directory` for `list` and `clear`. |
| `path` | For file operations; optional for `list` | Relative file or directory path under the configured root. |
| `data` | For `write` | String or supported file data to write. |

`read` returns file contents as text. `has` returns a boolean. `list` returns
entry names. `write`, `delete`, and `clear` return `true`. Missing files return
`false` from `has`, empty directories return an empty list, and deleting a
missing file succeeds. Other failures reject the returned promise.

## Runtime entry points

- Node/default: `@cocreate/disk` or `@cocreate/disk/server`
- Browser: `@cocreate/disk` or `@cocreate/disk/client`
