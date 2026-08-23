/* ===========================================================
   判定エンジンの単体テスト
   使い方:  node chiiki/tools/test-judge.js

   仕様書 §3-1 のフローの全分岐と、§3-2 の例外ルートを網羅します。

   テストは chiiki/tools/fixtures/data.json の【架空データ】で行います。
   実在の市町村を使うと、実データの誤りとテストの期待値が混ざり、
   どちらを直せばよいのかが分からなくなるためです。
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const Judge = require(path.join(root, "src", "judge.js"));
const Report = require(path.join(root, "src", "report.js"));

const 素 = fs.readFileSync(path.join(__dirname, "fixtures", "data.json"), "utf8");
const 新しいデータ = () => JSON.parse(素);
const data = 新しいデータ();

let 通過 = 0, 失敗 = 0;
function t(名, input, 期待, データ) {
  const r = Judge.judge(input, データ || data);
  const ok = Object.keys(期待).every((k) => r[k] === 期待[k]);
  if (ok) { 通過++; console.log("  ok   " + 名); }
  else {
    失敗++;
    console.log("  NG   " + 名);
    Object.keys(期待).forEach((k) => {
      if (r[k] !== 期待[k]) console.log("         " + k + ": 期待 " + JSON.stringify(期待[k]) + " / 実際 " + JSON.stringify(r[k]));
    });
  }
  return r;
}
function 真(名, 条件, 補足) {
  if (条件) { 通過++; console.log("  ok   " + 名); }
  else { 失敗++; console.log("  NG   " + 名 + (補足 ? "：" + 補足 : "")); }
}

console.log("\n[ステップ② 市町村だけで結論が出る分岐]");
t("全部条件不利地域(a) → 対象外",             { cityCode: "99201" }, { result: "対象外", route: "市町村判定", symbol: "×" });
t("都市地域（3大都市圏） → 対象",              { cityCode: "99202" }, { result: "対象",   route: "市町村判定", symbol: "○", 三大都市圏: true });
t("指定都市（条件不利地域を含まない） → 対象", { cityCode: "99203" }, { result: "対象",   route: "市町村判定", symbol: "○", 区分キー: "指定都市_含まない" });

console.log("\n[ステップ③ 区域(b/c)まで見る分岐]");
t("一部条件不利 × 区域(b) → 対象外",           { cityCode: "99204", oazaId: "99204001" }, { result: "対象外", route: "区域判定", symbol: "△", 区域判定: "b" });
t("一部条件不利 × 区域(c) → 対象",             { cityCode: "99204", oazaId: "99204002" }, { result: "対象",   route: "区域判定", symbol: "△", 区域判定: "c" });
t("突合できなかった大字 → 要確認",             { cityCode: "99204", oazaId: "99204003" }, { result: "要確認", route: "区域判定" });
t("指定都市（含む）× (b) → 対象外",            { cityCode: "99205", oazaId: "99205002" }, { result: "対象外", 区分キー: "指定都市_含む", 区域判定: "b" });
t("指定都市（含む）× (c) → 対象",              { cityCode: "99205", oazaId: "99205001" }, { result: "対象",   区分キー: "指定都市_含む", 区域判定: "c" });

console.log("\n[法令の網羅性 —— (c) は全法令が揃わないと言えない]");
t("法令が欠けていても (b) は言える",           { cityCode: "99206", oazaId: "99206001" }, { result: "対象外", 区域判定: "b" });
{
  const r = t("法令が欠けていると (c) は要確認に落ちる", { cityCode: "99206", oazaId: "99206002" }, { result: "要確認", 区域判定: "c" });
  真("欠けている法令が名指しされる", (r.未照合法令 || []).join("・") === "山村・離島", JSON.stringify(r.未照合法令));
  真("根拠テキストにも欠落が出る", Report.build(r, data).indexOf("山村・離島") >= 0);
}
{
  const d = 新しいデータ();
  d.d1.市町村.find((m) => m.コード === "99206").照合済み法令 = ["過疎", "山村", "離島"];
  t("法令が揃えば同じ大字が (c) → 対象", { cityCode: "99206", oazaId: "99206002" }, { result: "対象", 区域判定: "c" }, d);
}
真("奄美・小笠原・沖縄は区域レベルの法令に含めない",
   Judge.区域レベルの法令.join("・") === "過疎・山村・離島・半島");

console.log("\n[市町村の区分が確定していないとき]");
{
  const r = t("一覧が足りない市町村 → 要確認", { cityCode: "99209" }, { result: "要確認", route: "市町村判定" });
  真("足りない一覧が名指しされる", (r.未照合法令 || []).join("・") === "山村・離島・半島", JSON.stringify(r.未照合法令));
  真("根拠テキストにも足りない一覧が出る", Report.build(r, data).indexOf("山村・離島・半島") >= 0);
  真("未確定でも大字を聞きに行かない", r.不足 === null);
}

console.log("\n[入力が足りないとき・データがないとき]");
t("市町村が未選択",                    {},                     { result: "入力待ち", 不足: "市町村" });
t("△の市町村で大字が未選択",           { cityCode: "99204" },  { result: "入力待ち", 不足: "大字" });
t("収録のない市町村コード",             { cityCode: "00000" },  { result: "要確認" });
t("他市町村の大字を渡した（不整合）",   { cityCode: "99204", oazaId: "99205001" }, { result: "要確認" });
t("一部条件不利なのに大字が0件",        { cityCode: "99207" },  { result: "要確認", route: "区域判定" });
{
  const 空 = 新しいデータ();
  空.d1.市町村 = []; 空.d2.大字 = [];
  const r = Judge.judge({ cityCode: "99204" }, 空);
  真("データが空でも例外を投げない", r.result === "要確認");
  真("例外ルートはデータが空でも通る", Judge.judge({ exceptions: { 海外在留: true } }, 空).result === "対象");
}

console.log("\n[例外ルート（仕様書 §3-2）]");
t("隊員経験者 → 住所によらず対象",   { exceptions: { 隊員経験者: true } }, { result: "対象", route: "例外" });
t("海外在留 → 住所によらず対象",     { exceptions: { 海外在留: true } },   { result: "対象", route: "例外" });
t("JET終了者 → 住所によらず対象",    { exceptions: { JET終了者: true } },  { result: "対象", route: "例外" });
t("例外は市町村判定より優先される",  { cityCode: "99201", exceptions: { 隊員経験者: true } }, { result: "対象", route: "例外" });

console.log("\n[人口減少率例外（仕様書 §4-2）]");
{
  const r = Judge.judge({ cityCode: "99208" }, data);
  真("人口減少率11%以上の団体は3大都市圏外として扱う",
     r.三大都市圏 === false && r.原則 === data.d3.対応["圏外|都市地域"].原則,
     "三大都市圏=" + r.三大都市圏 + " 原則=" + r.原則);
}

console.log("\n[データ鮮度の警告]");
{
  const r = Judge.judge({ cityCode: "99201" }, data, new Date("2040-01-01"));
  真("基準日から年数が経つと警告が出る", r.warnings.some((w) => w.indexOf("基準日") >= 0));
}

console.log("\n[根拠テキスト（仕様書 §5-2）]");
{
  const r = Judge.judge({ cityCode: "99204", oazaId: "99204002" }, data);
  const txt = Report.build(r, data, new Date("2026-08-23T14:05:00"));
  const 必須 = ["【地域おこし協力隊 地域要件 判定結果】", "■ 判定", "■ 転入地", "■ 転出地", "■ 適用した原則",
                "■ 出典", "■ データ基準日", "■ 判定実行日時", "参考資料",
                "条件不利区域(b) に該当しない ＝ (c)"];
  const 欠け = 必須.filter((s) => txt.indexOf(s) < 0);
  真("仕様書 §5-2 の項目がすべて出ている", 欠け.length === 0, JSON.stringify(欠け));
  真("照合済みデータでは暫定警告が出ない", txt.indexOf("決裁資料に用いないでください") < 0);

  const d = 新しいデータ();
  d.meta.dataStatus = "provisional";
  const txt2 = Report.build(Judge.judge({ cityCode: "99204", oazaId: "99204002" }, d), d);
  真("dataStatus を provisional にすると暫定警告が出る", txt2.indexOf("決裁資料に用いないでください") >= 0);

  const rb = Judge.judge({ cityCode: "99204", oazaId: "99204001" }, data);
  真("(b) のときは説明文が (b) 用に切り替わる", rb.原則説明.indexOf("条件不利区域(b)から") >= 0, rb.原則説明);
  真("(c) のときは説明文が (c) 用に切り替わる", r.原則説明.indexOf("うち(c)から") >= 0, r.原則説明);
}

console.log("\n" + (失敗 === 0 ? "すべて通過" : "失敗あり") + "：通過 " + 通過 + " / 失敗 " + 失敗 + "\n");
process.exit(失敗 === 0 ? 0 : 1);
