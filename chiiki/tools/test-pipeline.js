/* ===========================================================
   取り込みの通し（原典CSV → 中間CSV → JSON → 判定）のテスト
   使い方:  node chiiki/tools/test-pipeline.js

   合成した位置参照情報から JSON を作り、判定エンジンにかけるところまでを
   ひととおり流します。実データが届いたとき、途中のどこが壊れているのかを
   切り分けられるようにするためのものです。実在の市町村は使いません。
   =========================================================== */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const 本体 = path.resolve(__dirname, "..");
const M = require(path.join(本体, "tools", "ingest", "match-oaza.js"));
const Judge = require(path.join(本体, "src", "judge.js"));

let 通過 = 0, 失敗 = 0;
const 真 = (名, 条件, 補足) => {
  if (条件) { 通過++; console.log("  ok   " + 名); }
  else { 失敗++; console.log("  NG   " + 名 + (補足 ? "：" + 補足 : "")); }
};

/* ---------- 作業場所を用意する ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chiiki-pipeline-"));
fs.mkdirSync(path.join(tmp, "data", "source"), { recursive: true });
["d1_municipalities.json", "d2_oaza.json", "d3_principles.json", "meta.json"].forEach((f) => {
  fs.copyFileSync(path.join(本体, "data", f), path.join(tmp, "data", f));
});
const S = (f) => path.join(tmp, "data", "source", f);
const D = (f) => JSON.parse(fs.readFileSync(path.join(tmp, "data", f), "utf8"));
const 環境 = Object.assign({}, process.env, { CHIIKI_DATA_ROOT: tmp });

/* ---------- 合成した位置参照情報 ----------
   架空県に、合併でできた「丁市」（旧丁市＋旧甲原村）と、
   合併していない「甲市」があるという想定です。 */
const 位置参照 = (rows) =>
  '"都道府県コード","都道府県名","市区町村コード","市区町村名","大字町丁目コード","大字町丁目名","緯度","経度"\n' +
  rows.map((r) => '"99","架空県","' + r.join('","') + '"').join("\n") + "\n";

fs.writeFileSync(S("isj_99_最新.csv"), 位置参照([
  ["99204", "丁市", "99204001001", "本町",         "35.470", "133.050"],   // 旧丁市のまま
  ["99204", "丁市", "99204002001", "甲原町日吉",   "35.400", "133.050"],   // 合併で頭に村名が付いた
  ["99204", "丁市", "99204002002", "甲原町熊野",   "35.402", "133.052"],
  ["99204", "丁市", "99204003001", "新開町",       "35.4005", "133.0505"], // 名称は変わったが旧甲原村の近く
  ["99204", "丁市", "99204004001", "境目町",       "35.435", "133.050"],   // 旧市町村の境あたり
  ["99201", "甲市", "99201001001", "甲町",         "34.500", "132.000"]    // 合併していない市町村
]));
fs.writeFileSync(S("isj_99_旧.csv"), 位置参照([
  ["99204", "丁市",   "99204001001", "本町", "35.470", "133.050"],
  ["99341", "甲原村", "99341001001", "日吉", "35.400", "133.050"],
  ["99341", "甲原村", "99341001002", "熊野", "35.402", "133.052"],
  ["99201", "甲市",   "99201001001", "甲町", "34.500", "132.000"]
]));

/* ---------- ① 新旧の突合 ---------- */
console.log("\n[① 位置参照情報の新旧突合]");
const { read } = require(path.join(本体, "tools", "ingest", "read-isj.js"));
const 新 = read(S("isj_99_最新.csv")), 旧 = read(S("isj_99_旧.csv"));
真("最新年度版を読めた", 新.rows.length === 6 && !新.欠けている列.length, JSON.stringify(新.欠けている列));
真("旧年度版を読めた", 旧.rows.length === 4 && !旧.欠けている列.length);

const 突合 = M.match(新.rows, 旧.rows);
fs.writeFileSync(S("中間_大字と旧市町村.csv"), M.CSVにする(突合));
const 引 = (c) => 突合.find((r) => r.大字町丁目コード === c);
真("名称そのままの大字 → 旧丁市", 引("99204001001").旧市町村名 === "丁市" && !引("99204001001").要確認理由);
真("頭に村名が付いた大字 → 旧甲原村", 引("99204002001").旧市町村名 === "甲原村" && !引("99204002001").要確認理由,
   JSON.stringify(引("99204002001")));
真("名称が変わった大字 → 最近傍で旧甲原村", 引("99204003001").旧市町村名 === "甲原村" && 引("99204003001").突合方法 === "最近傍",
   JSON.stringify(引("99204003001")));
真("境あたりの大字 → 要確認", !!引("99204004001").要確認理由, JSON.stringify(引("99204004001")));

/* ---------- ② 中間CSV（法令の一覧は過疎だけ投入した状態） ---------- */
console.log("\n[② 中間CSVから JSON を作る —— まず過疎の一覧だけ投入した場合]");
fs.writeFileSync(S("中間_市町村区分.csv"),
  "市町村コード,都道府県名,市町村名,区分,指定都市区分,該当法令,三大都市圏,人口減少率例外\n" +
  "99204,架空県,丁市,一部条件不利地域,該当なし,過疎|山村,0,0\n" +
  "99201,架空県,甲市,全部条件不利地域,該当なし,過疎,0,0\n");
