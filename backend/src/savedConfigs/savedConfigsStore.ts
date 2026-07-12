import { randomUUID } from "crypto";
import { BuildConfig } from "../builders/jmxBuilder";
import { getConfigsDb, dbFind, dbFindOne, dbInsert, dbUpdate, dbDelete } from "../db/nedb";

export interface SavedConfig {
  id: string;
  name: string;
  config: BuildConfig;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export async function listSavedConfigs(): Promise<SavedConfig[]> {
  const docs = await dbFind<SavedConfig>(getConfigsDb(), {}, { name: 1 });
  return docs.map(({ _id, ...rest }: any) => rest);
}

export async function getSavedConfig(id: string): Promise<SavedConfig | undefined> {
  const doc = await dbFindOne<SavedConfig>(getConfigsDb(), { id });
  if (!doc) return undefined;
  const { _id, ...rest } = doc as any;
  return rest;
}

export async function createSavedConfig(name: string, config: BuildConfig, createdBy?: string): Promise<SavedConfig> {
  const now = new Date().toISOString();
  const record: SavedConfig = { id: randomUUID(), name, config, createdAt: now, updatedAt: now, createdBy };
  await dbInsert(getConfigsDb(), record);
  return record;
}

export async function updateSavedConfig(id: string, name: string, config: BuildConfig): Promise<SavedConfig | null> {
  const updatedAt = new Date().toISOString();
  await dbUpdate(getConfigsDb(), { id }, { $set: { name, config, updatedAt } });
  return (await getSavedConfig(id)) ?? null;
}

export async function deleteSavedConfig(id: string): Promise<boolean> {
  const n = await dbDelete(getConfigsDb(), { id });
  return n > 0;
}
