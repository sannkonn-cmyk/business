/* ===========================================================
   位置参照情報（大字・町丁目レベル）の CSV を読む

   国土交通省の配布ファイルは Shift_JIS ですが、UTF-8 に変換された
   ものでも読めるようにしてあります。年度によって列の並びや有無が
   変わるため、位置ではなく見出しの名前で拾います。
   =========================================================== */
"use strict";

const fs = require("fs");

/* Shift_JIS か UTF-8 かを中身から見分けます。
   UTF-8 として復号したときに置換文字が出れば Shift_JIS とみなします。 */
function 復号(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buf.subarray(3));
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (utf8.indexOf("�") < 0) return utf8;
  return new TextDecoder("shift_jis").decode(buf);
}

/* 引用符つき CSV を1行ずつに分けます（改行を含むセルにも耐えます） */
function CSVを分ける(text) {
  const 行 = [];
  let 欄 = [], 今 = "", 引用中 = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (引用中) {
      if (c === '"') {
        if (text[i + 1] === '"') { 今 += '"'; i++; }
        else 引用中 = false;
      } else 今 += c;
      continue;
    }
    if (c === '"') { 引用中 = true; continue; }
    if (c === ",") { 欄.push(今); 今 = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      欄.push(今); 今 = "";
      if (欄.length > 1 || 欄[0] !== "") 行.push(欄);
      欄 = [];
      continue;
    }
    今 += c;
  }
  欄.push(今);
  if (欄.length > 1 || 欄[0] !== "") 行.push(欄);
  return 行;
}

/* 年度によって見出しの言い回しが違うので、ゆるく当てます */
const 見出しの別名 = {
  都道府県コード: ["都道府県コード"],
  都道府県名: ["都道府県名"],
  市町村コード: ["市区町村コード", "市町村コード"],
  市町村名: ["市区町村名", "市町村名"],
  大字コード: ["大字町丁目コード", "大字・町丁目コード", "大字町丁目名コード"],
  大字名: ["大字町丁目名", "大字・町丁目名"],
  緯度: ["緯度"],
  経度: ["経度"]
};

function 見出しを当てる(見出し行) {
  const 位置 = {};
  const 正規化 = 見出し行.map((h) => h.replace(/^﻿/, "").trim());
  Object.keys(見出しの別名).forEach((key) => {
    for (const 別名 of 見出しの別名[key]) {
      const i = 正規化.indexOf(別名);
      if (i >= 0) { 位置[key] = i; return; }
    }
  });
  return 位置;
}

/**
 * 位置参照情報CSVを読み、扱いやすい形の配列にして返します。
 * @param {string} ファイル
 * @returns {{rows: Array, 位置: Object, 欠けている列: string[]}}
 */
function read(ファイル) {
  const 行 = CSVを分ける(復号(fs.readFileSync(ファイル)));
  if (!行.length) return { rows: [], 位置: {}, 欠けている列: Object.keys(見出しの別名) };

  const 位置 = 見出しを当てる(行[0]);
  const 必須 = ["都道府県名", "市町村コード", "市町村名", "大字名", "緯度", "経度"];
  const 欠けている列 = 必須.filter((k) => 位置[k] === undefined);

  const rows = [];
  for (let i = 1; i < 行.length; i++) {
    const r = 行[i];
    const 取 = (k) => (位置[k] === undefined ? "" : (r[位置[k]] || "").trim());
    const 緯度 = parseFloat(取("緯度")), 経度 = parseFloat(取("経度"));
    const 市町村コード = 取("市町村コード");
    if (!市町村コード) continue;
    rows.push({
      都道府県名: 取("都道府県名"),
      市町村コード: 市町村コード,
      市町村名: 取("市町村名"),
      大字コード: 取("大字コード"),
      大字名: 取("大字名"),
      緯度: isNaN(緯度) ? null : 緯度,
      経度: isNaN(経度) ? null : 経度
    });
  }
  return { rows, 位置, 欠けている列 };
}

module.exports = { read, 復号, CSVを分ける };

/* 単体でも動かせます:  node chiiki/tools/ingest/read-isj.js <CSV> */
if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error("使い方: node chiiki/tools/ingest/read-isj.js <位置参照情報のCSV>"); process.exit(1); }
  const { rows, 欠けている列 } = read(f);
  if (欠けている列.length) console.error("  読めなかった列: " + 欠けている列.join("・"));
  const 市 = new Map();
  rows.forEach((r) => 市.set(r.市町村コード, (市.get(r.市町村コード) || 0) + 1));
  console.log(`  ${rows.length.toLocaleString()} 件 / ${市.size} 市町村`);
  [...市.entries()].slice(0, 10).forEach(([c, n]) => {
    console.log(`    ${c} ${(rows.find((r) => r.市町村コード === c) || {}).市町村名} : ${n} 件`);
  });
  if (市.size > 10) console.log(`    …ほか ${市.size - 10} 市町村`);
}
