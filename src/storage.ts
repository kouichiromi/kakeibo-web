import { db, ensureDefaults, getSettings } from "./db";
import type { DbExport } from "./types";

export async function exportToJson(): Promise<string> {
  await ensureDefaults();

  const settings = await getSettings();
  const tagTemplates = await db.tagTemplates.toArray();
  const categoryTemplates = await db.categoryTemplates.toArray();
  const transactions = await db.transactions.toArray();

  const payload: DbExport = {
    version: 1,
    exportedAt: Date.now(),
    settings,
    tagTemplates,
    categoryTemplates,
    transactions,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * 既存データは「上書き」する（= 完全復元）
 * 安全のため import 前に confirm を出すのがUI側の役割
 */
export async function importFromJson(json: string) {
  const parsed = JSON.parse(json) as DbExport;

  if (!parsed || parsed.version !== 1) {
    throw new Error("不正なバックアップ形式です（versionが一致しません）");
  }

  await db.transaction(
    "rw",
    db.settings,
    db.tagTemplates,
    db.categoryTemplates,
    db.transactions,
    async () => {
      await db.settings.clear();
      await db.tagTemplates.clear();
      await db.categoryTemplates.clear();
      await db.transactions.clear();

      await db.settings.put({ id: "app", value: parsed.settings });
      await db.tagTemplates.bulkPut(parsed.tagTemplates);
      await db.categoryTemplates.bulkPut(parsed.categoryTemplates);
      await db.transactions.bulkPut(parsed.transactions);
    }
  );
}

export function downloadJson(filename: string, json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}