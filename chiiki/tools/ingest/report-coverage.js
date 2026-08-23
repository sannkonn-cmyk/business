/* ===========================================================
   取り込みの進み具合を表にする
   使い方:  node chiiki/tools/ingest/report-coverage.js [--csv]

   ・法令の区域一覧がどこまで揃っているか
   ・区域判定を確定できた大字の割合
   ・要確認になった大字とその理由
   を出します。--csv を付けると要確認の一覧を CSV で書き出します。
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const root = process.env.CHIIKI_DATA_ROOT ? path.resolve(process.env.CHIIKI_DATA_ROOT) : path.resolve(__dirname, "..", "..");
const Judge = require(path.resolve(__dirname, "..", "..", "src", "judge.js"));
const j = (f) => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));

const meta = j("meta.json"), d1 = j("d1_municipalities.json"), d2 = j("d2_oaza.json");

if (!d1.市町村.length) {
  console.log("\n  データがまだ投入されていません。");
  console.log("  chiiki/data/source/README.md に従って原典を置き、取り込みツールを流してください。\n");
  process.exit(0);
}

const 区域必要 = (m) => m.指定都市区分 === "条件不利地域を含む" || m.区分 === "一部条件不利地域";
const 大字別 = {};
d2.大字.forEach((o) => { (大字別[o.市町村コード] = 大字別[o.市町村コード] || []).push(o); });

const 幅 = (s, n) => {
  let w = 0; for (const c of String(s)) w += c.charCodeAt(0) < 0x100 ? 1 : 2;
  return String(s) + " ".repeat(Math.max(0, n - w));
};

console.log("");
console.log("  データ基準日: " + (meta.基準日 || "未設定") + " ／ 状態: " + meta.dataStatus);
console.log("");

/* ---------- 法令の網羅状況 ---------- */
console.log("  ■ 区域一覧の投入状況");
console.log("");
Judge.区域レベルの法令.forEach((l) => {
  const 該当 = d1.市町村.filter((m) => (m.該当法令 || []).indexOf(l) >= 0);
  const 済 = 該当.filter((m) => (m.照合済み法令 || []).indexOf(l) >= 0);
  const 印 = 該当.length === 0 ? "—" : 済.length === 該当.length ? "済" : "未";
  console.log(`    ${印}  ${幅(l, 6)} 該当 ${幅(該当.length, 5)} うち投入済み ${該当.length ? 済.length : "—"}`);
});
const 欠けている市町村 = d1.市町村.filter((m) => 区域必要(m) && Judge.未照合の法令(m).length);
console.log("");
if (欠けている市町村.length) {
  console.log(`    区域一覧が足りず、(c) が「要確認」になる市町村: ${欠けている市町村.length} 件`);
  console.log("    → chiiki/data/source/README.md の 5〜7 を投入すると解消します。");
} else {
  console.log("    4法令とも揃っています。(c) を「対象」と言い切れます。");
}
console.log("");

/* ---------- 市町村ごとの確定率 ---------- */
console.log("  ■ 区域判定が必要な市町村");
console.log("");
console.log("    " + 幅("市町村", 16) + 幅("大字", 8) + 幅("(b)", 8) + 幅("(c)", 8) + 幅("要確認", 8) + "確定率");
const 対象 = d1.市町村.filter(区域必要);
const 全部出す = process.argv.indexOf("--all") >= 0;
let 全大字 = 0, 全要確認 = 0;
let 表示数 = 0;
対象.forEach((m) => {
  const a = 大字別[m.コード] || [];
  const c = (f) => a.filter(f).length;
  const 要 = c((o) => o.区域判定 === "要確認" || o.要確認理由);
  全大字 += a.length; 全要確認 += 要;
  const 率 = a.length ? Math.round((a.length - 要) / a.length * 1000) / 10 : 0;
  if (全部出す || 表示数 < 20) {
    console.log("    " + 幅(m.市町村名, 16) + 幅(a.length, 8) + 幅(c((o) => o.区域判定 === "b"), 8) +
      幅(c((o) => o.区域判定 === "c"), 8) + 幅(要, 8) + 率 + "%");
    表示数++;
  }
});
if (!全部出す && 対象.length > 20) console.log(`    …ほか ${対象.length - 20} 市町村（すべて見るには --all）`);
console.log("");
console.log(`    合計 ${全大字} 件のうち、確定 ${全大字 - 全要確認} 件 / 要確認 ${全要確認} 件` +
  (全大字 ? `（確定率 ${Math.round((全大字 - 全要確認) / 全大字 * 1000) / 10}%）` : ""));
console.log("");

/* ---------- 要確認の理由の内訳 ---------- */
const 要確認 = d2.大字.filter((o) => o.区域判定 === "要確認" || o.要確認理由);
if (要確認.length) {
  console.log("  ■ 要確認の理由");
  console.log("");
  const 内訳 = {};
  要確認.forEach((o) => {
    const k = String(o.要確認理由 || "理由が記録されていません")
      .replace(/[0-9]+m/g, "◯m").replace(/（[^）]*）/g, "");
    内訳[k] = (内訳[k] || 0) + 1;
  });
  Object.keys(内訳).sort((a, b) => 内訳[b] - 内訳[a]).forEach((k) => console.log(`    ${幅(内訳[k], 6)} ${k}`));
  console.log("");
  console.log("    これらは画面で「要確認」と表示され、総務省又は島根県への照会を促します。");
  console.log("    中間_大字と旧市町村.csv を手で直せば減らせます（直したら build-data.js を流し直してください）。");
  console.log("");
}

/* ---------- 突合方法の内訳（検算のため） ---------- */
const 確定 = d2.大字.filter((o) => !o.要確認理由 && o.区域判定 !== "要確認");
if (確定.length) {
  const 方法 = {};
  確定.forEach((o) => { const k = o.突合方法 || "記録なし"; 方法[k] = (方法[k] || 0) + 1; });
  console.log("  ■ 確定した大字の突合方法");
  console.log("");
  Object.keys(方法).forEach((k) => console.log(`    ${幅(方法[k], 6)} ${k}`));
  const 遠い = 確定.filter((o) => typeof o.突合距離m === "number" && o.突合距離m > 500);
  if (遠い.length) console.log(`\n    うち新旧の代表点が500m以上離れているもの: ${遠い.length} 件（目で確かめてください）`);
  console.log("");
}

/* ---------- 要確認一覧の書き出し ---------- */
if (process.argv.indexOf("--csv") >= 0 && 要確認.length) {
  const 名 = {};
  d1.市町村.forEach((m) => { 名[m.コード] = m.市町村名; });
  const 包む = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = "市町村コード,市町村名,大字町丁目コード,大字名,理由\n" +
    要確認.map((o) => [o.市町村コード, 名[o.市町村コード] || "", o.id, o.大字名, o.要確認理由 || ""].map(包む).join(",")).join("\n") + "\n";
  const 先 = path.join(root, "data", "source", "要確認一覧.csv");
  fs.writeFileSync(先, csv, "utf8");
  console.log(`  出力: chiiki/data/source/要確認一覧.csv（${要確認.length} 件）\n`);
}
