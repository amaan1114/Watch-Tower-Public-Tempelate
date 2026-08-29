import { readFile } from "node:fs/promises";
import path from "node:path";
import { ChangesSchema, SnapshotSchema } from "@4bhiy/watchtower-core";
import { formatTelegramReport, sendTelegramMessage } from "@watchtower/telegram";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const workspaceRoot = path.resolve(process.env.WATCHTOWER_WORKSPACE_ROOT ?? process.cwd());
  const [snapshot, changes] = await Promise.all([
    readJson(path.join(workspaceRoot, "data/current.json"), SnapshotSchema),
    readJson(path.join(workspaceRoot, "data/changes.json"), ChangesSchema),
  ]);
  const report = formatTelegramReport({ snapshot, changes, dashboardUrl: process.env.WATCHTOWER_DASHBOARD_URL });
  if (dryRun) {
    console.log(report);
    return;
  }
  await sendTelegramMessage({ token: process.env.TELEGRAM_BOT_TOKEN ?? "", chatId: process.env.TELEGRAM_CHAT_ID ?? "", text: report });
  console.log("Sent Telegram daily report.");
}

async function readJson<T extends { parse: (value: unknown) => unknown }>(filePath: string, schema: T): Promise<ReturnType<T["parse"]>> {
  return schema.parse(JSON.parse(await readFile(filePath, "utf8"))) as ReturnType<T["parse"]>;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
