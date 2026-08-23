/* ===========================================================
   法令ポリゴンを大字に落とし込む

   国土数値情報のポリゴン（A17過疎 / A18半島 / A19離島 / A24振興山村）に
   位置参照情報の大字代表点を落とし、大字ごとに法令別の b / c を決めます。
   あわせて、市町村ごとに「全域指定 / 一部指定 / 非該当」を集計します。

   過疎だけは扱いが違います。**指定の現況は総務省一覧（令和4年4月1日現在）が決め**、
   ポリゴンは接頭辞で解けなかった市町村の地理を補うためだけに使います。
   国土数値情報の過疎地域データは2016年度基準で、令和3年の新法を反映していないためです。

   使い方:
     node chiiki/tools/ingest/add-polygon-laws.js [県コード]

   設定:
     chiiki/data/source/ポリゴン設定.json  … どのファイルをどの法令に使うか
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { readZip, read: readCSV, 復号, CSVを分ける } = require("./read-isj.js");
const geo = require("./read-geojson.js");
const pip = require("./point-in-polygon.js");

const root = process.env.CHIIKI_DATA_ROOT ? path.resolve(process.env.CHIIKI_DATA_ROOT) : path.resolve(__dirname, "..", "..");
const src = (f) => path.join(root, "data", "source", f);

const 法令 = ["過疎", "山村", "離島", "半島"];
const 大字見出し = ["大字町丁目コード", "市町村コード", "市町村名", "大字名", "緯度", "経度",
  "過疎", "山村", "離島", "半島", "旧市町村名", "決め方", "要確認理由"];
const 市町村見出し = ["市町村コード", "都道府県名", "市町村名", "区分", "指定都市区分", "該当法令",
  "三大都市圏", "人口減少率例外", "備考"];

/* 3大都市圏の11都府県（仕様書 §4-2）。
   埼玉11・千葉12・東京13・神奈川14・岐阜21・愛知23・三重24・京都26・大阪27・兵庫28・奈良29。
   ポリゴン設定.json の「三大都市圏の県コード」で上書きできます。 */
const 既定の三大都市圏 = ["11", "12", "13", "14", "21", "23", "24", "26", "27", "28", "29"];

