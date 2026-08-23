/* ===========================================================
   大字名の接頭辞から、条件不利区域(b) にあたる旧市町村を当てる

   総務省「過疎地域市町村等一覧」は、一部過疎の市町村について
   条件不利区域にあたる旧市町村名を挙げています（例：松江市 → 鹿島町・島根町・美保関町）。
   平成の合併では旧町村名がそのまま大字名の頭に付くことが多く、
   「鹿島町恵曇」「佐田町朝原」のように接頭辞で拾えます。

   全国の一部過疎158団体で測ると、接頭辞だけで101団体（63%）、
   区域（旧市町村）単位では 276/351（79%）が解けます。

   【安全弁】一覧に載っている旧市町村名のうち1つでも接頭辞でヒットしなければ、
   その市町村の全大字を要確認に落とします。旧町名が大字に残らなかった合併
   （函館市の旧戸井町など）で、(b) を静かに (c) と誤らないためです。
   検出された市町村は、国土数値情報のポリゴンで補ってください。

   使い方:
     node chiiki/tools/ingest/match-by-prefix.js [位置参照情報のzip/csv] [県コード]
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { read, readZip, 復号, CSVを分ける } = require("./read-isj.js");

const root = process.env.CHIIKI_DATA_ROOT ? path.resolve(process.env.CHIIKI_DATA_ROOT) : path.resolve(__dirname, "..", "..");
const src = (f) => path.join(root, "data", "source", f);

/* 中間CSVの列。法令ごとの結果を横に並べ、あとの工程が埋めていきます。 */
const 見出し = ["大字町丁目コード", "市町村コード", "市町村名", "大字名", "緯度", "経度",
  "過疎", "山村", "離島", "半島", "旧市町村名", "決め方", "要確認理由"];

/* ISJ は町村に郡名を付けます（「仁多郡奥出雲町」）。一覧は付けません。 */
const 郡を落とす = (s) => String(s || "").replace(/^.+?郡/, "");

/* 旧市町村名から、大字名の頭に付きうる形を作ります。
   長いものから試し、いちばん長く一致したものを採ります。 */
function 接頭辞の候補(旧) {
  const 素 = String(旧 || "").trim();
  const 幹 = 素.replace(/[市町村]$/, "");
  const 候補 = [素];
  if (幹 && 幹 !== 素) ["町", "村", "市"].forEach((x) => { if (幹 + x !== 素) 候補.push(幹 + x); });
  if (幹 && 幹.length >= 2) 候補.push(幹);
  return [...new Set(候補)].filter(Boolean);
}

/* 大字名が接頭辞に当たるかどうか。
   「鹿島町恵曇」のように後ろが続く場合と、旧市町村名がそのまま大字名になっている
   「戸井町」のような場合の両方を拾います。ただし幹だけの短い一致（「島根」で
   「島根町◯◯」以外まで拾う）を防ぐため、完全一致は旧市町村名そのものに限ります。 */
function 当たるか(大字名, 接頭辞, 旧) {
  if (大字名 === String(旧).trim()) return true;
  return 大字名.length > 接頭辞.length && 大字名.startsWith(接頭辞);
}

function 表を読む(ファイル) {
  const 行 = CSVを分ける(復号(fs.readFileSync(ファイル)));
  const 見 = 行[0].map((h) => h.replace(/^﻿/, "").trim());
  return 行.slice(1).map((r) => {
    const o = {};
    見.forEach((h, i) => { o[h] = (r[i] || "").trim(); });
    return o;
  }).filter((o) => o.市町村名);
}

/**
 * @param {Array} 一覧 中間_過疎一覧.csv の行
 * @param {Array} isj  位置参照情報の行
 * @returns {{rows: Array, 市町村別: Array}}
 */
