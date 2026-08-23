/* ===========================================================
   中間CSV から d1_municipalities.json / d2_oaza.json を作る

   使い方:  node chiiki/tools/ingest/build-data.js

   読むもの（すべて chiiki/data/source/ に置きます）:
     中間_大字と旧市町村.csv   … match-oaza.js が作ります
     中間_市町村区分.csv       … 市町村マスタのもと
     中間_区域指定.csv         … 条件不利区域(b) にあたる旧市町村の一覧
     取得記録.json             … 出典・基準日・どの法令の一覧を投入したか

   置き方は chiiki/data/source/README.md をご覧ください。
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { 復号, CSVを分ける } = require("./read-isj.js");

/* テストから別の場所を指せるようにしています（chiiki/tools/test-pipeline.js） */
const root = process.env.CHIIKI_DATA_ROOT ? path.resolve(process.env.CHIIKI_DATA_ROOT) : path.resolve(__dirname, "..", "..");
const src = (f) => path.join(root, "data", "source", f);
const dst = (f) => path.join(root, "data", f);

const 区域法令 = ["過疎", "山村", "離島", "半島"];

/* ---------- 読み込み ---------- */
function 表を読む(ファイル, 必須列) {
  if (!fs.existsSync(ファイル)) return null;
  const 行 = CSVを分ける(復号(fs.readFileSync(ファイル)));
  if (!行.length) return { rows: [], 欠け: 必須列 };
  const 見出し = 行[0].map((h) => h.replace(/^﻿/, "").trim());
  const 欠け = 必須列.filter((c) => 見出し.indexOf(c) < 0);
  const rows = 行.slice(1).map((r) => {
    const o = {};
    見出し.forEach((h, i) => { o[h] = (r[i] || "").trim(); });
    return o;
  }).filter((o) => Object.keys(o).some((k) => o[k] !== ""));
  return { rows, 欠け };
}

const 止める = (m) => { console.error("\n  " + m + "\n"); process.exit(1); };

const 大字表 = 表を読む(src("中間_大字と旧市町村.csv"),
  ["大字町丁目コード", "市町村コード", "大字名", "旧市町村名", "要確認理由"]);
const 区分表 = 表を読む(src("中間_市町村区分.csv"),
  ["市町村コード", "市町村名", "区分", "指定都市区分", "該当法令"]);
const 指定表 = 表を読む(src("中間_区域指定.csv"), ["市町村コード", "旧市町村名", "法令"]);

if (!区分表) 止める("中間_市町村区分.csv がありません。chiiki/data/source/README.md をご覧ください。");
if (区分表.欠け.length) 止める("中間_市町村区分.csv に列がありません: " + 区分表.欠け.join("・"));
if (大字表 && 大字表.欠け.length) 止める("中間_大字と旧市町村.csv に列がありません: " + 大字表.欠け.join("・"));
if (指定表 && 指定表.欠け.length) 止める("中間_区域指定.csv に列がありません: " + 指定表.欠け.join("・"));

let 記録 = { 資料: [], 収録法令: [] };
if (fs.existsSync(src("取得記録.json"))) 記録 = JSON.parse(fs.readFileSync(src("取得記録.json"), "utf8"));

const 収録法令 = (記録.収録法令 || []).filter((l) => 区域法令.indexOf(l) >= 0);
if (!収録法令.length) {
  console.log("  注意: 取得記録.json の 収録法令 が空です。");
  console.log("        どの法令の区域一覧を投入したかが分からないため、");
  console.log("        すべての市町村で区域(c) が「要確認」になります。\n");
}

/* ---------- D1 ---------- */
const 旧名を整える = (s) => String(s || "").replace(/^旧/, "").trim();
const 分割 = (s) => String(s || "").split("|").map((x) => x.trim()).filter(Boolean);

const 市町村 = 区分表.rows.map((r) => {
  const 該当法令 = 分割(r.該当法令);
  return {
    コード: r.市町村コード,
    都道府県名: r.都道府県名 || "",
    市町村名: r.市町村名,
    三大都市圏: r.三大都市圏 === "1",
    人口減少率例外: r.人口減少率例外 === "1",
    区分: r.区分,
    指定都市区分: r.指定都市区分 || "該当なし",
    該当法令: 該当法令,
    /* 区域レベルの一覧を実際に投入できた法令だけを立てます。
       ここが該当法令を覆っていないと、判定エンジンは (c) を要確認に落とします。 */
    照合済み法令: 該当法令.filter((l) => 収録法令.indexOf(l) >= 0),
    verified: true
  };
});
const 市町村索引 = {};
市町村.forEach((m) => { 市町村索引[m.コード] = m; });

/* 都道府県名が中間CSVになければ、大字表から補います */
if (大字表) {
  大字表.rows.forEach((r) => {
    const m = 市町村索引[r.市町村コード];
    if (m && !m.都道府県名 && r.都道府県名) m.都道府県名 = r.都道府県名;
  });
}
const 都道府県未設定 = 市町村.filter((m) => !m.都道府県名);
if (都道府県未設定.length) {
  console.log(`  注意: 都道府県名が入っていない市町村が ${都道府県未設定.length} 件あります（画面のプルダウンが作れません）。`);
  console.log("        中間_市町村区分.csv に 都道府県名 の列を足してください。\n");
}

