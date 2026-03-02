import Dexie from "dexie";
import type { Table } from "dexie";
import type { AppSettings, CategoryTemplate, TagTemplate, Transaction } from "./types";

type SettingsRow = {
  id: "app";
  value: AppSettings;
};

export class KakeiboDB extends Dexie {
  settings!: Table<SettingsRow, "app">;
  tagTemplates!: Table<TagTemplate, string>;
  categoryTemplates!: Table<CategoryTemplate, string>;
  transactions!: Table<Transaction, string>;

  constructor() {
    super("kakeibo-web");

    this.version(1).stores({
      settings: "id",
      tagTemplates: "id, createdAt, name",
      categoryTemplates: "id, createdAt, type, name",
      transactions: "id, periodStartISO, dateISO, type, createdAt, updatedAt",
    });
  }
}

export const db = new KakeiboDB();

// ---------- helpers ----------
export async function ensureDefaults() {
  const s = await db.settings.get("app");
  if (!s) {
    await db.settings.put({
      id: "app",
      value: { monthStartDay: 1 },
    });
  }
}

export async function getSettings(): Promise<AppSettings> {
  await ensureDefaults();
  return (await db.settings.get("app"))!.value;
}

export async function setMonthStartDay(day: number) {
  await ensureDefaults();
  const row = await db.settings.get("app");
  await db.settings.put({ id: "app", value: { monthStartDay: day } });
  return row?.value;
}