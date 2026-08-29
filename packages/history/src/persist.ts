import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ChangesSchema, HistoryIndexSchema, SnapshotSchema, compareSnapshots, type Changes, type HistoryIndex, type Snapshot } from "@4bhiy/watchtower-core";

export async function persistScan(input: { currentPath: string; snapshot: Snapshot }): Promise<Changes> {
  const currentPath = path.resolve(input.currentPath);
  const dataDir = path.dirname(currentPath);
  const previous = await readSnapshotIfPresent(currentPath);
  const changes = ChangesSchema.parse(compareSnapshots(previous, input.snapshot));
  const date = scanDate(input.snapshot.scannedAt);
  const historyPath = path.join(dataDir, "history", date.slice(0, 4), date.slice(5, 7), `${date}.json`);
  const indexPath = path.join(dataDir, "history-index.json");
  const index = await readHistoryIndex(indexPath);
  const nextIndex = updateHistoryIndex(index, input.snapshot, date);

  await Promise.all([
    writeJson(currentPath, input.snapshot),
    writeJson(historyPath, input.snapshot),
    writeJson(path.join(dataDir, "changes.json"), changes),
    writeJson(indexPath, nextIndex),
  ]);
  return changes;
}

async function readSnapshotIfPresent(snapshotPath: string): Promise<Snapshot | null> {
  try {
    return SnapshotSchema.parse(JSON.parse(await readFile(snapshotPath, "utf8")));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw new Error(`Could not read previous snapshot ${snapshotPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readHistoryIndex(indexPath: string): Promise<HistoryIndex> {
  try {
    return HistoryIndexSchema.parse(JSON.parse(await readFile(indexPath, "utf8")));
  } catch (error) {
    if (isNotFound(error)) return { schemaVersion: 1, projects: {} };
    throw new Error(`Could not read history index ${indexPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function updateHistoryIndex(index: HistoryIndex, snapshot: Snapshot, date: string): HistoryIndex {
  const projects = { ...index.projects };
  for (const project of snapshot.projects) {
    const existing = projects[project.id] ?? [];
    projects[project.id] = [
      ...existing.filter((entry) => entry.date !== date),
      { date, scannedAt: snapshot.scannedAt, summary: project.summary },
    ].sort((left, right) => left.date.localeCompare(right.date));
  }
  return HistoryIndexSchema.parse({ schemaVersion: 1, projects });
}

function scanDate(scannedAt: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(scannedAt));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, filePath);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
