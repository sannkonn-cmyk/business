/* ===========================================================
   現在の大字に、合併前の旧市町村を当てる

   仕様書 §4-4 は「大字の代表点を旧市町村ポリゴンに点in判定する」としていますが、
   CODH のポリゴンを使わずに、位置参照情報を新旧2年度ぶん並べて
   代表点どうしを突き合わせます。

   点をポリゴンに落とすのではなく点と点を対応づけるため、
   仕様書 §7-1 の「大字が旧市町村境をまたぐ場合の誤判定」が生じません。
   そのかわり「どの旧市町村の大字に対応するか決められない」場合が出るので、
   それを正直に「要確認」として返します。

   使い方:
     node chiiki/tools/ingest/match-oaza.js <最新年度版CSV> <旧年度版CSV> [出力CSV]
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { read } = require("./read-isj.js");

const 既定 = {
  近いとみなす距離m: 500,     // これ以内なら素直に対応しているとみる
  対応の上限距離m: 5000,      // これを超えたら対応する大字なしとみる
  曖昧とみなす比: 1.5,        // 1位と2位の距離がこの比の中に収まると曖昧
  曖昧の余裕m: 200,           // 距離が小さいときに比だけで曖昧にしないための下駄
  探索半径m: 20000            // 候補をこの範囲に絞ってから測る
};

/* ---------- 距離 ---------- */
function 距離m(a, b) {
  const R = 6371000, 度 = Math.PI / 180;
  const φ1 = a.緯度 * 度, φ2 = b.緯度 * 度;
  const Δφ = (b.緯度 - a.緯度) * 度, Δλ = (b.経度 - a.経度) * 度;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/* ---------- 名称の整合 ----------
   合併のとき、旧市町村名が新しい大字名の頭に付くことがよくあります。
     旧：八雲村 日吉        →  新：松江市 八雲町日吉
     旧：佐田町 反邊        →  新：出雲市 佐田町反邊
   そこで「旧大字名そのもの」「旧市町村名の頭＋旧大字名」の両方を許します。 */
function 整える(s) {
  return String(s || "")
    .replace(/^大字/, "").replace(/^字/, "")
    .replace(/[\s　]/g, "")
    .normalize("NFKC");
}
function 市町村の頭(名) {
  return String(名 || "").replace(/[市町村]$/, "");
}
function 名称が整合するか(新大字名, 旧市町村名, 旧大字名) {
  const 新 = 整える(新大字名), 旧 = 整える(旧大字名), 頭 = 整える(市町村の頭(旧市町村名));
  if (!新 || !旧) return false;
  if (新 === 旧) return true;
  if (!頭) return false;
  return 新 === 頭 + 旧 || 新 === 頭 + "町" + 旧 || 新 === 頭 + "村" + 旧 || 新 === 頭 + "区" + 旧;
}

/**
 * @param {Array} 新rows 最新年度版の行（1市町村ぶんでも全県ぶんでも可）
 * @param {Array} 旧rows 合併前年度版の行
 * @param {Object} opts  しきい値の上書き
 * @returns {Array} 突合結果
 */
function match(新rows, 旧rows, opts) {
  const 設定 = Object.assign({}, 既定, opts || {});
  const 有効な旧 = 旧rows.filter((r) => r.緯度 !== null && r.経度 !== null);

  /* 緯度で粗く絞ってから距離を測ります（全国でも現実的な速さにするため） */
  const 度あたりm = 111000;
  const 並び = 有効な旧.slice().sort((a, b) => a.緯度 - b.緯度);
  const 緯度列 = 並び.map((r) => r.緯度);
  function 近傍候補(緯度) {
    const 幅 = 設定.探索半径m / 度あたりm;
    let lo = 0, hi = 緯度列.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (緯度列[m] < 緯度 - 幅) lo = m + 1; else hi = m; }
    const 始 = lo;
    lo = 0; hi = 緯度列.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (緯度列[m] <= 緯度 + 幅) lo = m + 1; else hi = m; }
    return 並び.slice(始, lo);
  }

  return 新rows.map((新) => {
    const 基 = {
      大字町丁目コード: 新.大字コード,
      市町村コード: 新.市町村コード,
      市町村名: 新.市町村名,
      大字名: 新.大字名,
      旧市町村コード: "",
      旧市町村名: "",
      突合方法: "",
      突合距離m: "",
      要確認理由: ""
    };
    if (新.緯度 === null || 新.経度 === null) {
      基.要確認理由 = "最新年度版に代表点の座標がありません";
      return 基;
    }

    const 候補 = 近傍候補(新.緯度)
      .map((旧) => ({ 旧, d: 距離m(新, 旧) }))
      .filter((c) => c.d <= 設定.探索半径m)
      .sort((a, b) => a.d - b.d);

    if (!候補.length) {
      基.要確認理由 = "旧年度版に対応する大字が見つかりません（合併後にできた区域の可能性があります）";
      return 基;
    }

    /* ① 名称が整合する候補があれば、それを採ります（座標を名称で検算する） */
    const 名一致 = 候補.filter((c) => 名称が整合するか(新.大字名, c.旧.市町村名, c.旧.大字名));
    const 名一致の旧市町村 = new Set(名一致.map((c) => c.旧.市町村コード));
    if (名一致.length && 名一致の旧市町村.size === 1) {
      const c = 名一致[0];
      基.旧市町村コード = c.旧.市町村コード;
      基.旧市町村名 = c.旧.市町村名;
      基.突合方法 = "同名一致";
      基.突合距離m = c.d;
      if (c.d > 設定.対応の上限距離m) {
        基.要確認理由 = "名称は一致しますが、新旧の代表点が " + c.d + "m 離れています";
      }
      return 基;
    }
    if (名一致の旧市町村.size > 1) {
      基.要確認理由 = "名称の一致する旧市町村が複数あります（" +
        [...名一致の旧市町村].map((k) => (名一致.find((c) => c.旧.市町村コード === k).旧.市町村名)).join("・") + "）";
      return 基;
    }

    /* ② 名称で決まらなければ、いちばん近い大字の旧市町村を採ります */
    const 一位 = 候補[0];
    if (一位.d > 設定.対応の上限距離m) {
      基.要確認理由 = "旧年度版のもっとも近い大字まで " + 一位.d + "m あり、対応づけられません";
      return 基;
    }

    /* ③ ただし、別の旧市町村の大字が同じくらい近い場合は決められません。
       ここが、旧市町村境の付近をとりこぼさないための歯止めです。 */
    const 別市町村 = 候補.find((c) => c.旧.市町村コード !== 一位.旧.市町村コード);
    if (別市町村 && 別市町村.d <= 一位.d * 設定.曖昧とみなす比 + 設定.曖昧の余裕m) {
      基.要確認理由 = "旧市町村の候補が絞れません（" + 一位.旧.市町村名 + " まで " + 一位.d +
        "m、" + 別市町村.旧.市町村名 + " まで " + 別市町村.d + "m）";
      return 基;
    }

    基.旧市町村コード = 一位.旧.市町村コード;
    基.旧市町村名 = 一位.旧.市町村名;
    基.突合方法 = "最近傍";
    基.突合距離m = 一位.d;
    if (一位.d > 設定.近いとみなす距離m) {
      基.要確認理由 = "名称が一致せず、もっとも近い大字まで " + 一位.d + "m あります";
    }
    return 基;
  });
}

