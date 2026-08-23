/* ===========================================================
   中間CSV から d1_municipalities.json / d2_oaza.json を作る

   使い方:  node chiiki/tools/ingest/build-data.js

   読むもの（すべて chiiki/data/source/）:
     中間_市町村区分.csv  … build-municipalities.js が作る
     中間_大字と区域.csv  … match-by-prefix.js / add-polygon-laws.js が作る
     取得記録.json        … 出典・基準日・どの法令の一覧を投入したか

   置き方と流す順序は chiiki/data/source/README.md をご覧ください。
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { 復号, CSVを分ける } = require("./read-isj.js");

const root = process.env.CHIIKI_DATA_ROOT ? path.resolve(process.env.CHIIKI_DATA_ROOT) : path.resolve(__dirname, "..", "..");
const src = (f) => path.join(root, "data", "source", f);
const dst = (f) => path.join(root, "data", f);

const 区域法令 = ["過疎", "山村", "離島", "半島"];
const 止める = (m) => { console.error("\n  " + m + "\n"); process.exit(1); };

function 表を読む(ファイル, 必須) {
  if (!fs.existsSync(ファイル)) return null;
  const 行 = CSVを分ける(復号(fs.readFileSync(ファイル)));
  if (!行.length) return [];
  const 見 = 行[0].map((h) => h.replace(/^﻿/, "").trim());
  const 欠 = (必須 || []).filter((c) => 見.indexOf(c) < 0);
  if (欠.length) 止める(path.basename(ファイル) + " に列がありません: " + 欠.join("・"));
  return 行.slice(1).map((r) => {
    const o = {};
    見.forEach((h, i) => { o[h] = (r[i] || "").trim(); });
    return o;
  }).filter((o) => Object.keys(o).some((k) => o[k] !== ""));
}

const 分割 = (s) => String(s || "").split("|").map((x) => x.trim()).filter(Boolean);

/* ---------- 読み込み ---------- */
const 区分表 = 表を読む(src("中間_市町村区分.csv"),
  ["市町村コード", "都道府県名", "市町村名", "区分", "指定都市区分", "該当法令", "照合済み法令"]);
if (!区分表) 止める("中間_市町村区分.csv がありません。先に node chiiki/tools/ingest/build-municipalities.js を流してください。");

const 大字表 = 表を読む(src("中間_大字と区域.csv"),
  ["大字町丁目コード", "市町村コード", "大字名"]) || [];

let 記録 = { 資料: [], 収録法令: [], 基準日: "" };
if (fs.existsSync(src("取得記録.json"))) 記録 = JSON.parse(fs.readFileSync(src("取得記録.json"), "utf8"));
const 収録法令 = (記録.収録法令 || []).filter((l) => 区域法令.indexOf(l) >= 0);

/* ---------- D1 ---------- */
const 市町村 = 区分表.map((r) => ({
  コード: r.市町村コード,
  都道府県名: r.都道府県名,
  市町村名: r.市町村名,
  三大都市圏: r.三大都市圏 === "1",
  人口減少率例外: r.人口減少率例外 === "1",
  区分: r.区分,
  指定都市区分: r.指定都市区分 || "該当なし",
  該当法令: 分割(r.該当法令),
  /* 区域レベルの一覧を実際に投入できた法令。これが該当法令を覆っていないと、
     判定エンジンは区域(c) を「要確認」に落とします。 */
  /* 中間CSVに書いてあればそれを、無ければ取得記録.json の 収録法令 を使います。
     地域要件確認表からは「どの法令で条件不利か」までは分からないためです。 */
  照合済み法令: 分割(r.照合済み法令).length ? 分割(r.照合済み法令) : 収録法令.slice(),
  verified: true
}));
/* 画面のプルダウンがコード順（北海道→沖縄県）に並ぶよう、ここでそろえておきます */
市町村.sort((a, b) => a.コード.localeCompare(b.コード));
const 索引 = {};
市町村.forEach((m) => { 索引[m.コード] = m; });

/* ---------- D2 ---------- */
const 区域必要 = (m) => m && (m.指定都市区分 === "条件不利地域を含む" || m.区分 === "一部条件不利地域");

