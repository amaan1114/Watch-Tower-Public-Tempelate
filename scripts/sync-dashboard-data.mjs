import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("data");
const destination = path.resolve("apps/dashboard/public/data");

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
console.log("Synced scanner data for the dashboard.");
