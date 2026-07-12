import crypto from "crypto";
import { getConfigsDb, dbFindOne, dbInsert } from "../db/nedb";

interface UserRecord {
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

const PBKDF2_ITERATIONS = 100_000;

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, "sha512").toString("hex");
}

function getUsersDb() {
  // Reuse the nedb infrastructure — users stored in a separate logical
  // collection by using a separate NeDB instance via a type prefix trick.
  // Actually simpler: use the same getConfigsDb but store users with a
  // type field so they don't collide with configs.
  return getConfigsDb();
}

export interface LoginResult {
  ok: boolean;
  error?: string;
  isNewAccount?: boolean;
}

export async function loginOrRegister(username: string, password: string): Promise<LoginResult> {
  const db = getUsersDb();
  const existing = await dbFindOne<UserRecord & { _type: string }>(db, { _type: "user", username });

  if (existing) {
    const hash = hashPassword(password, existing.salt);
    if (hash !== existing.passwordHash) {
      return { ok: false, error: "Incorrect password." };
    }
    return { ok: true, isNewAccount: false };
  }

  if (password.length < 4) {
    return { ok: false, error: "Choose a password at least 4 characters long." };
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  await dbInsert(db, { _type: "user", username, passwordHash, salt, createdAt: new Date().toISOString() });
  return { ok: true, isNewAccount: true };
}
