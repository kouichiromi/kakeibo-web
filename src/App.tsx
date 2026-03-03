// App.tsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import Login from "./Login";

import { db, ensureDefaults, getSettings, setMonthStartDay } from "./db";
import type { AppSettings, TagTemplate, Transaction, TxType, Split } from "./types";
import { exportToJson, importFromJson, downloadJson } from "./storage";

type TabKey = "monthly" | "yearly" | "settings" | "backup";

const pad2 = (n: number) => String(n).padStart(2, "0");

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

function toJpDate(iso: string) {
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  return `${y}年${m}月${d}日`;
}
function App() {

  const [transactions, setTransactions] = useState([]);

  async function loadTransactions() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("date", { ascending: false });

    return data ?? [];
  }

  useEffect(() => {
    loadTransactions().then((data) => {
      if (data) setTransactions(data);
    });
  }, []);

}

function addMonths(dateISO: string, diff: number) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setMonth(dt.getMonth() + diff);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

// ✅ コピー用：翌月の同日（存在しない日は月末に丸める）
function addOneMonthSameDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);

  const baseMonth = dt.getMonth();
  const target = new Date(dt);
  target.setMonth(baseMonth + 1);

  // setMonth により「翌々月」へ飛んだ場合（例: 1/31 → 3/2）を月末へ補正
  if (target.getMonth() !== ((baseMonth + 1) % 12)) {
    const last = new Date(y, m, 0); // 翌月の0日 = 当月末（JS仕様）
    return `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}`;
  }

  return `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}`;
}

function startOfPeriod(referenceISO: string, monthStartDay: number) {
  const [y, m, d] = referenceISO.split("-").map(Number);
  const ref = new Date(y, m - 1, d);

  const periodStart = new Date(ref.getFullYear(), ref.getMonth(), monthStartDay);
  if (ref.getDate() < monthStartDay) {
    periodStart.setMonth(periodStart.getMonth() - 1);
  }

  const startISO = `${periodStart.getFullYear()}-${pad2(periodStart.getMonth() + 1)}-${pad2(
    periodStart.getDate()
  )}`;

  const end = new Date(periodStart);
  end.setMonth(end.getMonth() + 1);
  end.setDate(end.getDate() - 1);
  const endISO = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;

  return { startISO, endISO };
}

function inRangeISO(dateISO: string, startISO: string, endISO: string) {
  return dateISO >= startISO && dateISO <= endISO;
}

function yen(n: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n);
}

function uid() {
  return crypto.randomUUID();
}

function sumAmount(txs: Transaction[], type?: TxType) {
  const list = type ? txs.filter((t) => t.type === type) : txs;
  return list.reduce((acc, t) => acc + (t.amountYen || 0), 0);
}

function yearFromISO(iso: string) {
  return Number(iso.slice(0, 4));
}
function monthFromISO(iso: string) {
  return Number(iso.slice(5, 7));
}

/**
 * ✅ タグ集計（完全対応）
 * 要件:
 * - 取引に付けたタグも反映
 * - 内訳(splits)に付けたタグも反映
 *
 * ルール:
 * - 取引タグ(tx.tagNames)があるなら「取引合計金額（splits合計 or amountYen）」を取引タグへ加算
 * - splitsがあるなら「各split金額」をsplitタグへ加算（splitタグ無しなら NO_TAG）
 * - タグが無ければ NO_TAG
 *
 * 注意:
 * - 取引タグと内訳タグの両方を使うと、同一取引の金額が両方のタグへ入る（仕様どおり「両方反映」）
 */
function buildTagAmountMap(tx: Transaction, NO_TAG: string): Map<string, number> {
  const map = new Map<string, number>();

  const add = (tag: string, amount: number) => {
    map.set(tag, (map.get(tag) ?? 0) + amount);
  };

  const txTags = tx.tagNames && tx.tagNames.length > 0 ? tx.tagNames : [];
  const splits = tx.splits || [];

  const txTotal =
    splits.length > 0
      ? splits.reduce((a, s) => a + (s.amountYen || 0), 0)
      : Number(tx.amountYen || 0);

  const txTagsToUse = txTags.length > 0 ? txTags : [NO_TAG];
  for (const tag of txTagsToUse) add(tag, txTotal);

  if (splits.length > 0) {
    for (const s of splits) {
      const amt = Number(s.amountYen || 0);
      if (!amt) continue;

      const splitTags = s.tagNames && s.tagNames.length > 0 ? s.tagNames : [NO_TAG];
      for (const tag of splitTags) add(tag, amt);
    }
  }

  return map;
}