/* ---------- 区域指定の索引 ---------- */
const 指定 = {};   // "市町村コード\t旧市町村名" -> Set(法令)
(指定表 ? 指定表.rows : []).forEach((r) => {
  const 法令 = r.法令.trim();
  if (区域法令.indexOf(法令) < 0) {
    console.log(`  警告: 中間_区域指定.csv に区域レベルでない法令「${法令}」があります（${r.市町村コード} ${r.旧市町村名}）。無視します。`);
    return;
  }
  if (収録法令.indexOf(法令) < 0) {
    console.log(`  警告: 「${法令}」が取得記録.json の 収録法令 に入っていません（${r.市町村コード} ${r.旧市町村名}）。`);
  }
  const k = r.市町村コード + "\t" + 旧名を整える(r.旧市町村名);
  (指定[k] = 指定[k] || new Set()).add(法令);
});

/* ---------- D2 ---------- */
const 区域必要 = (m) => m && (m.指定都市区分 === "条件不利地域を含む" || m.区分 === "一部条件不利地域");

const 大字 = [];
(大字表 ? 大字表.rows : []).forEach((r) => {
  const m = 市町村索引[r.市町村コード];
  if (!区域必要(m)) return;   // ②で結論が出る市町村の大字は持ちません

  const o = {
    id: r.大字町丁目コード,
    市町村コード: r.市町村コード,
    大字名: r.大字名,
    旧市町村名: r.旧市町村名 ? (String(r.旧市町村名).charAt(0) === "旧" ? r.旧市町村名 : "旧" + r.旧市町村名) : "",
    区域判定: "",
    該当法令: []
  };
  if (r.突合方法) o.突合方法 = r.突合方法;
  if (r.突合距離m !== "" && r.突合距離m !== undefined) o.突合距離m = Number(r.突合距離m);

  if (r.要確認理由) {
    o.区域判定 = "要確認";
    o.要確認理由 = r.要確認理由;
    o.旧市町村名 = "";
    大字.push(o);
    return;
  }
  const 当たり = 指定[r.市町村コード + "\t" + 旧名を整える(r.旧市町村名)];
  if (当たり && 当たり.size) {
    o.区域判定 = "b";
    o.該当法令 = 区域法令.filter((l) => 当たり.has(l));
  } else {
    o.区域判定 = "c";
  }
  大字.push(o);
});

/* ---------- 書き出し ---------- */
const 基準日 = 記録.基準日 || (指定表 && 指定表.rows.length ? (指定表.rows[0].基準日 || "") : "");

function 見出しを残して書く(ファイル, 差分) {
  const 元 = JSON.parse(fs.readFileSync(ファイル, "utf8"));
  Object.keys(差分).forEach((k) => { 元[k] = 差分[k]; });
  fs.writeFileSync(ファイル, JSON.stringify(元, null, 2) + "\n", "utf8");
}
見出しを残して書く(dst("d1_municipalities.json"), { 基準日: 基準日, 市町村: 市町村 });
見出しを残して書く(dst("d2_oaza.json"), { 基準日: 基準日, 大字: 大字 });

/* meta も、投入した内容に合わせて更新します */
const meta = JSON.parse(fs.readFileSync(dst("meta.json"), "utf8"));
meta.基準日 = 基準日 || meta.基準日;
const 県 = [...new Set(市町村.map((m) => m.都道府県名).filter(Boolean))];
meta.収録範囲 = {
  都道府県: 県,
  注記: 県.length
    ? "現在このツールに収録されているのは " + 県.join("・") + " です。収録外にお住まいの方の判定はできません。"
    : "データがまだ投入されていません。"
};
if ((記録.資料 || []).length) {
  meta.出典 = 記録.資料.map((s) => ({ 名称: s.名称, url: s.url || "", 現在日: s.現在日 || "", 取得日: s.取得日 || "" }));
}
const 全法令そろった = 市町村.every((m) => m.該当法令.filter((l) => 区域法令.indexOf(l) >= 0).every((l) => m.照合済み法令.indexOf(l) >= 0));
meta.dataStatus = 全法令そろった && 市町村.length ? "verified" : "provisional";
if (!全法令そろった) {
  const 欠け = [...new Set(市町村.flatMap((m) => m.該当法令.filter((l) => 区域法令.indexOf(l) >= 0 && m.照合済み法令.indexOf(l) < 0)))];
  meta.暫定データ警告 = {
    見出し: 欠け.join("・") + " の区域一覧がまだ投入されていません。",
    本文: "条件不利区域(b) に当たることまでは確かめられますが、(b) に当たらないこと（＝(c)）を言い切れないため、該当する市町村では判定が「要確認」になります。",
    解除方法: "chiiki/data/source/README.md の 5〜7 の一覧を投入し、取得記録.json の 収録法令 に足して取り込み直してください。"
  };
}
fs.writeFileSync(dst("meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");

/* ---------- 結果 ---------- */
const 数 = (f) => 大字.filter(f).length;
console.log("");
console.log(`  D1 市町村   : ${市町村.length} 件`);
console.log(`  D2 大字     : ${大字.length} 件（b:${数((o) => o.区域判定 === "b")} / c:${数((o) => o.区域判定 === "c")} / 要確認:${数((o) => o.区域判定 === "要確認")}）`);
console.log(`  収録法令    : ${収録法令.length ? 収録法令.join("・") : "なし"}`);
console.log(`  データ状態  : ${meta.dataStatus}（基準日 ${meta.基準日 || "未設定"}）`);
console.log("");
console.log("  次に:  node chiiki/tools/check-data.js");
console.log("         node chiiki/tools/ingest/report-coverage.js");
console.log("         node chiiki/tools/build.js\n");