function match(一覧, isj) {
  /* ISJ を (都道府県名, 市町村名) で引けるようにする。郡ありなしの両方で引けるように。 */
  const 索引 = new Map();
  isj.forEach((r) => {
    [r.市町村名, 郡を落とす(r.市町村名)].forEach((n) => {
      const k = r.都道府県名 + "\t" + n;
      if (!索引.has(k)) 索引.set(k, []);
      if (索引.get(k).indexOf(r) < 0) 索引.get(k).push(r);
    });
  });

  const rows = [], 市町村別 = [];

  一覧.filter((x) => x.過疎区分 === "一部過疎").forEach((x) => {
    const 大字 = 索引.get(x.都道府県名 + "\t" + x.市町村名);
    const 区域 = (x.みなされる区域 || "").split("|").map((s) => s.trim()).filter(Boolean);
    const 記録 = { 都道府県名: x.都道府県名, 市町村名: x.市町村名, 区域: 区域, 大字数: 大字 ? 大字.length : 0, 解けた区域: [], 解けない区域: [], 状態: "" };

    if (!大字 || !大字.length) {
      記録.状態 = "位置参照情報に市町村が見つかりません";
      市町村別.push(記録);
      return;
    }

    /* 旧市町村ごとに、いちばん長く効く接頭辞を1つ決める */
    const 効いた接頭辞 = [];
    区域.forEach((旧) => {
      let 採用 = null;
      for (const p of 接頭辞の候補(旧)) {
        const 件 = 大字.filter((d) => 当たるか(d.大字名, p, 旧)).length;
        if (件 && (!採用 || p.length > 採用.接頭辞.length)) 採用 = { 旧: 旧, 接頭辞: p, 件: 件 };
      }
      if (採用) { 効いた接頭辞.push(採用); 記録.解けた区域.push(`${旧}(${採用.件})`); }
      else 記録.解けない区域.push(旧);
    });

    const 全部解けた = 記録.解けない区域.length === 0;
    記録.状態 = 全部解けた ? "接頭辞で解けた" : "ポリゴンでの補完が必要";
    市町村別.push(記録);

    大字.forEach((d) => {
      const 基 = {
        大字町丁目コード: d.大字コード, 市町村コード: d.市町村コード, 市町村名: d.市町村名,
        大字名: d.大字名, 緯度: d.緯度 === null ? "" : d.緯度, 経度: d.経度 === null ? "" : d.経度,
        過疎: "", 山村: "", 離島: "", 半島: "", 旧市町村名: "", 決め方: "", 要確認理由: ""
      };
      if (!全部解けた) {
        基.要確認理由 = "この市町村は「" + 記録.解けない区域.join("・") +
          "」が条件不利区域とされていますが、大字名から区域を特定できません";
        rows.push(基);
        return;
      }
      /* いちばん長く一致した接頭辞を採る（「西郷町」と「西郷村」のような取り違えを避ける） */
      let 当たり = null;
      効いた接頭辞.forEach((h) => {
        if (当たるか(d.大字名, h.接頭辞, h.旧)) {
          if (!当たり || h.接頭辞.length > 当たり.接頭辞.length) 当たり = h;
          else if (h.接頭辞.length === 当たり.接頭辞.length && h.旧 !== 当たり.旧) 当たり = { 曖昧: [当たり.旧, h.旧], 接頭辞: h.接頭辞 };
        }
      });
      if (当たり && 当たり.曖昧) {
        基.要確認理由 = "接頭辞「" + 当たり.接頭辞 + "」が " + 当たり.曖昧.join("・") + " のどちらにも当たります";
      } else if (当たり) {
        基.過疎 = "b";
        基.旧市町村名 = "旧" + 当たり.旧;
        基.決め方 = "接頭辞";
      } else {
        基.過疎 = "c";
        基.決め方 = "接頭辞";
      }
      rows.push(基);
    });
  });

  return { rows, 市町村別 };
}

