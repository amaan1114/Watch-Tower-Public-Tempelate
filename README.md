# Watchtower

Watchtower is a self-hosted, read-only dependency monitor for Node.js projects. Fork this repository, tell it which repositories to scan, and GitHub Actions will keep a dependency history, publish a dashboard, and optionally send a daily Telegram report.

Watchtower reports facts; it never edits your monitored repositories, upgrades packages, or opens pull requests.

## What it checks

- Installed and declared dependency versions for pnpm and npm projects
- Stable npm releases, including major and routine updates
- OSV known vulnerabilities and available fixed versions
- npm deprecations
- Version mismatches across monorepo workspaces
- Daily changes: package additions, removals, upgrades, downgrades, security changes, and release availability

V1 supports Node.js repositories with a root `package.json` and either `pnpm-lock.yaml` or `package-lock.json`.

## Set up your own Watchtower

### 1. Fork this repository

Click **Fork** on GitHub, choose your account, and clone your fork locally. Your fork is your private monitoring control centre: it holds the project configuration, generated scan history, GitHub Pages dashboard, and optional Telegram secrets.

You do not need to add Watchtower files or a workflow to every repository being monitored.

### 2. Add projects to monitor

Open [`config/projects.yml`](config/projects.yml) in your fork. It starts empty. Add one entry for each repository, using its GitHub HTTPS clone URL.

```yaml
projects:
  - id: my-app
    name: My App
    source:
      type: github
      repository: https://github.com/your-account/my-app.git
      ref: main # optional; omit to use the repository default branch
```

Add more projects under `projects`. Each `id` must be unique. Use plain URLs—do not paste Markdown links or local computer paths.

### 3. Configure GitHub permissions and Pages

In your Watchtower fork:

1. Go to **Settings → Actions → General**.
2. Under **Workflow permissions**, choose **Read and write permissions** and save. Watchtower needs this only to commit its generated history and dashboard data back to your fork.
3. Go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.

### 4. Run the first scan

Commit and push your `config/projects.yml`, then open **Actions → Watchtower scan → Run workflow**. Select `main` and run it.

The first scan creates a baseline. Later scans compare their results with that baseline. The dashboard is deployed to:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-WATCHTOWER-REPOSITORY/
```

## Monitor private repositories

Public repositories require no extra setup. For private repositories, create a GitHub token that has read access to every private repository Watchtower should scan.

1. On GitHub, create a fine-grained personal access token with **Contents: Read-only** access for each monitored repository.
2. In your Watchtower fork, open **Settings → Secrets and variables → Actions**.
3. Create a repository secret named `WATCHTOWER_GITHUB_TOKEN` and paste the token.

Keep the token in GitHub Secrets only. Never put it in `projects.yml`, source code, or a commit.

## Set up Telegram reports (optional)

### Create a bot

1. In Telegram, open **@BotFather**.
2. Send `/newbot`, follow the prompts, and copy the bot token it gives you.
3. Open a chat with the new bot and send it any message, such as `Hello`.

### Find your chat ID

Open this URL in a browser, replacing `YOUR_BOT_TOKEN` locally:

```text
https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
```

In the response, find `chat` and copy its numeric `id`. Do not share the bot token or put it in the repository.

### Add the secrets

In **Settings → Secrets and variables → Actions** in your Watchtower fork, add:

| Secret | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | The token from BotFather |
| `TELEGRAM_CHAT_ID` | The numeric chat ID |

The next scan sends a report automatically when both secrets are present. Reports include changes since the previous scan, current security issues, major updates, routine updates (minor or patch updates without a known security issue), deprecated packages, and a dashboard link.

## Change the daily scan time

The schedule lives in [`.github/workflows/watchtower.yml`](.github/workflows/watchtower.yml). GitHub Actions uses UTC. The included schedule is:

```yaml
- cron: "30 2 * * *"
```

That means **2:30 AM UTC**, which is **8:00 AM IST**. Change the five cron fields to choose a different UTC time, then commit and push the workflow file.

For example, to run every day at 9:00 AM IST (3:30 AM UTC):

```yaml
- cron: "30 3 * * *"
```

You can always run a scan immediately from **Actions → Watchtower scan → Run workflow**; there is no need to wait for the daily schedule.

## Where the data lives

Each successful workflow run writes generated data only to your Watchtower fork:

```text
data/current.json                         latest complete scan
data/changes.json                         comparison with the preceding scan
data/history-index.json                   available history dates
data/history/YYYY/MM/YYYY-MM-DD.json      daily snapshots
```

The dashboard reads the same data. A GitHub-hosted Ubuntu runner performs each scan in a temporary folder, then shuts down; your monitored repositories are not changed.

## Run locally

Requirements: Node.js 22+ and pnpm.

```bash
pnpm install
pnpm scan -- --config config/projects.yml
```

To preview the Telegram message without sending it:

```bash
pnpm telegram -- --dry-run
```

Local sources can be useful during development, but they will not work in GitHub Actions because the runner cannot access your computer:

```yaml
projects:
  - id: local-app
    name: Local App
    source:
      type: local
      path: /absolute/path/to/local-app
```

## Project layout

```text
apps/cli/          commands run locally and by GitHub Actions
apps/dashboard/    static GitHub Pages dashboard
packages/core/     scanner, GitHub acquisition, registry, OSV, schemas
packages/history/  snapshot storage and comparisons
packages/telegram/ report formatting and Telegram delivery
config/            repositories to monitor
data/              generated scan data and history
```

## Troubleshooting

| Problem | Check |
| --- | --- |
| `Repository not found` | Use the full GitHub HTTPS URL, verify `ref`, and add `WATCHTOWER_GITHUB_TOKEN` for a private repository. |
| `No root package.json found` | V1 scans Node.js repositories only. |
| `Cannot determine package manager` | Keep exactly one supported lockfile: pnpm or npm. |
| GitHub Pages says `Not Found` | Set Pages Source to **GitHub Actions**, then run the workflow again. |
| Telegram is skipped | Confirm both Telegram secrets are present and that you have sent the bot a message. |

## License

[MIT](LICENSE)
