/* ===========================================================
   根拠テキストの組み立て
   仕様書 v0.1 §5-2 のひな形をそのまま出します。
   決裁に添える参考資料として、コピー・印刷・.txt保存に使います。
   =========================================================== */
"use strict";

var Report = (function () {

  var 罫 = "──────────────────────────────";

  /* 全角まじりの見出しを桁そろえするための幅計算 */
  function 表示幅(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      w += (c < 0x80 || (c >= 0xff61 && c <= 0xff9f)) ? 1 : 2;
    }
    return w;
  }
  function 桁そろえ(label, 幅) {
    var s = label, n = 幅 - 表示幅(label);
    while (n >= 2) { s += "　"; n -= 2; }
    while (n >= 1) { s += " "; n -= 1; }
    return s;
  }

  function 二桁(n) { return (n < 10 ? "0" : "") + n; }
  function 日時文字列(d) {
    return d.getFullYear() + "-" + 二桁(d.getMonth() + 1) + "-" + 二桁(d.getDate()) +
      " " + 二桁(d.getHours()) + ":" + 二桁(d.getMinutes());
  }

  var 結論文 = {
    "対象": "特別交付税措置の対象となる",
    "対象外": "特別交付税措置の対象とならない",
    "要確認": "要確認（このツールでは判定できません）",
    "入力待ち": "—"
  };

  /* 入力された住所を1行にまとめる */
  function 住所文(res) {
    if (!res.city) return "（未選択）";
    var 県 = res.city.sample ? "" : res.city.都道府県名;
    return 県 + res.city.市町村名 + (res.oaza ? " " + res.oaza.大字名 : "");
  }

  /* ---------- 本体 ---------- */
  function build(res, data, 実行日時) {
    var meta = data.meta;
    var 今 = 実行日時 || new Date();
    var L = [];
    var 幅 = 12; // 「該当旧市町村」＝12桁

    L.push("【地域おこし協力隊 地域要件 判定結果】");
    L.push("");

    /* 暫定データのあいだは、いちばん上に警告を出す。
       meta.dataStatus を "verified" に変えると自動的に消えます。 */
    if (meta.dataStatus !== "verified") {
      L.push(罫);
      L.push("【！】このツールに入っているデータは、出典資料と未照合の暫定値です。");
      L.push("　　　この判定結果を決裁資料に用いないでください。");
      L.push(罫);
      L.push("");
    }

    L.push("■ 判定");
    L.push("  " + (結論文[res.result] || res.result));
    L.push("");

    L.push("■ 転入地");
    L.push("  " + meta.転入地.都道府県名 + meta.転入地.市町村名);
    L.push("  区分: " + meta.転入地.説明);
    L.push("  根拠: " + meta.転入地.根拠);
    L.push("");

    L.push("■ 転出地");
    L.push("  " + 桁そろえ("入力住所", 幅) + ": " + 住所文(res));
    if (res.city) {
      var 区分表示 = res.city.指定都市区分 && res.city.指定都市区分 !== "該当なし"
        ? "指定都市（" + res.city.指定都市区分 + "）"
        : res.city.区分;
      L.push("  " + 桁そろえ("市町村区分", 幅) + ": " + 区分表示 +
        "（" + (res.三大都市圏 ? "3大都市圏" : "3大都市圏外") + "）");
      if (res.city.該当法令 && res.city.該当法令.length) {
        L.push("  " + 桁そろえ("市町村の法令", 幅) + ": " + res.city.該当法令.join("・"));
      }
    }
    if (res.oaza) {
      if (res.oaza.旧市町村名) L.push("  " + 桁そろえ("該当旧市町村", 幅) + ": " + res.oaza.旧市町村名);
      var 区域文 = res.oaza.境界跨ぎ ? "旧市町村の境をまたぐため確定できない"
        : res.oaza.区域判定 === "b" ? "条件不利区域(b) に該当"
        : res.oaza.区域判定 === "c" ? "条件不利区域(b) に該当しない ＝ (c)"
        : "区域の指定の有無を確認できていない";
      L.push("  " + 桁そろえ("区域判定", 幅) + ": " + 区域文);
      if (res.oaza.該当法令 && res.oaza.該当法令.length) {
        L.push("  " + 桁そろえ("区域の法令", 幅) + ": " + res.oaza.該当法令.join("・"));
      }
    }
    L.push("");

    /* 例外ルートで結論を出したときは、原則ではなくその旨を書く */
    if (res.route === "例外") {
      L.push("■ 適用したルート");
      L.push("  例外ルート（地域要件のフローに関わらず対象となる場合）");
      res.例外.forEach(function (e) {
        L.push("  ・" + e.ラベル);
        L.push("    " + e.根拠文);
      });
      L.push("");
    } else if (res.原則) {
      L.push("■ 適用した原則");
      L.push("  " + res.原則 + "（" + res.原則説明 + "）" + (res.原則照合済み ? "" : "  ※確認表と未照合"));
      var 記号意味 = (data.d3.記号の意味 || {})[res.symbol] || "";
      L.push("  地域要件確認表における記号: " + res.symbol + (記号意味 ? "（" + 記号意味 + "）" : ""));
      L.push("");
    }

    /* 「転出地」の欄に既に出した項目は、内訳で繰り返さない */
    var 既出 = { "該当旧市町村": 1, "区域判定": 1, "区域の根拠法令": 1 };
    var 内訳 = (res.reasons || []).filter(function (r) { return !既出[r.label]; });
    if (内訳.length) {
      L.push("■ 判定の内訳");
      内訳.forEach(function (r) { L.push("  " + r.label + ": " + r.value); });
      L.push("");
    }

    if (res.warnings && res.warnings.length) {
      L.push("■ 注意事項");
      res.warnings.forEach(function (w) { L.push("  ・" + w); });
      L.push("");
    }

    L.push("■ 出典");
    meta.出典.forEach(function (s) {
      L.push("  " + s.名称 + (s.現在日 ? "（" + s.現在日 + "現在）" : ""));
      if (s.url) L.push("    " + s.url);
    });
    L.push("  " + meta.ライセンス表記);
    L.push("");

    L.push("■ データ基準日: " + meta.基準日);
    L.push("■ 判定実行日時: " + 日時文字列(今));
    L.push("");
    L.push("※ " + meta.免責);

    return L.join("\n");
  }

  /* 履歴の一覧に出す1行の見出し */
  function 見出し(res) {
    return 住所文(res) + " → " + (res.result || "—");
  }

  return { build: build, 住所文: 住所文, 見出し: 見出し, 日時文字列: 日時文字列, 結論文: 結論文 };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Report;
