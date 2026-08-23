/* ===========================================================
   ビルドスクリプト
   chiiki/src と chiiki/data の中身を1つのHTMLにまとめます。

   使い方（開発者向け）:  node chiiki/tools/build.js

   出力:
     地域要件確認ツール.html        … 利用者に配るファイル（これ1つで動きます）
     chiiki/dist/artifact.html      … レビュー用（body の中身だけ）

   外部から読み込むファイルは作りません。庁内ネットワークで外部サイトが
   遮断されていても、また file:// で開いても動くようにするためです（仕様書 §6）。
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");        // chiiki/
const repo = path.resolve(root, "..");             // リポジトリ直下
const s = (...a) => path.join(root, "src", ...a);
const d = (...a) => path.join(root, "data", ...a);

/* データが壊れたまま配布しないよう、先に検査を通します */
try {
  execFileSync(process.execPath, [path.join(root, "tools", "check-data.js")], { stdio: "inherit" });
} catch (e) {
  console.error("  データ検査でエラーが出たため、ビルドを中止しました。");
  process.exit(1);
}

const html = fs.readFileSync(s("app.html"), "utf8");
const css = fs.readFileSync(s("app.css"), "utf8");
const judge = fs.readFileSync(s("judge.js"), "utf8");
const report = fs.readFileSync(s("report.js"), "utf8");
const app = fs.readFileSync(s("app.js"), "utf8");

/* JSON を <script> に埋めるので、</script> と行区切り文字だけ無害化します */
function 埋める(o) {
  return JSON.stringify(o)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const データ = {
  meta: JSON.parse(fs.readFileSync(d("meta.json"), "utf8")),
  d1: JSON.parse(fs.readFileSync(d("d1_municipalities.json"), "utf8")),
  d2: JSON.parse(fs.readFileSync(d("d2_oaza.json"), "utf8")),
  d3: JSON.parse(fs.readFileSync(d("d3_principles.json"), "utf8"))
};

/* 中身のないツールを配ってしまわないための歯止め。
   データを手で書かない設計なので、空のまま配布物ができるのは事故です。 */
if (データ.d1.市町村.length === 0) {
  console.error("  データが投入されていないため、配布物は作りませんでした。");
  console.error("  chiiki/data/source/README.md に従って原典を置き、");
  console.error("  node chiiki/tools/ingest/build-data.js を流してから、もう一度ビルドしてください。");
  console.error("  （画面だけ確認したい場合は --review を付けると chiiki/dist/artifact.html だけ作ります）");
  if (process.argv.indexOf("--review") < 0) process.exit(1);
  console.error("");
}

const wrap = (label, code) => `<script>\n/* ==== ${label} ==== */\n${code}\n</script>`;

const out = html
  .replace("<!--[[CSS]]-->", `<style>\n${css}\n</style>`)
  .replace("<!--[[DATA]]-->", wrap("データ（市町村マスタ・大字テーブル・確認表）", `window.__DATA__=${埋める(データ)};`))
  .replace("<!--[[JUDGE]]-->", wrap("判定エンジン", judge))
  .replace("<!--[[REPORT]]-->", wrap("根拠テキスト", report))
  .replace("<!--[[APP]]-->", wrap("画面の動き", app));

if (データ.d1.市町村.length > 0) {
  const 配布物 = path.join(repo, "地域要件確認ツール.html");
  fs.writeFileSync(配布物, out, "utf8");
  console.log(`  出力: 地域要件確認ツール.html (${(Buffer.byteLength(out) / 1024).toFixed(0)} KB)`);
}

/* --- レビュー用（Artifact は <body> の中身だけを受け取る） --- */
const bodyOnly = out.slice(out.indexOf("<body>") + 6, out.lastIndexOf("</body>"));
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist", "artifact.html"), `<style>\n${css}\n</style>\n` + bodyOnly, "utf8");
console.log("  出力: chiiki/dist/artifact.html（レビュー用）\n");
