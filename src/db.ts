// db.ts
// IndexedDB（Dexie）は廃止し、Supabaseに完全移行

import { supabase } from "./lib/supabase";
import type { AppSettings, TagTemplate, Transaction } from "./types";

// =============================================
// Settings
// =============================================

export async function getSettings(): Promise<AppSettings> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { monthStartDay: 1 };

  const { data } = await supabase
    .from("settings")
    .select("month_start_day")
    .eq("user_id", user.id)
    .single();

  return { monthStartDay: data?.month_start_day ?? 1 };
}

export async function setMonthStartDay(day: number) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("settings")
    .upsert({ user_id: user.id, month_start_day: day });
}

export async function ensureDefaults() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data } = await supabase
    .from("settings")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  if (!data) {
    await supabase
      .from("settings")
      .insert({ user_id: user.id, month_start_day: 1 });
  }
}

// =============================================
// Tag Templates
// =============================================

export async function getTagTemplates(): Promise<TagTemplate[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("tag_templates")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  }));
}

export async function addTagTemplate(tag: TagTemplate) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("tag_templates").insert({
    id: tag.id,
    user_id: user.id,
    name: tag.name,
    created_at: tag.createdAt,
  });
}

export async function deleteTagTemplate(id: string) {
  await supabase.from("tag_templates").delete().eq("id", id);
}

// =============================================
// Transactions
// =============================================

export async function loadTransactions(): Promise<Transaction[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("loadTransactions error:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    amountYen: row.amount_yen,
    dateISO: row.date_iso,
    periodStartISO: row.period_start_iso,
    tagNames: row.tag_names ?? [],
    splits: row.splits ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function saveTransaction(tx: Transaction) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const row = {
    id: tx.id,
    user_id: user.id,
    type: tx.type,
    title: tx.title,
    amount_yen: tx.amountYen,
    date_iso: tx.dateISO,
    period_start_iso: tx.periodStartISO,
    tag_names: tx.tagNames,
    splits: tx.splits,
    created_at: tx.createdAt,
    updated_at: tx.updatedAt,
  };

  const { error } = await supabase
    .from("transactions")
    .upsert(row, { onConflict: "id" });

  if (error) console.error("saveTransaction error:", error);
}

export async function bulkSaveTransactions(txs: Transaction[]) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const rows = txs.map((tx) => ({
    id: tx.id,
    user_id: user.id,
    type: tx.type,
    title: tx.title,
    amount_yen: tx.amountYen,
    date_iso: tx.dateISO,
    period_start_iso: tx.periodStartISO,
    tag_names: tx.tagNames,
    splits: tx.splits,
    created_at: tx.createdAt,
    updated_at: tx.updatedAt,
  }));

  const { error } = await supabase
    .from("transactions")
    .upsert(rows, { onConflict: "id" });

  if (error) console.error("bulkSaveTransactions error:", error);
}

export async function deleteTransaction(id: string) {
  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", id);

  if (error) console.error("deleteTransaction error:", error);
}
