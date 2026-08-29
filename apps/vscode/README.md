# Watchtower for VS Code

Watchtower is a native VS Code extension for scanning and explicitly updating dependencies in the repository currently open in VS Code.

It is a local developer tool. It does not read Watchtower dashboard configuration, clone repositories, scan a fleet of projects, write history, send Telegram messages, or create pull requests.

## Workflow

```text
Open a Node.js repository in VS Code
        ↓
Watchtower: Scan Current Project
        ↓
Native tree shows security issues, updates, deprecations, and workspaces
        ↓
Right-click one dependency → Update Dependency
        ↓
Choose a stable version and confirm
        ↓
Package manager updates the selected workspace
        ↓
Watchtower rescans and refreshes the tree
```

The extension supports repositories detected as pnpm or npm projects. It discovers monorepos from `pnpm-workspace.yaml` or `package.json` workspaces.

## Version selection

Watchtower fetches version metadata for only the dependency you select. The picker includes stable releases only and highlights:

- `●` the installed resolved version
- `🛡` an available fixed version for a reported vulnerability
- `★` the latest stable version

Prereleases such as alpha, beta, canary, and release-candidate versions are excluded.

## Development

From the Watchtower repository root:

```bash
pnpm build:vscode
pnpm check:vscode
```

To run it in VS Code during development, open this repository, launch the `apps/vscode` extension host configuration, then open a Node.js project in the Extension Development Host window.
