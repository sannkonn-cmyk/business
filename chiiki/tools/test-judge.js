/* ===========================================================
   判定エンジンの単体テスト
   使い方:  node chiiki/tools/test-judge.js
   仕様書 §3-1 のフローの全分岐と、§3-2 の例外ルートを網羅します。
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const Judge = require(path.join(root, "src", "judge.js"));
const Report = require(path.join(root, "src", "report.js"));

const j = (f) => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const data = { meta: j("meta.json"), d1: j("d1_municipalities.json"), d2: j("d2_oaza.json"), d3: j("d3_principles.json") };

let 通過 = 0, 失敗 = 0;
function t(名, input, 期待) {
  const r = Judge.judge(input, data);
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

console.log("\n[ステップ② 市町村だけで結論が出る分岐]");
t("全部条件不利地域(a) → 対象外",            { cityCode: "32209" }, { result: "対象外", route: "市町村判定", symbol: "×" });
t("全部条件不利地域(a)・離島 → 対象外",       { cityCode: "32525" }, { result: "対象外", route: "市町村判定", symbol: "×" });
t("都市地域（3大都市圏） → 対象",             { cityCode: "13101" }, { result: "対象",   route: "市町村判定", symbol: "○", 三大都市圏: true });
t("指定都市（条件不利地域を含まない） → 対象", { cityCode: "27100" }, { result: "対象",   route: "市町村判定", symbol: "○", 区分キー: "指定都市_含まない" });

console.log("\n[ステップ③ 区域(b/c)まで見る分岐]");
t("一部条件不利 × 区域(b) → 対象外",          { cityCode: "32201", oazaId: "32201-11" }, { result: "対象外", route: "区域判定", symbol: "△", 区域判定: "b" });
t("一部条件不利 × 区域(c) → 対象",            { cityCode: "32201", oazaId: "32201-01" }, { result: "対象",   route: "区域判定", symbol: "△", 区域判定: "c" });
t("一部条件不利 × 境界跨ぎ → 要確認",         { cityCode: "32201", oazaId: "32201-18" }, { result: "要確認", route: "区域判定" });
t("一部条件不利 × 区域指定が未確認 → 要確認", { cityCode: "32203", oazaId: "32203-16" }, { result: "要確認", route: "区域判定" });
t("指定都市（条件不利地域を含む）× (b) → 対象外", { cityCode: "34100", oazaId: "34100-03" }, { result: "対象外", 区分キー: "指定都市_含む", 区域判定: "b" });
t("指定都市（条件不利地域を含む）× (c) → 対象",   { cityCode: "34100", oazaId: "34100-01" }, { result: "対象",   区分キー: "指定都市_含む", 区域判定: "c" });
t("旧『市』が区域として現れる（尾道市→旧因島市）", { cityCode: "34205", oazaId: "34205-03" }, { result: "対象外", 区域判定: "b" });

console.log("\n[入力が足りないとき]");
t("市町村が未選択",                    {},                     { result: "入力待ち", 不足: "市町村" });
t("△の市町村で大字が未選択",           { cityCode: "32201" },  { result: "入力待ち", 不足: "大字" });
t("収録のない市町村コード",             { cityCode: "99999" },  { result: "要確認" });
t("他市町村の大字を渡した（不整合）",   { cityCode: "32201", oazaId: "32203-01" }, { result: "要確認" });

console.log("\n[例外ルート（仕様書 §3-2）]");
t("隊員経験者 → 住所によらず対象",   { exceptions: { 隊員経験者: true } }, { result: "対象", route: "例外" });
t("海外在留 → 住所によらず対象",     { exceptions: { 海外在留: true } },   { result: "対象", route: "例外" });
t("JET終了者 → 住所によらず対象",    { exceptions: { JET終了者: true } },  { result: "対象", route: "例外" });
t("例外は市町村判定より優先される（雲南市＋例外）", { cityCode: "32209", exceptions: { 隊員経験者: true } }, { result: "対象", route: "例外" });

console.log("\n[人口減少率例外（仕様書 §4-2）]");
{
  const data2 = JSON.parse(JSON.stringify(data));
  const 千代田 = data2.d1.市町村.find((m) => m.コード === "13101");
  千代田.人口減少率例外 = true;
  const r = Judge.judge({ cityCode: "13101" }, data2);
  const ok = r.三大都市圏 === false && r.原則 === data.d3.対応["圏外|都市地域"].原則;
  if (ok) { 通過++; console.log("  ok   人口減少率11%以上の団体は3大都市圏外として扱う"); }
  else { 失敗++; console.log("  NG   人口減少率例外: 三大都市圏=" + r.三大都市圏 + " 原則=" + r.原則); }
}

console.log("\n[データ鮮度の警告]");
{
  const 未来 = new Date("2030-01-01");
  const r = Judge.judge({ cityCode: "32209" }, data, 未来);
  const ok = r.warnings.some((w) => w.indexOf("基準日") >= 0);
  if (ok) { 通過++; console.log("  ok   基準日から年数が経つと警告が出る"); }
  else { 失敗++; console.log("  NG   鮮度警告が出ない: " + JSON.stringify(r.warnings)); }
}

console.log("\n[根拠テキスト]");
{
  const r = Judge.judge({ cityCode: "32201", oazaId: "32201-01" }, data);
  const txt = Report.build(r, data, new Date("2026-08-23T14:05:00"));
  const 必須 = ["【地域おこし協力隊 地域要件 判定結果】", "■ 判定", "■ 転入地", "■ 転出地", "■ 適用した原則",
                "■ 出典", "■ データ基準日", "■ 判定実行日時", "本判定は参考資料です",
                "条件不利区域(b) に該当しない ＝ (c)", "CC BY-SA 4.0", "決裁資料に用いないでください"];
  const 欠け = 必須.filter((s) => txt.indexOf(s) < 0);
  if (欠け.length === 0) { 通過++; console.log("  ok   仕様書 §5-2 の項目がすべて出ている"); }
  else { 失敗++; console.log("  NG   欠けている項目: " + JSON.stringify(欠け)); }

  const data3 = JSON.parse(JSON.stringify(data));
  data3.meta.dataStatus = "verified";
  const txt3 = Report.build(Judge.judge({ cityCode: "32201", oazaId: "32201-01" }, data3), data3);
  if (txt3.indexOf("決裁資料に用いないでください") < 0) { 通過++; console.log("  ok   dataStatus を verified にすると暫定警告が消える"); }
  else { 失敗++; console.log("  NG   verified にしても暫定警告が残る"); }
}

console.log("\n" + (失敗 === 0 ? "すべて通過" : "失敗あり") + "：通過 " + 通過 + " / 失敗 " + 失敗 + "\n");
process.exit(失敗 === 0 ? 0 : 1);
