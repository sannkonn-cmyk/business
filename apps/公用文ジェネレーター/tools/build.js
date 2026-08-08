/* ===========================================================
   ビルドスクリプト
   src/ と vendor/ と template/ の中身を1つのHTMLにまとめます。

   使い方（開発者向け）:  node tools/build.js

   出力:
     公用文ジェネレーター.html   … 利用者に配るファイル（これ1つで動きます）
     dist/artifact.html          … レビュー用（body の中身だけ）
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const p = (...a) => path.join(root, ...a);

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

const html = fs.readFileSync(p("src", "app.html"), "utf8");
const css = fs.readFileSync(p("src", "app.css"), "utf8");
const app = fs.readFileSync(p("src", "app.js"), "utf8");
const docx = readIfExists(p("src", "docx.js"));
const vendor = readIfExists(p("vendor", "jszip.min.js"));

// ひな形 docx を base64 で埋め込む（file:// で開いても fetch 不要にするため）
const tmplPath = p("template", "例文.docx");
let tmplTag = "<!-- ひな形は未同梱です -->";
if (fs.existsSync(tmplPath)) {
  const b64 = fs.readFileSync(tmplPath).toString("base64");
  tmplTag = `<script>window.__TEMPLATE_B64__=${JSON.stringify(b64)};</script>`;
  console.log(`  ひな形: 例文.docx (${(b64.length / 1024).toFixed(0)} KB as base64)`);
} else {
  console.log("  ひな形: 見つかりません（template/例文.docx）");
}

const wrap = (label, code) =>
  code ? `<script>\n/* ==== ${label} ==== */\n${code}\n</script>` : `<!-- ${label} なし -->`;

const out = html
  .replace("<!--[[CSS]]-->", `<style>\n${css}\n</style>`)
  .replace("<!--[[VENDOR]]-->", wrap("JSZip 3.10.1 (MIT)", vendor))
  .replace("<!--[[TEMPLATE]]-->", tmplTag)
  .replace("<!--[[DOCX]]-->", wrap("Word 出力", docx))
  .replace("<!--[[APP]]-->", wrap("画面の動き", app));

fs.writeFileSync(p("公用文ジェネレーター.html"), out, "utf8");
console.log(`  出力: 公用文ジェネレーター.html (${(Buffer.byteLength(out) / 1024).toFixed(0)} KB)`);

// --- レビュー用（Artifact は <body> の中身だけを受け取る） ---
const bodyOnly = out.slice(out.indexOf("<body>") + 6, out.lastIndexOf("</body>"));
const styleOnly = `<style>\n${css}\n</style>\n`;
fs.mkdirSync(p("dist"), { recursive: true });
fs.writeFileSync(p("dist", "artifact.html"), styleOnly + bodyOnly, "utf8");
console.log("  出力: dist/artifact.html（レビュー用）");