/** ✅ 月次：タグ合計（取引タグ + 内訳タグの両方を反映） */
function tagTotalWithSplits(txs: Transaction[], tag: string, NO_TAG: string) {
  let total = 0;
  for (const t of txs) {
    const m = buildTagAmountMap(t, NO_TAG);
    total += m.get(tag) ?? 0;
  }
  return total;
}

/** ✅ フィルタ一致：取引タグ or 内訳タグのどれかに含まれる */
function txMatchesSelectedTags(tx: Transaction, selected: Set<string>) {
  if (selected.size === 0) return true;

  const txTags = tx.tagNames || [];
  if (txTags.some((t) => selected.has(t))) return true;

  const splits = tx.splits || [];
  for (const s of splits) {
    const st = s.tagNames || [];
    if (st.some((t) => selected.has(t))) return true;
  }
  return false;
}

export default function App() {

  const [session, setSession] = useState<any>(null);

  useEffect(() => {
  supabase.auth.getSession().then(({ data }) => {
    setSession(data.session);
  });

  const { data: listener } =
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

  return ()=> {
    listener?.subscription?.unsubscribe();
  };
}, []);
  const [tab, setTab] = useState<TabKey>("monthly");

  const [settings, setSettings] = useState<AppSettings>({ monthStartDay: 1 });
  const [tags, setTags] = useState<TagTemplate[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);

  const [refISO, setRefISO] = useState<string>(todayISO());

  // 月次のタグフィルタ（複数選択）
  const [selectedFilterTags, setSelectedFilterTags] = useState<Set<string>>(new Set());

  // 取引編集モーダル
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  // 年間
  const [year, setYear] = useState<number>(new Date().getFullYear());

  // 年間のタグフィルタ（複数選択）
  const [selectedYearlyTags, setSelectedYearlyTags] = useState<Set<string>>(new Set());

  async function reload() {
    await ensureDefaults();
    const s = await getSettings();
    const t = await db.tagTemplates.orderBy("createdAt").toArray();
    const list = await db.transactions.orderBy("createdAt").toArray();
    setSettings(s ?? { monthStartDay: 1 });
    setTags(t);
    setTxs(list);
  }

  useEffect(() => {
    reload();
  }, []);

  const period = useMemo(() => startOfPeriod(refISO, settings.monthStartDay), [refISO, settings.monthStartDay]);

  const txInPeriod = useMemo(() => {
    return txs.filter(
      (t) => t.periodStartISO === period.startISO || inRangeISO(t.dateISO, period.startISO, period.endISO)
    );
  }, [txs, period.startISO, period.endISO]);

  const txFiltered = useMemo(() => {
    return txInPeriod
      .filter((t) => txMatchesSelectedTags(t, selectedFilterTags))
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  }, [txInPeriod, selectedFilterTags]);

  const incomeTotal = useMemo(() => sumAmount(txInPeriod, "income"), [txInPeriod]);
  const expenseTotal = useMemo(() => sumAmount(txInPeriod, "expense"), [txInPeriod]);

  // 前月残（前期間の収支）
  const prevRef = useMemo(() => addMonths(period.startISO, -1), [period.startISO]);
  const prevPeriod = useMemo(() => startOfPeriod(prevRef, settings.monthStartDay), [prevRef, settings.monthStartDay]);
  const prevTx = useMemo(() => txs.filter((t) => t.periodStartISO === prevPeriod.startISO), [txs, prevPeriod.startISO]);

  const carryPrev = useMemo(() => sumAmount(prevTx, "income") - sumAmount(prevTx, "expense"), [prevTx]);
  const carryThis = useMemo(() => carryPrev + incomeTotal - expenseTotal, [carryPrev, incomeTotal, expenseTotal]);

  // ---- UI actions ----
  function toggleFilterTag(name: string) {
    setSelectedFilterTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function clearFilterTags() {
    setSelectedFilterTags(new Set());
  }

  function toggleYearlyTag(name: string) {
    setSelectedYearlyTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function clearYearlyTags() {
    setSelectedYearlyTags(new Set());
  }

  function openNewTx() {
    const base: Transaction = {
      id: uid(),
      type: "expense",
      title: "",
      amountYen: 0,
      dateISO: period.startISO,
      periodStartISO: period.startISO,
      tagNames: [],
      splits: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setEditing(base);
    setShowEditor(true);
  }

  function openEditTx(tx: Transaction) {
    setEditing({ ...tx });
    setShowEditor(true);
  }

  /**
   * ✅ 一括コピー：前月(periodStartISO=prevPeriod.startISO)の取引を、今月(period.startISO)に全件コピー
   * - 元データは触らない
   * - 新規IDで追加（splitsも新規ID）
   * - dateISO は翌月へ（同日。存在しない日は月末）
   * - 保存先 periodStartISO は「今見ている月」に固定
   *
   * 注意:
   * - すでに今月に取引がある場合、二重追加になる可能性があるので警告する
   */
  async function bulkCopyPrevMonthToThisMonth() {
    if (prevTx.length === 0) {
      alert("前月の取引がありません。");
      return;
    }

    // 今月に既に取引がある場合は二重追加になりやすいので確認
    if (txInPeriod.length > 0) {
      const ok = confirm(
        `今月(${toJpDate(period.startISO)}〜)には既に ${txInPeriod.length} 件の取引があります。\n` +
          `このまま一括コピーすると “追加” になるため、二重計上の可能性があります。\n\n` +
          `それでも前月 ${prevTx.length} 件を一括コピーしますか？`
      );
      if (!ok) return;
    } else {
      const ok = confirm(`前月の取引 ${prevTx.length} 件を、今月に一括コピーしますか？`);
      if (!ok) return;
    }

    const now = Date.now();

    const copies: Transaction[] = prevTx.map((base) => {
      const nextSplits = (base.splits || []).map((s) => ({
        ...s,
        id: uid(),
      }));

      const sumSplits = nextSplits.reduce((acc, s) => acc + (s.amountYen || 0), 0);
      const fixedAmount = nextSplits.length > 0 ? sumSplits : base.amountYen || 0;

      const copied: Transaction = {
        ...base,
        id: uid(),
        dateISO: addOneMonthSameDay(base.dateISO),
        amountYen: fixedAmount,
        splits: nextSplits,
        periodStartISO: period.startISO, // ✅ 今月に固定
        createdAt: now,
        updatedAt: now,
      };

      return copied;
    });

    // まとめて追加（高速）
    await db.transactions.bulkAdd(copies);

    alert(`前月 ${prevTx.length} 件を今月にコピーしました。`);
    await reload();
  }

  async function saveTx(draft: Transaction) {
    const now = Date.now();

    // splitsがある場合は合計で amountYen を確定（表示用）
    const sumSplits = (draft.splits || []).reduce((acc, s) => acc + (s.amountYen || 0), 0);
    const fixedAmount = (draft.splits || []).length > 0 ? sumSplits : draft.amountYen || 0;

    const next: Transaction = {
      ...draft,
      amountYen: fixedAmount,
      periodStartISO: period.startISO,
      updatedAt: now,
    };

    const exists = await db.transactions.get(next.id);
    if (exists) await db.transactions.put(next);
    else await saveTransaction(next);

    setShowEditor(false);
    setEditing(null);
    await reload();
  }

  async function deleteTx(id: string) {
    if (!confirm("この取引を削除しますか？")) return;
    await db.transactions.delete(id);
    await reload();
  }

  // ---- Settings ----
  async function onChangeStartDay(day: number) {
    await setMonthStartDay(day);
    await reload();
  }

  async function addTag(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = tags.some((t) => t.name === trimmed);
    if (exists) return;

    await db.tagTemplates.add({
      id: uid(),
      name: trimmed,
      createdAt: Date.now(),
    });
    await reload();
  }

  async function removeTag(id: string) {
    if (!confirm("このタグを削除しますか？")) return;
    await db.tagTemplates.delete(id);
    await reload();
  }

  // ---- Backup ----
  async function doExport() {
    const json = await exportToJson();
    downloadJson(`kakeibo-backup-${Date.now()}.json`, json);
  }

  async function doImport(file: File | null) {
    if (!file) return;
    if (!confirm("復元しますか？（既存データは上書きされます）")) return;
    const text = await file.text();
    await importFromJson(text);
    await reload();
  }
async function saveTransaction(tx: any) {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  const { error } = await supabase.from("transactions").insert({
    user_id: user.id,
    date: tx.date,
    category: tx.category,
    amount: tx.amount,
    memo: tx.memo,
  });

  if (error) {
    console.error(error);
  }
}
  // ---- Yearly (タグ別：年間累計 / 月別) ----
  const yearly = useMemo(() => {
    const NO_TAG = "タグなし";
    const target = txs.filter((t) => yearFromISO(t.periodStartISO) === year);

    const income = sumAmount(target, "income");
    const expense = sumAmount(target, "expense");
    const diff = income - expense;

    const byMonth = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const monthTx = target.filter((t) => monthFromISO(t.periodStartISO) === m);
      const mi = sumAmount(monthTx, "income");
      const me = sumAmount(monthTx, "expense");
      return { month: m, income: mi, expense: me, diff: mi - me, txs: monthTx };
    });

    // ✅ タグ別（取引タグ + 内訳タグの両方を反映）
    const tagYearTotals: Record<string, number> = {};
    const tagMonthTotals: Record<number, Record<string, number>> = {};
    for (let m = 1; m <= 12; m++) tagMonthTotals[m] = {};

    const allTagsFromData = new Set<string>();

    for (const t of target) {
      const m = monthFromISO(t.periodStartISO);
      const map = buildTagAmountMap(t, NO_TAG);

      for (const [tag, amt] of map.entries()) {
        allTagsFromData.add(tag);
        tagYearTotals[tag] = (tagYearTotals[tag] ?? 0) + amt;
        tagMonthTotals[m][tag] = (tagMonthTotals[m][tag] ?? 0) + amt;
      }
    }

    // 表示するタグ一覧（設定 + データ）
    const fromSettings = tags.map((x) => x.name);
    const fromData = Array.from(allTagsFromData);
    const allTagNames = Array.from(new Set([...fromSettings, ...fromData]));

    allTagNames.sort((a, b) => (a === NO_TAG ? 1 : b === NO_TAG ? -1 : a.localeCompare(b)));

    return { income, expense, diff, byMonth, tagYearTotals, tagMonthTotals, allTagNames, NO_TAG };
  }, [txs, year, tags]);

  const yearlyVisibleTags = useMemo(() => {
    if (selectedYearlyTags.size === 0) return yearly.allTagNames;
    return Array.from(selectedYearlyTags);
  }, [selectedYearlyTags, yearly.allTagNames]);

  const NO_TAG_MONTH = "タグなし";

if (!session) {
  return <Login />;
}
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.headerRow}>
          <div style={styles.title}>Kakeibo</div>

          <div style={styles.tabs}>
            <TabButton active={tab === "monthly"} onClick={() => setTab("monthly")}>
              月次
            </TabButton>
            <TabButton active={tab === "yearly"} onClick={() => setTab("yearly")}>
              年間
            </TabButton>
            <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
              設定
            </TabButton>
            <TabButton active={tab === "backup"} onClick={() => setTab("backup")}>
              バックアップ
            </TabButton>
          </div>
        </div>

        {/* ===========================
            月次
        =========================== */}
        {tab === "monthly" && (
          <div>
            <Section>
              <div style={styles.periodRow}>
                <button style={styles.smallBtn} onClick={() => setRefISO(addMonths(refISO, -1))}>
                  ← 前
                </button>

                <div style={styles.periodText}>
                  対象期間
                  <br />
                  <b>
                    {toJpDate(period.startISO)} 〜 {toJpDate(period.endISO)}
                  </b>
                </div>

                <button style={styles.smallBtn} onClick={() => setRefISO(addMonths(refISO, +1))}>
                  次 →
                </button>
              </div>

              {/* ✅ 一括コピー（前月→今月） */}
              <div style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                <button style={styles.copyBtn} onClick={bulkCopyPrevMonthToThisMonth}>
                  前月を一括コピー（今月へ追加）
                </button>
                <div style={{ fontSize: 12, color: "#667085", fontWeight: 700 }}>
                  前月 {prevTx.length} 件 → 今月へ新規追加（日付は翌月へ自動更新）
                </div>
              </div>
            </Section>

            <Section title="サマリー">
              <div style={styles.summaryGrid}>
                <SummaryItem label="前月残" value={yen(carryPrev)} />
                <SummaryItem label="今月残" value={yen(carryThis)} />
                <SummaryItem label="収入" value={yen(incomeTotal)} />
                <SummaryItem label="支出" value={yen(expenseTotal)} />
              </div>
            </Section>

            <Section title="タグ">
              <div style={styles.chips}>
                {/* ※「すべて」は不要との要望で削除済み */}

                <Chip
                  selected={selectedFilterTags.has(NO_TAG_MONTH)}
                  onClick={() => toggleFilterTag(NO_TAG_MONTH)}
                  label={`${NO_TAG_MONTH} ${yen(tagTotalWithSplits(txInPeriod, NO_TAG_MONTH, NO_TAG_MONTH))}`}
                />

                {tags.map((t) => (
                  <Chip
                    key={t.id}
                    selected={selectedFilterTags.has(t.name)}
                    onClick={() => toggleFilterTag(t.name)}
                    label={`${t.name} ${yen(tagTotalWithSplits(txInPeriod, t.name, NO_TAG_MONTH))}`}
                  />
                ))}
              </div>

              <div style={styles.helpText}>※ タグは複数選択できます（取引タグ / 内訳タグのどれかを含む取引を表示）</div>

              {selectedFilterTags.size > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <button style={styles.smallBtn} onClick={clearFilterTags}>
                    フィルタ解除
                  </button>
                </div>
              ) : null}
            </Section>

            <Section title="取引一覧">
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                <button style={styles.primaryBtn} onClick={openNewTx}>
                  ＋ 追加
                </button>
              </div>

              {txFiltered.length === 0 ? (
                <div style={styles.empty}>取引がありません</div>
              ) : (
                <div style={styles.list}>
                  {txFiltered.map((tx) => (
                    <div key={tx.id} style={styles.card}>
                      <div style={styles.cardTop}>
                        <div style={styles.cardLeft}>
                          <div style={styles.txTitle}>{tx.title || "（未設定）"}</div>
                          <div style={styles.txMeta}>
                            {tx.type === "income" ? "収入" : "支出"} / {toJpDate(tx.dateISO)}
                            {tx.tagNames?.length ? ` / #${tx.tagNames.join(" #")}` : ""}
                          </div>
                        </div>

                        <div style={styles.cardRight}>
                          <div style={styles.txAmount}>{yen(tx.amountYen)}</div>
                        </div>
                      </div>

                      {tx.splits?.length ? (
                        <div style={styles.splitsBox}>
                          {tx.splits.map((s) => (
                            <div key={s.id} style={styles.splitRow}>
                              <div style={styles.splitMemo}>{s.memo || "（メモなし）"}</div>
                              <div style={styles.splitTags}>{s.tagNames?.length ? `#${s.tagNames.join(" #")}` : ""}</div>
                              <div style={styles.splitAmt}>{yen(s.amountYen || 0)}</div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <div style={styles.cardActions}>
                        <button style={styles.smallBtn} onClick={() => openEditTx(tx)}>
                          編集
                        </button>
                        <button style={styles.dangerBtn} onClick={() => deleteTx(tx.id)}>
                          削除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}

        {/* ===========================
            年間（タグ付き）
        =========================== */}
        {tab === "yearly" && (
          <div>
            <Section title={`年間サマリー（${year}年）`}>
              <div style={styles.yearHeader}>
                <button style={styles.smallBtn} onClick={() => setYear((y) => y - 1)}>
                  ←
                </button>
                <div style={styles.yearPill}>{year}年</div>
                <button style={styles.smallBtn} onClick={() => setYear((y) => y + 1)}>
                  →
                </button>
                <div style={{ marginLeft: "auto" }}>
                  <button style={styles.smallBtn} onClick={reload}>
                    再読み込み
                  </button>
                </div>
              </div>

              <div style={styles.yearSummaryGrid}>
                <div style={styles.yearRow}>
                  <div>収入累計</div>
                  <div style={styles.yearVal}>{yen(yearly.income)}</div>
                </div>
                <div style={styles.yearRow}>
                  <div>支出累計</div>
                  <div style={styles.yearVal}>{yen(yearly.expense)}</div>
                </div>
                <div style={styles.yearRow}>
                  <div>差引</div>
                  <div style={styles.yearVal}>{yen(yearly.diff)}</div>
                </div>
              </div>
            </Section>

            <Section title="月別">
              <div style={styles.monthList}>
                {yearly.byMonth.map((m) => (
                  <div key={m.month} style={styles.monthRow}>
                    <div style={styles.monthLabel}>{m.month}月</div>
                    <div style={styles.monthNums}>
                      <div style={styles.monthNum}>収入 {yen(m.income)}</div>
                      <div style={styles.monthNum}>支出 {yen(m.expense)}</div>
                      <div style={styles.monthNumStrong}>差引 {yen(m.diff)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="タグ別（年間累計）">
              <div style={styles.chips}>
                <Chip selected={selectedYearlyTags.size === 0} onClick={clearYearlyTags} label={"すべて"} />
                {yearly.allTagNames.map((name) => (
                  <Chip key={name} selected={selectedYearlyTags.has(name)} onClick={() => toggleYearlyTag(name)} label={name} />
                ))}
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {yearlyVisibleTags.map((name) => (
                  <div key={name} style={styles.yearRow}>
                    <div>{name}</div>
                    <div style={styles.yearVal}>{yen(yearly.tagYearTotals[name] ?? 0)}</div>
                  </div>
                ))}
              </div>

              <div style={styles.helpText}>※ 取引タグも内訳タグも両方集計します（選択中のタグだけ表示）</div>
            </Section>

            <Section title="タグ別（月別）">
              <div style={styles.monthList}>
                {yearly.byMonth.map((m) => (
                  <div key={m.month} style={styles.monthRow}>
                    <div style={styles.monthLabel}>{m.month}月</div>

                    <div style={{ display: "grid", gap: 8, width: "100%" }}>
                      {yearlyVisibleTags.map((tag) => (
                        <div key={tag} style={styles.rowBetween}>
                          <div style={{ fontWeight: 800, color: "#344054" }}>{tag}</div>
                          <div style={{ fontWeight: 900 }}>{yen(yearly.tagMonthTotals[m.month]?.[tag] ?? 0)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* ===========================
            設定
        =========================== */}
        {tab === "settings" && (
          <div>
            <Section title="月の開始日（締め設定）">
              <div style={styles.row}>
                <label style={{ minWidth: 120 }}>開始日</label>
                <select value={settings.monthStartDay} onChange={(e) => onChangeStartDay(Number(e.target.value))} style={styles.select}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}日
                    </option>
                  ))}
                </select>
              </div>
              <div style={styles.helpText}>例：20日にすると「毎月20日〜翌19日」を1ヶ月として集計します。</div>
            </Section>

            <Section title="タグ">
              <TagManager tags={tags} onAdd={addTag} onRemove={removeTag} />
            </Section>
          </div>
        )}

        {/* ===========================
            バックアップ
        =========================== */}
        {tab === "backup" && (
          <div>
            <Section title="バックアップ / 復元（ローカルJSON）">
              <div style={styles.rowGap}>
                <button style={styles.primaryBtn} onClick={doExport}>
                  バックアップ（JSON）
                </button>
                <label style={styles.fileBtn}>
                  復元（JSON）
                  <input
                    type="file"
                    accept="application/json"
                    style={{ display: "none" }}
                    onChange={(e) => doImport(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <div style={styles.helpText}>※ 完全ローカル運用です。バックアップしたJSONは自分で保管してください。</div>
            </Section>
          </div>
        )}
      </div>

      {showEditor && editing && (
        <TxEditorModal
          tags={tags}
          draft={editing}
          onClose={() => {
            setShowEditor(false);
            setEditing(null);
          }}
          onSave={saveTx}
        />
      )}
    </div>
  );
}

// ---------------- components ----------------

function TabButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={props.onClick} style={{ ...styles.tabBtn, ...(props.active ? styles.tabBtnActive : {}) }}>
      {props.children}
    </button>
  );
}

function Section(props: { title?: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      {props.title ? <div style={styles.sectionTitle}>{props.title}</div> : null}
      <div style={styles.sectionBody}>{props.children}</div>
    </div>
  );
}

function SummaryItem(props: { label: string; value: string }) {
  return (
    <div style={styles.summaryItem}>
      <div style={styles.summaryLabel}>{props.label}</div>
      <div style={styles.summaryValue}>{props.value}</div>
    </div>
  );
}

function Chip(props: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={props.onClick} style={{ ...styles.chip, ...(props.selected ? styles.chipSelected : {}) }}>
      {props.label}
    </button>
  );
}

function TagManager(props: { tags: TagTemplate[]; onAdd: (name: string) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const [name, setName] = useState("");

  return (
    <div>
      <div style={styles.rowGap}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="タグ名" style={styles.input} />
        <button
          style={styles.primaryBtn}
          onClick={async () => {
            await props.onAdd(name);
            setName("");
          }}
        >
          追加
        </button>
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {props.tags.map((t) => (
          <div key={t.id} style={styles.rowBetween}>
            <div>{t.name}</div>
            <button style={styles.dangerBtn} onClick={() => props.onRemove(t.id)}>
              削除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TxEditorModal(props: { tags: TagTemplate[]; draft: Transaction; onClose: () => void; onSave: (tx: Transaction) => Promise<void> }) {
  const [tx, setTx] = useState<Transaction>(props.draft);

  useEffect(() => {
    setTx(props.draft);
  }, [props.draft]);

  function toggleTxTag(name: string) {
    setTx((prev) => {
      const next = new Set(prev.tagNames || []);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...prev, tagNames: Array.from(next) };
    });
  }

  function setSplit(idx: number, patch: Partial<Split>) {
    setTx((prev) => {
      const next = [...(prev.splits || [])];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, splits: next };
    });
  }

  function addSplit() {
    setTx((prev) => ({
      ...prev,
      splits: [...(prev.splits || []), { id: uid(), memo: "", amountYen: 0, tagNames: [] }],
    }));
  }

  function removeSplit(idx: number) {
    setTx((prev) => {
      const next = [...(prev.splits || [])];
      next.splice(idx, 1);
      return { ...prev, splits: next };
    });
  }

  function toggleSplitTag(idx: number, name: string) {
    const s = (tx.splits || [])[idx];
    const next = new Set(s?.tagNames || []);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSplit(idx, { tagNames: Array.from(next) });
  }

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <div style={styles.modalTitle}>取引 {props.draft.title ? "編集" : "追加"}</div>

        <div style={styles.formGrid}>
          <label>種別</label>
          <select value={tx.type} onChange={(e) => setTx({ ...tx, type: e.target.value as TxType })} style={styles.select}>
            <option value="expense">支出</option>
            <option value="income">収入</option>
          </select>

          <label>項目名</label>
          <input value={tx.title} onChange={(e) => setTx({ ...tx, title: e.target.value })} style={styles.input} placeholder="例：電気代" />

          <label>実行日</label>
          <input type="date" value={tx.dateISO} onChange={(e) => setTx({ ...tx, dateISO: e.target.value })} style={styles.input} />

          <label>金額（円）</label>
          <input type="number" value={tx.amountYen} onChange={(e) => setTx({ ...tx, amountYen: Number(e.target.value || 0) })} style={styles.input} />
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={styles.sectionTitle}>タグ（取引・複数選択）</div>
          <div style={styles.chips}>
            {props.tags.map((t) => (
              <Chip key={t.id} selected={(tx.tagNames || []).includes(t.name)} onClick={() => toggleTxTag(t.name)} label={t.name} />
            ))}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={styles.sectionTitle}>内訳（任意・各内訳にもタグ複数）</div>

          <div style={{ display: "grid", gap: 12 }}>
            {(tx.splits || []).map((s, idx) => (
              <div key={s.id} style={styles.splitEditorBox}>
                <div style={styles.formGrid}>
                  <label>メモ</label>
                  <input value={s.memo} onChange={(e) => setSplit(idx, { memo: e.target.value })} style={styles.input} placeholder="例：コンビニ" />
                  <label>金額（円）</label>
                  <input type="number" value={s.amountYen} onChange={(e) => setSplit(idx, { amountYen: Number(e.target.value || 0) })} style={styles.input} />
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: "#667085", marginBottom: 6 }}>内訳タグ（複数選択）</div>
                  <div style={styles.chips}>
                    {props.tags.map((t) => (
                      <Chip key={t.id} selected={(s.tagNames || []).includes(t.name)} onClick={() => toggleSplitTag(idx, t.name)} label={t.name} />
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                  <button style={styles.dangerBtn} onClick={() => removeSplit(idx)}>
                    内訳を削除
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10 }}>
            <button style={styles.smallBtn} onClick={addSplit}>
              ＋ 内訳を追加
            </button>
          </div>

          <div style={styles.helpText}>※ 内訳がある場合は金額は自動で内訳合計になります（反映ボタン不要）。</div>
        </div>

        <div style={styles.modalActions}>
          <button style={styles.smallBtn} onClick={props.onClose}>
            閉じる
          </button>
          <button
            style={styles.primaryBtn}
            onClick={async () => {
              await props.onSave({ ...tx, updatedAt: Date.now() });
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- styles ----------------

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #F6FAF7 0%, #EEF6F0 100%)",
    padding: "28px 16px",
    color: "#101828",
  },
  container: {
    maxWidth: 920,
    margin: "0 auto",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 18,
  },
  title: {
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: 0.2,
  },
  tabs: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  tabBtn: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #E6EDE7",
    background: "rgba(255,255,255,0.85)",
    cursor: "pointer",
    fontWeight: 700,
  },
  tabBtnActive: {
    borderColor: "#B7D7BF",
    boxShadow: "0 8px 20px rgba(16,24,40,0.06)",
  },

  section: {
    marginTop: 18,
    marginBottom: 18,
    padding: 16,
    borderRadius: 18,
    border: "1px solid #E6EDE7",
    background: "rgba(255,255,255,0.85)",
    boxShadow: "0 10px 24px rgba(16,24,40,0.05)",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 800,
    marginBottom: 10,
  },
  sectionBody: {},

  periodRow: {
    display: "grid",
    gridTemplateColumns: "120px 1fr 120px",
    gap: 12,
    alignItems: "center",
  },
  periodText: {
    textAlign: "center",
    lineHeight: 1.4,
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
  },
  summaryItem: {
    borderRadius: 14,
    border: "1px solid #E6EDE7",
    padding: 12,
    background: "#FFFFFF",
  },
  summaryLabel: { fontSize: 13, color: "#667085", fontWeight: 700 },
  summaryValue: { fontSize: 20, fontWeight: 900, marginTop: 6 },

  chips: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  chip: {
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid #E6EDE7",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 800,
  },
  chipSelected: {
    borderColor: "#7EC28E",
    background: "#EAF6EE",
  },

  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #7EC28E",
    background: "#7EC28E",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
  },
  smallBtn: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #E6EDE7",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 800,
  },
  dangerBtn: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #F3B4B4",
    background: "#FCECEC",
    cursor: "pointer",
    fontWeight: 900,
    color: "#B42318",
  },

  // ✅ 一括コピー専用ボタン（目立たせる）
  copyBtn: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #B7D7BF",
    background: "#EAF6EE",
    cursor: "pointer",
    fontWeight: 900,
    color: "#027A48",
  },

  list: { display: "grid", gap: 12 },
  card: {
    borderRadius: 18,
    border: "1px solid #E6EDE7",
    background: "#fff",
    padding: 14,
  },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  cardLeft: { minWidth: 0 },
  cardRight: { textAlign: "right", minWidth: 140 },
  txTitle: { fontSize: 18, fontWeight: 900, marginBottom: 4 },
  txMeta: {
    fontSize: 13,
    color: "#667085",
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  txAmount: { fontSize: 18, fontWeight: 900 },

  splitsBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid #EEF2EF",
    display: "grid",
    gap: 6,
  },
  splitRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto 120px",
    gap: 10,
    alignItems: "center",
  },
  splitMemo: {
    fontSize: 13,
    color: "#667085",
    fontWeight: 700,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  splitTags: { fontSize: 12, color: "#98A2B3", fontWeight: 800, whiteSpace: "nowrap" },
  splitAmt: { fontSize: 13, color: "#667085", fontWeight: 900, textAlign: "right" },

  cardActions: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 },

  row: { display: "flex", alignItems: "center", gap: 12 },
  rowGap: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" },
  rowBetween: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  select: { padding: "10px 12px", borderRadius: 12, border: "1px solid #E6EDE7", background: "#fff" },
  input: { padding: "10px 12px", borderRadius: 12, border: "1px solid #E6EDE7", background: "#fff", width: "100%" },
  helpText: { marginTop: 10, fontSize: 12, color: "#667085", fontWeight: 700 },

  empty: {
    padding: 14,
    borderRadius: 14,
    border: "1px dashed #D0D5DD",
    background: "#fff",
    color: "#667085",
    fontWeight: 800,
  },

  fileBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #E6EDE7",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 900,
  },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(16,24,40,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  modal: {
    width: "min(920px, 100%)",
    maxHeight: "85vh",
    overflow: "auto",
    background: "#fff",
    borderRadius: 18,
    border: "1px solid #E6EDE7",
    padding: 16,
    boxShadow: "0 30px 70px rgba(16,24,40,0.25)",
  },
  modalTitle: { fontSize: 18, fontWeight: 900, marginBottom: 12 },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 16 },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "140px 1fr",
    gap: 10,
    alignItems: "center",
  },
  splitEditorBox: {
    borderRadius: 14,
    border: "1px solid #EEF2EF",
    padding: 12,
    background: "#FBFDFB",
  },

  // yearly
  yearHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  yearPill: {
    padding: "8px 12px",
    borderRadius: 14,
    border: "1px solid #E6EDE7",
    background: "#fff",
    fontWeight: 900,
  },
  yearSummaryGrid: {
    display: "grid",
    gap: 10,
    marginTop: 8,
  },
  yearRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #E6EDE7",
    background: "#fff",
    fontWeight: 800,
  },
  yearVal: {
    fontWeight: 900,
  },
  monthList: {
    display: "grid",
    gap: 10,
  },
  monthRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #E6EDE7",
    background: "#fff",
  },
  monthLabel: { fontWeight: 900, minWidth: 56, paddingTop: 2 },
  monthNums: { display: "flex", gap: 16, justifyContent: "flex-end", flexWrap: "wrap" },
  monthNum: { fontWeight: 800, color: "#344054" },
  monthNumStrong: { fontWeight: 900, color: "#101828" },
};
async function saveTransaction(tx: any) {
  const user = (await supabase.auth.getUser()).data.user;

  if (!user) return;

  await supabase.from("transactions").insert({
    user_id: user.id,
    date: tx.date,
    category: tx.category,
    amount: tx.amount,
    memo: tx.memo,
  });
