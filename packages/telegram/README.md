# `@watchtower/telegram`

`@watchtower/telegram` turns a Watchtower snapshot and its comparison events into a readable Telegram daily report, then delivers it using the Telegram Bot API.

It does not scan repositories or persist history. It receives already-normalized, validated `Snapshot` and `Changes` data from the rest of Watchtower.

## Report flow

```text
Snapshot + Changes
            ↓
formatTelegramReport
            ↓
escaped Telegram HTML message
            ↓
sendTelegramMessage
            ↓
Telegram Bot API → configured chat
```

For each project, the formatter reports:

- changes since the previous scan
- current security issues and fixed versions, when available
- major updates
- routine updates: minor or patch updates without a known security issue
- deprecated packages

Each section shows up to five items and points the reader to the dashboard when more are available. Workspace names are shown only for monorepos, keeping single-package reports concise. Messages use Telegram-safe HTML escaping and are capped below Telegram's message-length limit.

## Public API

```ts
import { formatTelegramReport, sendTelegramMessage } from "@watchtower/telegram";

const text = formatTelegramReport({ snapshot, changes, dashboardUrl });

await sendTelegramMessage({
  token: process.env.TELEGRAM_BOT_TOKEN!,
  chatId: process.env.TELEGRAM_CHAT_ID!,
  text,
});
```

`sendTelegramMessage` requires both credentials and sends messages with `HTML` parse mode and web-page previews disabled.

## Consumers

`apps/cli` loads `data/current.json` and `data/changes.json`, invokes this package, and is used by the scheduled GitHub Action. It can also run with `--dry-run` to render the report locally without delivering it.

## Design constraints

This package is a delivery adapter. The rules for detected updates, vulnerabilities, deprecations, and change events belong to `@4bhiy/watchtower-core`; this package only presents that information clearly for Telegram.