fs.writeFileSync(S("中間_区域指定.csv"),
  "市町村コード,旧市町村名,法令,出典,基準日\n" +
  "99204,旧甲原村,過疎,架空の過疎一覧,架空4年4月1日\n");
fs.writeFileSync(S("取得記録.json"), JSON.stringify({
  基準日: "架空4年4月1日",
  収録法令: ["過疎"],
  資料: [{ 名称: "架空の過疎地域一覧", url: "", 現在日: "架空4年4月1日", 取得日: "2026-08-23" }]
}, null, 2));

execFileSync(process.execPath, [path.join(本体, "tools", "ingest", "build-data.js")], { env: 環境, stdio: "pipe" });
let d1 = D("d1_municipalities.json"), d2 = D("d2_oaza.json"), meta = D("meta.json");

真("D1 が2件できた", d1.市町村.length === 2);
真("丁市の照合済み法令は過疎だけ", JSON.stringify(d1.市町村.find((m) => m.コード === "99204").照合済み法令) === '["過疎"]');
真("D2 は区域判定が要る丁市のぶんだけ", d2.大字.length === 5 && d2.大字.every((o) => o.市町村コード === "99204"), d2.大字.length + " 件");
真("旧甲原村の大字が (b) になった", d2.大字.filter((o) => o.区域判定 === "b").length === 3,
   JSON.stringify(d2.大字.map((o) => o.大字名 + ":" + o.区域判定)));
真("旧丁市の大字が (c) になった", (d2.大字.find((o) => o.大字名 === "本町") || {}).区域判定 === "c");
真("境あたりの大字は要確認のまま", (d2.大字.find((o) => o.大字名 === "境目町") || {}).区域判定 === "要確認");
真("(b) の大字に旧市町村名が入る", (d2.大字.find((o) => o.大字名 === "甲原町日吉") || {}).旧市町村名 === "旧甲原村");
真("山村が欠けているので provisional", meta.dataStatus === "provisional", meta.dataStatus);
真("収録範囲に架空県が入る", (meta.収録範囲.都道府県 || []).join() === "架空県");

const データ = { meta: meta, d1: d1, d2: d2, d3: D("d3_principles.json") };
{
  const b = Judge.judge({ cityCode: "99204", oazaId: "99204002001" }, データ);
  真("判定：区域(b) は対象外と言い切れる", b.result === "対象外", b.result);
  const c = Judge.judge({ cityCode: "99204", oazaId: "99204001001" }, データ);
  真("判定：山村の一覧がないので (c) は要確認", c.result === "要確認" && (c.未照合法令 || []).join() === "山村",
     c.result + " / " + JSON.stringify(c.未照合法令));
}
execFileSync(process.execPath, [path.join(本体, "tools", "check-data.js")], { env: 環境, stdio: "pipe" });
真("check-data がエラーなしで通る", true);

/* ---------- ③ 山村の一覧も投入した場合 ---------- */
console.log("\n[③ 山村の一覧も投入した場合]");
fs.writeFileSync(S("中間_区域指定.csv"),
  "市町村コード,旧市町村名,法令,出典,基準日\n" +
  "99204,旧甲原村,過疎,架空の過疎一覧,架空4年4月1日\n" +
  "99204,旧甲原村,山村,架空の振興山村一覧,架空4年4月1日\n");
fs.writeFileSync(S("取得記録.json"), JSON.stringify({
  基準日: "架空4年4月1日",
  収録法令: ["過疎", "山村"],
  資料: [{ 名称: "架空の過疎地域一覧", url: "", 現在日: "架空4年4月1日", 取得日: "2026-08-23" }]
}, null, 2));
execFileSync(process.execPath, [path.join(本体, "tools", "ingest", "build-data.js")], { env: 環境, stdio: "pipe" });
d1 = D("d1_municipalities.json"); d2 = D("d2_oaza.json"); meta = D("meta.json");

真("4法令のうち該当分が揃ったので verified", meta.dataStatus === "verified", meta.dataStatus);
真("(b) の大字に法令が2つ入る",
   JSON.stringify((d2.大字.find((o) => o.大字名 === "甲原町日吉") || {}).該当法令) === '["過疎","山村"]');
{
  const データ2 = { meta: meta, d1: d1, d2: d2, d3: D("d3_principles.json") };
  const c = Judge.judge({ cityCode: "99204", oazaId: "99204001001" }, データ2);
  真("判定：一覧が揃うと同じ大字が (c) → 対象", c.result === "対象", c.result);
}
execFileSync(process.execPath, [path.join(本体, "tools", "ingest", "report-coverage.js")], { env: 環境, stdio: "pipe" });
真("report-coverage が動く", true);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("\n" + (失敗 === 0 ? "すべて通過" : "失敗あり") + "：通過 " + 通過 + " / 失敗 " + 失敗 + "\n");
process.exit(失敗 === 0 ? 0 : 1);