const 包む = (v) => {
  const s = String(v === null || v === undefined ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const CSVにする = (rows) => 見出し.join(",") + "\n" + rows.map((r) => 見出し.map((h) => 包む(r[h])).join(",")).join("\n") + "\n";

module.exports = { match, 接頭辞の候補, 当たるか, 郡を落とす, CSVにする, 見出し };

if (require.main === module) {
  const 入力 = process.argv[2] || src("位置参照情報_大字町丁目_R7_全国.zip");
  const 県 = process.argv[3];
  const 一覧ファイル = src("中間_過疎一覧.csv");

  if (!fs.existsSync(一覧ファイル)) {
    console.error("\n  " + path.relative(process.cwd(), 一覧ファイル) + " がありません。");
    console.error("  先に python3 chiiki/tools/ingest/read_kaso_pdf.py を流してください。\n");
    process.exit(1);
  }
  if (!fs.existsSync(入力)) { console.error("\n  位置参照情報がありません: " + 入力 + "\n"); process.exit(1); }

  let 一覧 = 表を読む(一覧ファイル);
  (/\.zip$/i.test(入力) ? readZip(入力, 県) : Promise.resolve(read(入力))).then(({ rows: isj, 欠けている列 }) => {
    /* 県を絞ったときは、一覧の側も同じ県に絞ります（他県が「見つからない」と出ないように） */
    if (県) {
      const 県名 = new Set(isj.map((r) => r.都道府県名));
      一覧 = 一覧.filter((x) => 県名.has(x.都道府県名));
    }
    if (欠けている列.length) { console.error("  位置参照情報で読めなかった列: " + 欠けている列.join("・")); process.exit(1); }

    const { rows, 市町村別 } = match(一覧, isj);
    const 対象 = 市町村別.length;
    const 解けた = 市町村別.filter((m) => m.状態 === "接頭辞で解けた");
    const 補完 = 市町村別.filter((m) => m.状態 === "ポリゴンでの補完が必要");
    const 無し = 市町村別.filter((m) => m.状態.indexOf("見つかりません") >= 0);

    console.log("");
    console.log(`  一覧の一部過疎        : ${対象} 団体${県 ? `（県コード ${県} に限定）` : ""}`);
    console.log(`  接頭辞だけで解けた    : ${解けた.length} 団体`);
    console.log(`  ポリゴンでの補完が必要: ${補完.length} 団体`);
    if (無し.length) console.log(`  位置参照情報に無い    : ${無し.length} 団体 ${無し.map((m) => m.都道府県名 + m.市町村名).slice(0, 5).join("、")}`);
    console.log("");
    console.log(`  大字        : ${rows.length.toLocaleString()} 件` +
      `（(b):${rows.filter((r) => r.過疎 === "b").length.toLocaleString()}` +
      ` / (c):${rows.filter((r) => r.過疎 === "c").length.toLocaleString()}` +
      ` / 要確認:${rows.filter((r) => r.要確認理由).length.toLocaleString()}）`);

    if (補完.length) {
      console.log("");
      console.log("  ポリゴンでの補完が必要な市町村（先頭10件）:");
      補完.slice(0, 10).forEach((m) => console.log(`    ${m.都道府県名}${m.市町村名}: ${m.解けない区域.join("・")}`));
      if (補完.length > 10) console.log(`    …ほか ${補完.length - 10} 団体`);
    }

    const 出力 = src("中間_大字と区域.csv");
    if (県 && fs.existsSync(出力)) {
      console.log("");
      console.log(`  注意: 県コード ${県} に絞った結果で 中間_大字と区域.csv を置き換えます。`);
      console.log("        全国ぶんが入っていた場合は消えます。全国で流し直すには県コードを付けずに実行してください。");
    }
    fs.writeFileSync(出力, CSVにする(rows), "utf8");
    const 報告 = src("中間_接頭辞照合の結果.csv");
    fs.writeFileSync(報告, "都道府県名,市町村名,状態,大字数,解けた区域,解けない区域\n" +
      市町村別.map((m) => [m.都道府県名, m.市町村名, m.状態, m.大字数, m.解けた区域.join("|"), m.解けない区域.join("|")].map(包む).join(",")).join("\n") + "\n", "utf8");
    console.log("");
    console.log("  出力: " + path.relative(process.cwd(), 出力));
    console.log("  出力: " + path.relative(process.cwd(), 報告) + "（目で確かめるための一覧）");
    console.log("");
    console.log("  山村・離島・半島の列はまだ空です。国土数値情報のポリゴンが揃ってから");
    console.log("  add-polygon-laws.js で埋めてください。それまで区域判定は確定しません。");
    console.log("");
  }).catch((e) => { console.error("  " + e.message); process.exit(1); });
}
