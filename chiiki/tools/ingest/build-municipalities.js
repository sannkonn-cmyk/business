/* ===========================================================
   一覧だけから、全国の市町村区分を組み立てる

   使い方:  node chiiki/tools/ingest/build-municipalities.js [県コード]

   ポリゴン（国土数値情報）は容量が大きく、扱いが重くなります。
   けれども判定フローのステップ②——市町村の区分——は、
   **市町村レベルの一覧さえあればポリゴンなしで決まります。**

     全部条件不利地域(a) → 住所によらず対象外
     都市地域            → 住所によらず対象
     一部条件不利地域    → ここではじめて区域(b/c)の判定が要る

   実務でいちばん多い「県外の都市部から雲南市へ」は、②で結論が出ます。
   ポリゴンが要るのは一部指定の市町村だけなので、後回しにできます。

   読むもの:
     中間_過疎一覧.csv   … read_kaso_pdf.py が作る（総務省 過疎地域市町村等一覧）
     中間_指定一覧.csv   … 振興山村・離島・半島の市町村レベル指定（形式は下記）
     位置参照情報        … 市町村コードと都道府県名を得るため
     取得記録.json       … どの法令の一覧を投入したか

   中間_指定一覧.csv の形:
     都道府県名,市町村名,法令,指定区分,区域,出典,基準日
     島根県,松江市,半島,一部,鹿島町|島根町,半島振興対策実施地域一覧,令和4年4月1日
       法令     … 山村 / 離島 / 半島（過疎は中間_過疎一覧.csv が持ちます）
       指定区分 … 全部 / 一部
       区域     … 一部のとき、条件不利区域にあたる旧市町村名や島名を | 区切りで
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { readZip, read: readCSV, 復号, CSVを分ける } = require("./read-isj.js");

const root = process.env.CHIIKI_DATA_ROOT ? path.resolve(process.env.CHIIKI_DATA_ROOT) : path.resolve(__dirname, "..", "..");
const src = (f) => path.join(root, "data", "source", f);

const 区域法令 = ["過疎", "山村", "離島", "半島"];
const 見出し = ["市町村コード", "都道府県名", "市町村名", "区分", "指定都市区分", "該当法令",
  "照合済み法令", "三大都市圏", "人口減少率例外", "区域の旧市町村", "備考"];

/* 3大都市圏の11都府県（仕様書 §4-2）。
   埼玉11・千葉12・東京13・神奈川14・岐阜21・愛知23・三重24・京都26・大阪27・兵庫28・奈良29 */
const 三大都市圏 = new Set(["11", "12", "13", "14", "21", "23", "24", "26", "27", "28", "29"]);

const 郡を落とす = (s) => String(s || "").replace(/^.+?郡/, "");
/* 資料によって「外ヶ浜町」「外ケ浜町」のように字体が揺れます。
   突合のときだけ、そろえた形で比べます（表示には元の名前を使います）。 */
const 名をそろえる = (s) => String(s || "")
  .normalize("NFKC")
  .replace(/[ヶヵ]/g, "ケ")
  .replace(/[\s　]/g, "");
/* 位置参照情報は政令指定都市の行政区を「札幌市中央区」の形で持ちます。
   確認表は指定都市を1つの単位として扱うので、親の市名を取り出します。 */
const 親の市 = (名) => { const m = /^(.+市)(.+区)$/.exec(String(名 || "")); return m ? m[1] : null; };