const 大字 = [];
const 落とした = { 市町村なし: 0, 区域判定が不要: 0 };
大字表.forEach((r) => {
  const m = 索引[r.市町村コード];
  if (!m) { 落とした.市町村なし++; return; }
  if (!区域必要(m)) { 落とした.区域判定が不要++; return; }

  const 法令別 = {};
  区域法令.forEach((l) => { 法令別[l] = r[l] || ""; });
  const b法令 = 区域法令.filter((l) => 法令別[l] === "b");
  const 未判定 = 区域法令.filter((l) => 法令別[l] !== "b" && 法令別[l] !== "c");

  const o = {
    id: r.大字町丁目コード,
    市町村コード: r.市町村コード,
    大字名: r.大字名,
    旧市町村名: r.旧市町村名 ? (r.旧市町村名.charAt(0) === "旧" ? r.旧市町村名 : "旧" + r.旧市町村名) : "",
    区域判定: "",
    該当法令: []
  };
  if (r.決め方) o.決め方 = r.決め方;
  if (r.緯度) o.緯度 = Number(r.緯度);
  if (r.経度) o.経度 = Number(r.経度);

  if (r.要確認理由) {
    o.区域判定 = "要確認";
    o.要確認理由 = r.要確認理由;
    o.旧市町村名 = "";
  } else if (b法令.length) {
    /* (b) は4法令のうち1つに載っていれば言えます */
    o.区域判定 = "b";
    o.該当法令 = b法令;
  } else if (未判定.length) {
    /* (c) は「どれにも載っていない」ことなので、未判定が1つでもあれば言えません */
    o.区域判定 = "要確認";
    o.要確認理由 = 未判定.join("・") + " の区域が判定できていません";
    o.旧市町村名 = "";
  } else {
    o.区域判定 = "c";
  }
  大字.push(o);
});

大字.sort((a, b) => String(a.id).localeCompare(String(b.id)));

/* ---------- 書き出し ---------- */
const 基準日 = 記録.基準日 || "";

function 見出しを残して書く(ファイル, 差分) {
  const 元 = JSON.parse(fs.readFileSync(ファイル, "utf8"));
  Object.keys(差分).forEach((k) => { 元[k] = 差分[k]; });
  fs.writeFileSync(ファイル, JSON.stringify(元, null, 2) + "\n", "utf8");
}
見出しを残して書く(dst("d1_municipalities.json"), { 基準日: 基準日, 市町村: 市町村 });
見出しを残して書く(dst("d2_oaza.json"), { 基準日: 基準日, 大字: 大字 });

const meta = JSON.parse(fs.readFileSync(dst("meta.json"), "utf8"));
meta.基準日 = 基準日 || meta.基準日;
const 県 = [...new Set(市町村.map((m) => m.都道府県名).filter(Boolean))];
meta.収録範囲 = {
  都道府県: 県,
  注記: 県.length === 0 ? "データがまだ投入されていません。"
    : 県.length >= 47 ? "全国の市町村を収録しています。"
    : "現在このツールに収録されているのは " + 県.join("・") + " です。収録外にお住まいの方の判定はできません。"
};
if ((記録.資料 || []).length) {
  meta.出典 = 記録.資料.map((s) => ({ 名称: s.名称, url: s.url || "", 現在日: s.現在日 || "", 取得日: s.取得日 || "" }));
}
const 未投入 = 区域法令.filter((l) => 収録法令.indexOf(l) < 0);
meta.dataStatus = (!未投入.length && 市町村.length) ? "verified" : "provisional";
if (未投入.length) {
  meta.暫定データ警告 = {
    見出し: 未投入.join("・") + " の区域一覧がまだ投入されていません。",
    本文: "条件不利区域(b) に当たることまでは確かめられますが、(b) に当たらないこと（＝(c)）を言い切れないため、"
      + "該当する市町村では判定が「要確認」になります。",
    解除方法: "chiiki/data/source/README.md に従って一覧を投入し、取得記録.json の 収録法令 に足して取り込み直してください。"
  };
}
fs.writeFileSync(dst("meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");

/* ---------- 結果 ---------- */
const 区分数 = {};
市町村.forEach((m) => { 区分数[m.区分] = (区分数[m.区分] || 0) + 1; });
const 数 = (f) => 大字.filter(f).length;
console.log("");
console.log(`  D1 市町村 : ${市町村.length.toLocaleString()} 件  ` +
  Object.keys(区分数).map((k) => `${k} ${区分数[k]}`).join(" / "));
console.log(`  D2 大字   : ${大字.length.toLocaleString()} 件` +
  `（b:${数((o) => o.区域判定 === "b").toLocaleString()}` +
  ` / c:${数((o) => o.区域判定 === "c").toLocaleString()}` +
  ` / 要確認:${数((o) => o.区域判定 === "要確認").toLocaleString()}）`);
if (落とした.区域判定が不要) console.log(`    （区域判定が要らない市町村の大字 ${落とした.区域判定が不要.toLocaleString()} 件は入れていません）`);
if (落とした.市町村なし) console.log(`    警告: D1 にない市町村の大字 ${落とした.市町村なし} 件を捨てました`);
console.log(`  収録法令  : ${収録法令.length ? 収録法令.join("・") : "なし"}`);
console.log(`  データ状態: ${meta.dataStatus}（基準日 ${meta.基準日 || "未設定"}）`);
console.log("");
console.log("  次に:  node chiiki/tools/check-data.js");
console.log("         node chiiki/tools/ingest/report-coverage.js");
console.log("         node chiiki/tools/build.js\n");