/* ---------- CSV 書き出し ---------- */
const 見出し = ["大字町丁目コード", "市町村コード", "市町村名", "大字名", "旧市町村コード", "旧市町村名", "突合方法", "突合距離m", "要確認理由"];
function CSVにする(結果) {
  const 包む = (v) => {
    const s = String(v === null || v === undefined ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return 見出し.join(",") + "\n" + 結果.map((r) => 見出し.map((h) => 包む(r[h])).join(",")).join("\n") + "\n";
}

module.exports = { match, 距離m, 名称が整合するか, CSVにする, 既定 };

if (require.main === module) {
  const [最新, 旧, 出力] = process.argv.slice(2);
  if (!最新 || !旧) {
    console.error("使い方: node chiiki/tools/ingest/match-oaza.js <最新年度版CSV> <旧年度版CSV> [出力CSV]");
    process.exit(1);
  }
  const a = read(最新), b = read(旧);
  if (a.欠けている列.length) { console.error("  最新年度版で読めなかった列: " + a.欠けている列.join("・")); process.exit(1); }
  if (b.欠けている列.length) { console.error("  旧年度版で読めなかった列: " + b.欠けている列.join("・")); process.exit(1); }

  console.log(`  最新年度版: ${a.rows.length.toLocaleString()} 件 / 旧年度版: ${b.rows.length.toLocaleString()} 件`);
  const 結果 = match(a.rows, b.rows);

  const 数 = (f) => 結果.filter(f).length;
  console.log("");
  console.log(`  同名一致      : ${数((r) => r.突合方法 === "同名一致" && !r.要確認理由).toLocaleString()} 件`);
  console.log(`  最近傍        : ${数((r) => r.突合方法 === "最近傍" && !r.要確認理由).toLocaleString()} 件`);
  console.log(`  要確認        : ${数((r) => r.要確認理由).toLocaleString()} 件`);
  const 理由 = {};
  結果.filter((r) => r.要確認理由).forEach((r) => {
    const k = r.要確認理由.replace(/[0-9]+m/g, "◯m").replace(/（.*）/, "");
    理由[k] = (理由[k] || 0) + 1;
  });
  Object.keys(理由).sort((x, y) => 理由[y] - 理由[x]).forEach((k) => console.log(`      ${理由[k]} 件  ${k}`));

  const 先 = 出力 || path.resolve(__dirname, "..", "..", "data", "source", "中間_大字と旧市町村.csv");
  fs.mkdirSync(path.dirname(先), { recursive: true });
  fs.writeFileSync(先, CSVにする(結果), "utf8");
  console.log(`\n  出力: ${path.relative(process.cwd(), 先)}`);
  console.log("  要確認の行は目で確かめ、必要なら直してから build-data.js を流してください。\n");
}