const 包む = (v) => {
  const s = String(v === null || v === undefined ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const CSVにする = (rows) => 見出し.join(",") + "\n" + rows.map((r) => 見出し.map((h) => 包む(r[h])).join(",")).join("\n") + "\n";

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

/**
 * @param {Array} isj      位置参照情報の行
 * @param {Array} 過疎一覧 中間_過疎一覧.csv
 * @param {Array} 指定一覧 中間_指定一覧.csv（無ければ []）
 * @param {Array} 収録法令 実際に一覧を投入した法令
 */
function build(isj, 過疎一覧, 指定一覧, 収録法令) {
  /* --- 市町村の骨格を位置参照情報から作る --- */
  const 市町村 = new Map();          // コード -> {…}
  const 指定都市の子 = new Map();    // 親の市名 -> [コード]
  isj.forEach((d) => {
    if (!市町村.has(d.市町村コード)) {
      市町村.set(d.市町村コード, {
        市町村コード: d.市町村コード, 都道府県名: d.都道府県名, 市町村名: d.市町村名,
        法令: {}, 区域: {}
      });
    }
    const 親 = 親の市(d.市町村名);
    if (親) {
      const k = d.都道府県名 + "\t" + 名をそろえる(親);
      if (!指定都市の子.has(k)) 指定都市の子.set(k, []);
      if (指定都市の子.get(k).indexOf(d.市町村コード) < 0) 指定都市の子.get(k).push(d.市町村コード);
    }
  });

  /* --- 一覧を市町村に貼る。郡あり／なし、指定都市の親／行政区の両方で引けるように --- */
  const 貼る = (県, 名, 法令, 指定区分, 区域) => {
    const 候補 = [];
    市町村.forEach((m, コード) => {
      if (m.都道府県名 !== 県) return;
      const a = 名をそろえる(m.市町村名), b = 名をそろえる(名);
      if (a === b || 名をそろえる(郡を落とす(m.市町村名)) === b) 候補.push(コード);
    });
    /* 一覧が「広島市」と書いていて、位置参照情報が「広島市中区」しか持たない場合 */
    if (!候補.length) {
      const 子 = 指定都市の子.get(県 + "\t" + 名) || 指定都市の子.get(県 + "\t" + 名をそろえる(名));
      if (子) 候補.push(...子);
    }
    候補.forEach((コード) => {
      const m = 市町村.get(コード);
      m.法令[法令] = 指定区分;
      if (区域 && 区域.length) m.区域[法令] = 区域;
    });
    return 候補.length;
  };

  const 貼れなかった = [];
  過疎一覧.forEach((r) => {
    const 区分 = r.過疎区分 === "一部過疎" ? "一部" : "全部";
    const 区域 = (r.みなされる区域 || "").split("|").map((s) => s.trim()).filter(Boolean);
    if (!貼る(r.都道府県名, r.市町村名, "過疎", 区分, 区域)) 貼れなかった.push(`過疎: ${r.都道府県名}${r.市町村名}`);
  });
  指定一覧.forEach((r) => {
    if (区域法令.indexOf(r.法令) < 0) return;
    const 区域 = (r.区域 || "").split("|").map((s) => s.trim()).filter(Boolean);
    const 区分 = r.指定区分 === "一部" ? "一部" : "全部";
    if (!貼る(r.都道府県名, r.市町村名, r.法令, 区分, 区域)) 貼れなかった.push(`${r.法令}: ${r.都道府県名}${r.市町村名}`);
  });

  /* --- 指定都市の判定は市全体で見る（確認表が指定都市を1単位で扱うため） --- */
  const 指定都市に条件不利がある = new Map();
  指定都市の子.forEach((子, k) => {
    const ある = 子.some((コード) => Object.keys(市町村.get(コード).法令).length > 0);
    指定都市に条件不利がある.set(k, ある);
  });

  /* --- 区分を決める --- */
  const rows = [];
  市町村.forEach((m) => {
    const 該当 = 区域法令.filter((l) => m.法令[l]);
    const 全域 = 該当.filter((l) => m.法令[l] === "全部");
    const 一部 = 該当.filter((l) => m.法令[l] === "一部");
    const 未投入 = 区域法令.filter((l) => 収録法令.indexOf(l) < 0);

    let 区分, 備考 = [];
    if (全域.length) {
      /* 1つでも全域指定があれば、他の法令を見るまでもなく(a)です */
      区分 = "全部条件不利地域";
    } else if (一部.length) {
      区分 = "一部条件不利地域";
      if (未投入.length) 備考.push(未投入.join("・") + "の一覧が未投入");
    } else if (未投入.length) {
      /* どの法令にも当たらないが、一覧が揃っていないので都市地域と言い切れない */
      区分 = "未確定";
      備考.push(未投入.join("・") + "の一覧が未投入のため、都市地域と確定できません");
    } else {
      区分 = "都市地域";
    }

    const 親 = 親の市(m.市町村名);
    let 指定都市区分 = "該当なし";
    if (親) {
      指定都市区分 = 指定都市に条件不利がある.get(m.都道府県名 + "\t" + 名をそろえる(親))
        ? "条件不利地域を含む" : "条件不利地域を含まない";
      if (指定都市区分 === "条件不利地域を含む" && 区分 === "都市地域") 区分 = "一部条件不利地域";
      if (指定都市区分 === "条件不利地域を含む" && 区分 === "未確定") 備考.push("指定都市の一部に条件不利地域があります");
    }

    rows.push({
      市町村コード: m.市町村コード, 都道府県名: m.都道府県名, 市町村名: m.市町村名,
      区分: 区分, 指定都市区分: 指定都市区分,
      該当法令: 該当.join("|"),
      照合済み法令: 収録法令.filter((l) => 区域法令.indexOf(l) >= 0).join("|"),
      三大都市圏: 三大都市圏.has(String(m.市町村コード).slice(0, 2)) ? 1 : 0,
      人口減少率例外: 0,
      区域の旧市町村: 区域法令.filter((l) => m.区域[l]).map((l) => l + ":" + m.区域[l].join("・")).join("|"),
      備考: 備考.join("|")
    });
  });

  rows.sort((a, b) => a.市町村コード.localeCompare(b.市町村コード));
  return { rows, 貼れなかった };
}

module.exports = { build, 親の市, 郡を落とす, 名をそろえる, CSVにする, 見出し };

if (require.main === module) {
  (async () => {
    const 県 = process.argv[2];
    const 過疎一覧 = 表を読む(src("中間_過疎一覧.csv"));
    if (!過疎一覧) {
      console.error("\n  中間_過疎一覧.csv がありません。先に read_kaso_pdf.py を流してください。\n");
      process.exit(1);
    }
    const 指定一覧 = 表を読む(src("中間_指定一覧.csv")) || [];
    let 記録 = { 収録法令: ["過疎"] };
    if (fs.existsSync(src("取得記録.json"))) 記録 = JSON.parse(fs.readFileSync(src("取得記録.json"), "utf8"));
    const 収録法令 = (記録.収録法令 || ["過疎"]).filter((l) => 区域法令.indexOf(l) >= 0);

    const isjファイル = src("位置参照情報_大字町丁目_R7_全国.zip");
    if (!fs.existsSync(isjファイル)) { console.error("\n  位置参照情報がありません: " + isjファイル + "\n"); process.exit(1); }
    const { rows: isj } = await readZip(isjファイル, 県);

    const { rows, 貼れなかった } = build(isj, 過疎一覧, 指定一覧, 収録法令);

    const 数 = {};
    rows.forEach((r) => { 数[r.区分] = (数[r.区分] || 0) + 1; });
    console.log("");
    console.log(`  投入した一覧: ${収録法令.join("・")}` + (指定一覧.length ? `（指定一覧 ${指定一覧.length} 行）` : "（指定一覧はまだありません）"));
    console.log(`  市町村      : ${rows.length.toLocaleString()} 件`);
    console.log("");
    ["全部条件不利地域", "一部条件不利地域", "都市地域", "未確定"].forEach((k) => {
      if (数[k]) console.log(`    ${k.padEnd(9, "　")} ${String(数[k]).padStart(6)} 件`);
    });
    console.log("");
    console.log("  判定できること:");
    console.log(`    住所によらず「対象外」と言える : ${(数["全部条件不利地域"] || 0).toLocaleString()} 団体`);
    console.log(`    住所によらず「対象」と言える   : ${(数["都市地域"] || 0).toLocaleString()} 団体`);
    console.log(`    大字まで見る必要がある         : ${(数["一部条件不利地域"] || 0).toLocaleString()} 団体`);
    console.log(`    一覧が足りず判定できない       : ${(数["未確定"] || 0).toLocaleString()} 団体`);

    if (貼れなかった.length) {
      console.log("");
      console.log(`  一覧にあるが位置参照情報に見つからない市町村: ${貼れなかった.length} 件`);
      貼れなかった.slice(0, 8).forEach((x) => console.log("    " + x));
      if (貼れなかった.length > 8) console.log(`    …ほか ${貼れなかった.length - 8} 件`);
    }

    fs.writeFileSync(src("中間_市町村区分.csv"), CSVにする(rows), "utf8");
    console.log("");
    console.log("  出力: " + path.relative(process.cwd(), src("中間_市町村区分.csv")));
    const 未投入 = 区域法令.filter((l) => 収録法令.indexOf(l) < 0);
    if (未投入.length) {
      console.log("");
      console.log(`  ${未投入.join("・")} の一覧を投入すると、「未確定」の団体が都市地域か条件不利地域かに決まります。`);
    }
    console.log("");
  })().catch((e) => { console.error("\n  " + e.stack + "\n"); process.exit(1); });
}
