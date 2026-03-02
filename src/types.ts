export type TxType = "income" | "expense";

export type Split = {
  id: string;
  memo: string;
  amountYen: number;
  tagNames: string[]; // 内訳タグ（複数）
};

export type Transaction = {
  id: string;
  type: TxType;
  title: string;
  amountYen: number;     // 合計（円）
  dateISO: string;       // 実行日 (YYYY-MM-DD)
  periodStartISO: string;// 計上期間の開始日 (YYYY-MM-DD)
  tagNames: string[];    // 取引タグ（複数）
  splits: Split[];
  createdAt: number;
  updatedAt: number;
};

export type TagTemplate = {
  id: string;
  name: string;
  createdAt: number;
};

export type CategoryTemplate = {
  id: string;
  name: string;
  type: TxType;
  createdAt: number;
};

export type AppSettings = {
  monthStartDay: number; // 1..28
};

export type DbExport = {
  version: 1;
  exportedAt: number;
  settings: AppSettings;
  tagTemplates: TagTemplate[];
  categoryTemplates: CategoryTemplate[];
  transactions: Transaction[];
};