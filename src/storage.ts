// storage.ts
import { loadTransactions, getTagTemplates, getSettings, bulkSaveTransactions, addTagTemplate, setMonthStartDay } from "./db";
import type { DbExport, TagTemplate } from "./types";

export async function exportToJson(): Promise<string> {
  const settings = await getSettings();
  const tagTemplates = await getTagTemplates();
  const transactions = await loadTransactions();

  const payload: DbExport = {
    version: 1,
    exportedAt: Date.now(),
    settings,
    tagTemplates,
    categoryTemplates: [], // 互換性のため残す
    transactions,
  };

  return JSON.stringify(payload, null, 2);
}

export async function importFromJson(json: string) {
  const parsed = JSON.parse(json) as DbExport;

  if (!parsed || parsed.version !== 1) {
    throw new Error("不正なバックアップ形式です（versionが一致しません）");
  }

  // 設定を復元
  await setMonthStartDay(parsed.settings.monthStartDay);

  // タグを復元（既存タグは削除せず追加）
  for (const tag of parsed.tagTemplates) {
    const t: TagTemplate = {
      id: tag.id,
      name: tag.name,
      createdAt: tag.createdAt,
    };
    await addTagTemplate(t).catch(() => {}); // 重複は無視
  }

  // 取引を復元（upsertなので既存は上書き）
  await bulkSaveTransactions(parsed.transactions);
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
