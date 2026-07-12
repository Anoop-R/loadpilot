/**
 * NeDB adapter — provides a MongoDB-compatible Collection interface using
 * @seald-io/nedb (embedded, file-based, pure JavaScript — no native modules,
 * no network, no admin rights needed).
 *
 * Data is stored in backend/data/runs.db and backend/data/savedConfigs.db
 * as newline-delimited JSON files. Works on any machine instantly.
 */

import Nedb from "@seald-io/nedb";
import path from "path";
import fs from "fs";

// pkg: __dirname inside exe points to snapshot; use execPath for real filesystem
const _base = (process as any).pkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, "..", "..");
const DATA_DIR = process.env.LOADPILOT_DATA_DIR || path.join(_base, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

function makeDb(filename: string) {
  if (process.env.IS_CLOUD === "true") {
    throw new Error("NeDB fallback is disabled in cloud mode; configure a cloud-backed store before deployment.");
  }

  return new Nedb({
    filename: path.join(DATA_DIR, filename),
    autoload: true,
    timestampData: false,
  });
}

// Singleton databases
let _runsDb: Nedb | null = null;
let _configsDb: Nedb | null = null;

export function getRunsDb(): Nedb {
  if (!_runsDb) _runsDb = makeDb("runs.db");
  return _runsDb;
}

export function getConfigsDb(): Nedb {
  if (!_configsDb) _configsDb = makeDb("savedConfigs.db");
  return _configsDb;
}

/** MongoDB-compatible find-one */
export function dbFindOne<T>(db: Nedb, query: object): Promise<T | null> {
  return new Promise((res, rej) =>
    db.findOne(query, (err: Error | null, doc: any) => err ? rej(err) : res(doc || null))
  );
}

/** MongoDB-compatible find-all */
export function dbFind<T>(db: Nedb, query: object = {}, sort: object = {}, limit = 0): Promise<T[]> {
  return new Promise((res, rej) => {
    let cursor = db.find(query);
    if (Object.keys(sort).length) cursor = cursor.sort(sort);
    if (limit) cursor = cursor.limit(limit);
    cursor.exec((err: Error | null, docs: any[]) => err ? rej(err) : res(docs));
  });
}

/** MongoDB-compatible upsert */
export function dbUpsert<T extends object>(db: Nedb, query: object, doc: T): Promise<void> {
  return new Promise((res, rej) =>
    db.update(query, { $set: doc }, { upsert: true }, (err: Error | null) => err ? rej(err) : res())
  );
}

/** MongoDB-compatible insert */
export function dbInsert<T>(db: Nedb, doc: T): Promise<T> {
  return new Promise((res, rej) =>
    db.insert(doc as any, (err: Error | null, newDoc: T) => err ? rej(err) : res(newDoc))
  );
}

/** MongoDB-compatible update */
export function dbUpdate(db: Nedb, query: object, update: object): Promise<number> {
  return new Promise((res, rej) =>
    db.update(query, update, {}, (err: Error | null, n: number) => err ? rej(err) : res(n))
  );
}

/** MongoDB-compatible delete */
export function dbDelete(db: Nedb, query: object): Promise<number> {
  return new Promise((res, rej) =>
    db.remove(query, {}, (err: Error | null, n: number) => err ? rej(err) : res(n))
  );
}
