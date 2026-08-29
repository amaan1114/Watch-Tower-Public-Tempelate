# `@4bhiy/watchtower-core`

`@4bhiy/watchtower-core` is Watchtower's reusable, read-only dependency scanning engine. It contains the normalized data model and the code that turns a local checkout or configured GitHub repository into a scan snapshot.

It does not write history, send notifications, render a dashboard, upgrade dependencies, or open pull requests. Those jobs belong to the packages and apps that consume this one.

## What it owns

- Loading and validating `projects.yml`
- Acquiring a GitHub repository into a temporary checkout
- Detecting npm or pnpm and discovering workspaces from repository configuration
- Reading manifests and lockfiles
- Separating internal workspace dependencies from external npm dependencies
- Preserving declared and resolved versions for every workspace usage
- Enriching dependencies with npm registry metadata, deprecation information, and stable update availability
- Enriching resolved versions with OSV vulnerability advisories
- Comparing two normalized snapshots to produce factual change events
- Zod schemas and TypeScript types shared by every Watchtower interface

## Scanner flow

```text
configured project or local root
            ↓
acquire (GitHub only) and detect Node package manager
            ↓
discover workspaces from pnpm-workspace.yaml or package.json workspaces
            ↓
read manifests and classify dependency usages
            ↓
resolve external usages from pnpm-lock.yaml or package-lock.json
            ↓
enrich with npm registry metadata and OSV advisories
            ↓
validate and return a Snapshot
```

The snapshot aggregates a package once per project while retaining each individual workspace usage. This lets a consumer show a compact project-level view but expand to the workspaces responsible for a version, vulnerability, or mismatch.

## Public API

Import from the package root only:

```ts
import {
  scanNodeProject,
  scanConfiguredProjects,
  compareSnapshots,
  SnapshotSchema,
  type Snapshot,
} from "@4bhiy/watchtower-core";
```

The primary entry points are:

- `scanNodeProject` — scan one already-available local repository.
- `scanConfiguredProjects` — load a Watchtower project configuration, acquire GitHub sources when needed, and scan every project.
- `compareSnapshots` — compare a previous snapshot with a current snapshot.
- `SnapshotSchema`, `ChangesSchema`, and `HistoryIndexSchema` — validate data at package boundaries.

## Consumers

- `apps/cli` calls this package to run local and GitHub Actions scans.
- `@watchtower/history` persists the returned `Snapshot` and uses `compareSnapshots`.
- `@watchtower/telegram` formats `Snapshot` and `Changes` into a report.
- `apps/dashboard` reads the JSON persisted from this model.
- A future VS Code extension can import this package directly, without duplicating scanner logic.

## Design constraints

Keep this package interface-first and side-effect-light. New ecosystem support should arrive as an adapter that produces the existing normalized model. Features tied to one delivery channel—such as Telegram layout or dashboard state—do not belong here.
