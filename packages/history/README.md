# `@watchtower/history`

`@watchtower/history` owns durable scan output. Given a new normalized snapshot, it compares it with the last snapshot and writes Watchtower's current state, change events, and daily history files.

It does not inspect repositories, call npm or OSV, send messages, or know how the dashboard renders data.

## Flow

```text
current Snapshot from @4bhiy/watchtower-core
            ↓
read previous current.json when present
            ↓
compare previous and current snapshots
            ↓
write current state, changes, daily history, and history index atomically
```

`persistScan` uses the scan time in the `Asia/Kolkata` timezone to select the daily history file. A later scan on the same IST date replaces that date's snapshot, while earlier daily snapshots remain untouched.

## Files it writes

When the caller supplies `data/current.json`, the package produces:

```text
data/current.json                         latest complete snapshot
data/changes.json                         changes from the preceding scan
data/history-index.json                   available dates and summaries by project
data/history/YYYY/MM/YYYY-MM-DD.json      snapshot for that IST day
```

Writes are performed through a temporary file and rename so readers do not see partially written JSON.

## Public API

```ts
import { persistScan } from "@watchtower/history";
import type { Snapshot } from "@4bhiy/watchtower-core";

const changes = await persistScan({
  currentPath: "data/current.json",
  snapshot,
});
```

The return value is the validated `Changes` object. On the first scan, it contains a baseline marker; later scans contain factual dependency, release, security, and mismatch events.

## Consumers

`apps/cli` calls `persistScan` immediately after scanning. The dashboard and Telegram package then consume the generated JSON through their own interfaces.

## Design constraints

This package remains a storage boundary. Keep scanning and enrichment in `@4bhiy/watchtower-core`, and keep delivery-specific filtering or presentation outside history.
