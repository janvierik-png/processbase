import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "..", "data");
mkdirSync(dataDir, { recursive: true });

export function openDatabase() {
  const db = new Database(join(dataDir, "process-platform.sqlite"));
  db.pragma("foreign_keys = ON");
  return db;
}