const 包む = (v) => {
  const s = String(v === null || v === undefined ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const CSVにする = (見出し, rows) =>
  見出し.join(",") + "\n" + rows.map((r) => 見出し.map((h) => 包む(r[h])).join(",")).join("\n") + "\n";

function 表を読む(ファイル) {
  if (!fs.existsSync(ファイル)) return null;
  const 行 = CSVを分ける(復号(fs.readFileSync(ファイル)));
  if (!行.length) return [];
  const 見 = 行[0].map((h) => h.replace(/^﻿/, "").trim());
  return 行.slice(1).map((r) => {
    const o = {};
    見.forEach((h, i) => { o[h] = (r[i] || "").trim(); });
    return o;
  }).filter((o) => Object.keys(o).some((k) => o[k] !== ""));
}

async function main() {
  const 県 = process.argv[2];

  const 設定ファイル = src("ポリゴン設定.json");
  if (!fs.existsSync(設定ファイル)) {
    console.error("\n  " + path.relative(process.cwd(), 設定ファイル) + " がありません。");
    console.error("  chiiki/data/source/README.md の「ポリゴン設定」をご覧ください。\n");
    process.exit(1);
  }
  const 設定 = JSON.parse(fs.readFileSync(設定ファイル, "utf8"));
  const 三大都市圏 = new Set(設定.三大都市圏の県コード || 既定の三大都市圏);

  /* --- 位置参照情報 --- */
  const isjファイル = src(設定.位置参照情報 || "位置参照情報_大字町丁目_R7_全国.zip");
  if (!fs.existsSync(isjファイル)) { console.error("\n  位置参照情報がありません: " + isjファイル + "\n"); process.exit(1); }
  const { rows: isj } = /\.zip$/i.test(isjファイル) ? await readZip(isjファイル, 県) : readCSV(isjファイル);
  console.log(`\n  位置参照情報: ${isj.length.toLocaleString()} 件`);

  /* --- 過疎一覧（指定の現況はこれが決める） --- */
  const 過疎一覧 = 表を読む(src("中間_過疎一覧.csv"));
  if (!過疎一覧) { console.error("  中間_過疎一覧.csv がありません。先に read_kaso_pdf.py を流してください。\n"); process.exit(1); }
  const 過疎区分 = new Map();   // "県\t市町村" -> {区分, 区域[]}
  過疎一覧.forEach((r) => 過疎区分.set(r.都道府県名 + "\t" + r.市町村名, {
    区分: r.過疎区分,
    区域: (r.みなされる区域 || "").split("|").map((s) => s.trim()).filter(Boolean)
  }));

  /* --- 接頭辞で解けた過疎の結果 --- */
  const 接頭辞 = 表を読む(src("中間_大字と区域.csv")) || [];
  const 接頭辞結果 = new Map();
  接頭辞.forEach((r) => 接頭辞結果.set(r.大字町丁目コード, r));
  console.log(`  接頭辞で決まっている大字: ${接頭辞結果.size.toLocaleString()} 件`);

  /* --- ポリゴン --- */
  const 索引 = {};
  const 投入した法令 = [];
  for (const l of 法令) {
    const c = (設定.法令 || {})[l];
    if (!c || !c.ファイル || c.有効 === false) { console.log(`  ${l}: ポリゴン未投入`); continue; }
    const f = src(c.ファイル);
    if (!fs.existsSync(f)) { console.log(`  ${l}: ファイルがありません（${c.ファイル}）`); continue; }
    const features = await geo.read(f);
    索引[l] = { 索引: pip.索引を作る(features, { 緩衝m: c.緩衝m || 設定.緩衝m || pip.既定.緩衝m }), 設定: c };
    投入した法令.push(l);
    console.log(`  ${l}: ${features.length.toLocaleString()} ポリゴン（${c.ファイル}）`);
  }
  if (!投入した法令.length) {
    console.error("\n  ポリゴンが1つも投入されていません。ポリゴン設定.json を確かめてください。\n");
    process.exit(1);
  }

  /* --- 大字ごとに判定 --- */
  const 大字行 = [];
  const 市町村集計 = new Map();   // コード -> {都道府県名, 市町村名, 法令別: {法令: {b, c, 未}}}
  isj.forEach((d) => {
    const 前 = 接頭辞結果.get(d.大字コード);
    const 行 = {
      大字町丁目コード: d.大字コード, 市町村コード: d.市町村コード, 市町村名: d.市町村名, 大字名: d.大字名,
      緯度: d.緯度 === null ? "" : d.緯度, 経度: d.経度 === null ? "" : d.経度,
      過疎: "", 山村: "", 離島: "", 半島: "",
      旧市町村名: 前 ? 前.旧市町村名 : "", 決め方: "", 要確認理由: ""
    };
    const 決め方 = [];

    /* 過疎：一覧が決める。接頭辞で解けていればそれを使う。 */
    const 過 = 過疎区分.get(d.都道府県名 + "\t" + d.市町村名) ||
               過疎区分.get(d.都道府県名 + "\t" + String(d.市町村名).replace(/^.+?郡/, ""));
    if (!過) 行.過疎 = "c";                                   // 過疎一覧に載っていない＝過疎ではない
    else if (過.区分 === "全部過疎" || 過.区分 === "みなし過疎") 行.過疎 = "b";
    else if (前 && 前.過疎) { 行.過疎 = 前.過疎; 決め方.push("過疎:接頭辞"); }
    else if (前 && 前.要確認理由) 行.要確認理由 = 前.要確認理由;

    if (d.緯度 === null || d.経度 === null) {
      行.要確認理由 = 行.要確認理由 || "位置参照情報に代表点の座標がありません";
    } else {
      投入した法令.forEach((l) => {
        if (l === "過疎" && 行.過疎) return;                  // 一覧で決まっているものは触らない
        const { 当たり, 境界近い, 境界までm } = pip.引く(索引[l].索引, d.緯度, d.経度);
        if (境界近い) {
          行.要確認理由 = 行.要確認理由 ||
            `${l}の区域境界から ${境界までm}m しか離れておらず、代表点だけでは内外を決められません`;
          return;
        }
        if (l === "過疎" && 当たり) {
          /* ポリゴンで旧市町村名を得て、令和4年の一覧に載っているかで判断する */
          const 旧 = geo.拾う(当たり.properties, 索引[l].設定.旧市町村名の属性 || ["旧市町村", "旧市区町村", "市町村名"]);
          const 載っている = 過 && 過.区域.some((z) => 旧 && (旧.indexOf(z) >= 0 || z.indexOf(旧) >= 0));
          行.過疎 = 載っている ? "b" : "c";
          if (載っている) 行.旧市町村名 = "旧" + 旧.replace(/^旧/, "");
          決め方.push("過疎:点in");
          return;
        }
        行[l] = 当たり ? "b" : "c";
        決め方.push(l + ":点in");
        if (当たり && l !== "過疎") {
          const 名 = geo.拾う(当たり.properties, 索引[l].設定.区域名の属性 || ["島名", "地域名", "旧市町村", "名称"]);
          if (名 && !行.旧市町村名) 行.旧市町村名 = 名;
        }
      });
    }
    行.決め方 = 決め方.join("|");
    大字行.push(行);

    const k = d.市町村コード;
    if (!市町村集計.has(k)) 市町村集計.set(k, { 都道府県名: d.都道府県名, 市町村名: d.市町村名, 法令別: {} });
    const s = 市町村集計.get(k);
    法令.forEach((l) => {
      s.法令別[l] = s.法令別[l] || { b: 0, c: 0, 未: 0 };
      s.法令別[l][行[l] === "b" ? "b" : 行[l] === "c" ? "c" : "未"]++;
    });
  });

  /* --- 市町村ごとの区分 --- */
  const 市町村行 = [];
  市町村集計.forEach((s, コード) => {
    const 該当 = [], 備考 = [];
    let 全域 = false, 一部 = false, 未判定 = false;
    法令.forEach((l) => {
      const v = s.法令別[l];
      const 合計 = v.b + v.c + v.未;
      if (v.未 === 合計) { if (投入した法令.indexOf(l) >= 0 || l === "過疎") 未判定 = true; return; }
      if (v.b === 0) return;
      該当.push(l);
      if (v.c === 0 && v.未 === 0) 全域 = true; else 一部 = true;
      if (v.未) 未判定 = true;
    });
    法令.forEach((l) => { if (投入した法令.indexOf(l) < 0 && l !== "過疎") 備考.push(l + "のポリゴン未投入"); });

    const 区分 = 全域 ? "全部条件不利地域" : 一部 ? "一部条件不利地域" : 該当.length ? "一部条件不利地域" : "都市地域";
    if (未判定) 備考.push("未判定の大字あり");
    市町村行.push({
      市町村コード: コード, 都道府県名: s.都道府県名, 市町村名: s.市町村名,
      区分: 区分, 指定都市区分: "該当なし", 該当法令: 該当.join("|"),
      三大都市圏: 三大都市圏.has(String(コード).slice(0, 2)) ? 1 : 0,
      人口減少率例外: 0, 備考: 備考.join("|")
    });
  });

  fs.writeFileSync(src("中間_大字と区域.csv"), CSVにする(大字見出し, 大字行), "utf8");
  fs.writeFileSync(src("中間_市町村区分.csv"), CSVにする(市町村見出し, 市町村行), "utf8");

  const 数 = (f) => 大字行.filter(f).length;
  console.log("");
  console.log(`  大字      : ${大字行.length.toLocaleString()} 件`);
  法令.forEach((l) => console.log(`    ${l}  b:${数((r) => r[l] === "b").toLocaleString()}  c:${数((r) => r[l] === "c").toLocaleString()}  未判定:${数((r) => !r[l]).toLocaleString()}`));
  console.log(`    要確認: ${数((r) => r.要確認理由).toLocaleString()} 件`);
  console.log("");
  const 区分数 = {};
  市町村行.forEach((m) => { 区分数[m.区分] = (区分数[m.区分] || 0) + 1; });
  console.log(`  市町村    : ${市町村行.length.toLocaleString()} 件  ` + Object.keys(区分数).map((k) => `${k} ${区分数[k]}`).join(" / "));
  console.log("");
  console.log("  出力: " + path.relative(process.cwd(), src("中間_大字と区域.csv")));
  console.log("  出力: " + path.relative(process.cwd(), src("中間_市町村区分.csv")));
  console.log("");
  console.log("  次に:  node chiiki/tools/ingest/build-data.js\n");
}

if (require.main === module) main().catch((e) => { console.error("\n  " + e.stack + "\n"); process.exit(1); });
module.exports = { CSVにする, 大字見出し, 市町村見出し, 法令 };
