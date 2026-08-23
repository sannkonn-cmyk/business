/* ===========================================================
   取り込みの通し（中間CSV → JSON → 判定）のテスト
   使い方:  node chiiki/tools/test-pipeline.js

   合成データで、原典を読んだあとの工程をひととおり流します。
   実データで思ったとおりに動かないとき、取り込みの仕組み自体が
   壊れているのか、データの側の問題なのかを切り分けるためのものです。
   実在の市町村は使いません。
   =========================================================== */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const 本体 = path.resolve(__dirname, "..");
const 前 = require(path.join(本体, "tools", "ingest", "match-by-prefix.js"));
const Judge = require(path.join(本体, "src", "judge.js"));
const Report = require(path.join(本体, "src", "report.js"));

let 通過 = 0, 失敗 = 0;
const 真 = (名, 条件, 補足) => {
  if (条件) { 通過++; console.log("  ok   " + 名); }
  else { 失敗++; console.log("  NG   " + 名 + (補足 ? "：" + 補足 : "")); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chiiki-pipeline-"));
fs.mkdirSync(path.join(tmp, "data", "source"), { recursive: true });
["d1_municipalities.json", "d2_oaza.json", "d3_principles.json", "meta.json"].forEach((f) => {
  fs.copyFileSync(path.join(本体, "data", f), path.join(tmp, "data", f));
});
/* 空の器から始めます */
["d1_municipalities.json", "d2_oaza.json"].forEach((f) => {
  const o = JSON.parse(fs.readFileSync(path.join(tmp, "data", f), "utf8"));
  o.市町村 = o.市町村 ? [] : undefined;
  o.大字 = o.大字 ? [] : undefined;
  fs.writeFileSync(path.join(tmp, "data", f), JSON.stringify(o, null, 2), "utf8");
});
const S = (f) => path.join(tmp, "data", "source", f);
const D = (f) => JSON.parse(fs.readFileSync(path.join(tmp, "data", f), "utf8"));
const 環境 = Object.assign({}, process.env, { CHIIKI_DATA_ROOT: tmp });
const 走らせる = (名, ...引数) =>
  execFileSync(process.execPath, [path.join(本体, "tools", "ingest", 名), ...引数], { env: 環境, stdio: "pipe" }).toString();

/* ---------- 合成データ ----------
   架空県に、合併でできた「丁市」（旧丁市＋旧甲原村）と、
   合併していない「甲市」「丑市」があるという想定です。 */
const 過疎一覧 = [
  { 都道府県名: "架空県", 市町村名: "甲市", 過疎区分: "全部過疎", みなされる区域: "", 旧法下の区分: "全部過疎" },
  { 都道府県名: "架空県", 市町村名: "丁市", 過疎区分: "一部過疎", みなされる区域: "甲原村", 旧法下の区分: "一部過疎" }
];
const isj = [
  { 都道府県名: "架空県", 市町村コード: "99201", 市町村名: "甲市", 大字コード: "992010001000", 大字名: "甲町",       緯度: 34.0, 経度: 133.0 },
  { 都道府県名: "架空県", 市町村コード: "99204", 市町村名: "丁市", 大字コード: "992040001000", 大字名: "本町",       緯度: 35.0, 経度: 133.0 },
  { 都道府県名: "架空県", 市町村コード: "99204", 市町村名: "丁市", 大字コード: "992040002000", 大字名: "甲原町日吉", 緯度: 35.1, 経度: 133.0 },
  { 都道府県名: "架空県", 市町村コード: "99601", 市町村名: "丑市", 大字コード: "996010001000", 大字名: "丑町",       緯度: 39.0, 経度: 133.0 }
];

fs.writeFileSync(S("中間_過疎一覧.csv"),
  "都道府県名,市町村名,過疎区分,みなされる区域,旧法下の区分\n" +
  過疎一覧.map((r) => [r.都道府県名, r.市町村名, r.過疎区分, r.みなされる区域, r.旧法下の区分].join(",")).join("\n") + "\n");

/* 地域要件確認表から作られる形の市町村区分 */
fs.writeFileSync(S("中間_市町村区分.csv"),
  "市町村コード,都道府県名,市町村名,区分,指定都市区分,該当法令,照合済み法令,三大都市圏,人口減少率例外,区域の旧市町村,備考\n" +
  "99201,架空県,甲市,全部条件不利地域,該当なし,,,0,0,,地域要件確認表による\n" +
  "99204,架空県,丁市,一部条件不利地域,該当なし,過疎|山村|離島|半島,,0,0,過疎:甲原村,地域要件確認表による\n" +
  "99601,架空県,丑市,都市地域,該当なし,,,0,0,,地域要件確認表による\n");

fs.writeFileSync(S("取得記録.json"), JSON.stringify({
  基準日: "架空4年4月1日", 収録法令: ["過疎"],
  資料: [{ 名称: "架空の地域要件確認表", url: "", 現在日: "架空4年4月1日", 取得日: "2026-08-23" }]
}, null, 2));

/* ---------- ① 接頭辞照合 ---------- */
console.log("\n[① 接頭辞で旧市町村を当てる]");
const { rows: 突合 } = 前.match(過疎一覧, isj);
fs.writeFileSync(S("中間_大字と区域.csv"), 前.CSVにする(突合));
const 引 = (c) => 突合.find((r) => r.大字町丁目コード === c);
真("頭に村名が付いた大字 → 過疎(b)", 引("992040002000").過疎 === "b" && 引("992040002000").旧市町村名 === "旧甲原村",
   JSON.stringify(引("992040002000")));
真("当たらない大字 → 過疎(c)", 引("992040001000").過疎 === "c");
真("全部過疎の市町村は大字を出さない", !引("992010001000"));

/* ---------- ② JSON を作る（過疎の一覧だけ投入した状態） ----------
   市町村区分は地域要件確認表から作ります（read_kakuninhyou_pdf.py）。
   一覧しか無い場合の build-municipalities.js は、単体テストの側で確かめています。 */
console.log("\n[② JSON を作る —— 過疎の一覧だけ投入した場合]");
走らせる("build-data.js");
let d1 = D("d1_municipalities.json"), d2 = D("d2_oaza.json"), meta = D("meta.json");

真("D1 が3件できた", d1.市町村.length === 3, String(d1.市町村.length));
真("照合済み法令が取得記録から入る", JSON.stringify(d1.市町村.find((m) => m.コード === "99204").照合済み法令) === '["過疎"]');
真("D2 は区域判定が要る丁市のぶんだけ", d2.大字.length === 2 && d2.大字.every((o) => o.市町村コード === "99204"), String(d2.大字.length));
真("区域(b) は法令が1つでも言える", (d2.大字.find((o) => o.大字名 === "甲原町日吉") || {}).区域判定 === "b");
真("区域(c) は法令が揃わないと言えない",
   (d2.大字.find((o) => o.大字名 === "本町") || {}).区域判定 === "要確認",
   JSON.stringify(d2.大字.find((o) => o.大字名 === "本町")));
真("足りない法令が理由に書かれる",
   ((d2.大字.find((o) => o.大字名 === "本町") || {}).要確認理由 || "").indexOf("山村") >= 0);
真("山村等が未投入なので provisional", meta.dataStatus === "provisional", meta.dataStatus);

let データ = { meta, d1, d2, d3: D("d3_principles.json") };
真("判定：全部条件不利 → 対象外", Judge.judge({ cityCode: "99201" }, データ).result === "対象外");
真("判定：都市地域 → 対象", Judge.judge({ cityCode: "99601" }, データ).result === "対象");
真("判定：区域(b) → 対象外", Judge.judge({ cityCode: "99204", oazaId: "992040002000" }, データ).result === "対象外");
真("判定：法令不足の(c) → 要確認", Judge.judge({ cityCode: "99204", oazaId: "992040001000" }, データ).result === "要確認");
{
  const r = Judge.judge({ cityCode: "99204", oazaId: "992040002000" }, データ);
  const txt = Report.build(r, データ);
  真("根拠テキストに旧市町村が出る", txt.indexOf("旧甲原村") >= 0);
  真("根拠テキストに暫定の警告が出る", txt.indexOf("決裁資料に用いないでください") >= 0);
}
execFileSync(process.execPath, [path.join(本体, "tools", "check-data.js")], { env: 環境, stdio: "pipe" });
真("check-data がエラーなしで通る", true);

/* ---------- ③ 4法令すべてを投入した場合 ---------- */
console.log("\n[③ 4法令すべてを投入した場合]");
fs.writeFileSync(S("取得記録.json"), JSON.stringify({
  基準日: "架空4年4月1日", 収録法令: ["過疎", "山村", "離島", "半島"],
  資料: [{ 名称: "架空の地域要件確認表", url: "", 現在日: "架空4年4月1日", 取得日: "2026-08-23" }]
}, null, 2));
/* 山村・離島・半島も判定済みにする（本来は add-polygon-laws.js が埋めます） */
{
  const 行 = 突合.map((r) => Object.assign({}, r, { 山村: "c", 離島: "c", 半島: "c" }));
  行.forEach((r) => { if (r.過疎 === "b") { r.山村 = "c"; r.離島 = "c"; r.半島 = "c"; } });
  fs.writeFileSync(S("中間_大字と区域.csv"), 前.CSVにする(行));
}
走らせる("build-data.js");
d1 = D("d1_municipalities.json"); d2 = D("d2_oaza.json"); meta = D("meta.json");
データ = { meta, d1, d2, d3: D("d3_principles.json") };
真("4法令が揃うと verified になる", meta.dataStatus === "verified", meta.dataStatus);
真("同じ大字が (c) に確定する", (d2.大字.find((o) => o.大字名 === "本町") || {}).区域判定 === "c");
真("判定：(c) → 対象", Judge.judge({ cityCode: "99204", oazaId: "992040001000" }, データ).result === "対象");
{
  const txt = Report.build(Judge.judge({ cityCode: "99204", oazaId: "992040001000" }, データ), データ);
  真("暫定の警告が消える", txt.indexOf("決裁資料に用いないでください") < 0);
}
execFileSync(process.execPath, [path.join(本体, "tools", "ingest", "report-coverage.js")], { env: 環境, stdio: "pipe" });
真("report-coverage が動く", true);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("\n" + (失敗 === 0 ? "すべて通過" : "失敗あり") + "：通過 " + 通過 + " / 失敗 " + 失敗 + "\n");
process.exit(失敗 === 0 ? 0 : 1);
