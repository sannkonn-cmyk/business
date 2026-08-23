/* ===========================================================
   判定エンジン
   仕様書 v0.1 §3「判定ロジック」をそのまま実装した純関数です。
   画面からもNode（テスト）からも読めるようにしてあります。

   転入地は雲南市に固定（§2-1）。転入地が全部条件不利地域(a)であるため、
   確認表のうち「3大都市圏外／全部条件不利地域」の1列だけを参照します（§2-2）。
   結果として判定記号は ○・△・× の3種のみで、▲・□ は出現しません。
   =========================================================== */
"use strict";

var Judge = (function () {

  /* 区域レベル(b) の判定に使えるのはこの4法令だけです（仕様書 §3-3）。
     奄美・小笠原・沖縄は市町村単位の指定なので、ここには入りません。 */
  var 区域レベルの法令 = ["過疎", "山村", "離島", "半島"];

  /* ---------- データの索引（毎回作らずデータ側に持たせる） ---------- */
  function 索引(data) {
    if (data.__index) return data.__index;
    var 市町村 = {}, 大字 = {}, 市町村別大字 = {};
    data.d1.市町村.forEach(function (m) { 市町村[m.コード] = m; });
    data.d2.大字.forEach(function (o) {
      大字[o.id] = o;
      (市町村別大字[o.市町村コード] = 市町村別大字[o.市町村コード] || []).push(o);
    });
    /* 索引はデータから導けるキャッシュなので、列挙対象から外しておきます。
       ここを普通の代入にすると JSON.stringify で複製されてしまい、
       元データを直したのに索引だけ古いままになります。 */
    Object.defineProperty(data, "__index", {
      value: { 市町村: 市町村, 大字: 大字, 市町村別大字: 市町村別大字 },
      enumerable: false, configurable: true, writable: true
    });
    return data.__index;
  }

  /* ---------- 確認表を引くためのキー ----------
     指定都市は「条件不利地域を含む／含まない」で行が分かれるため、
     指定都市区分があればそちらを優先します。 */
  function 区分キー(city) {
    if (city.指定都市区分 === "条件不利地域を含まない") return "指定都市_含まない";
    if (city.指定都市区分 === "条件不利地域を含む") return "指定都市_含む";
    return city.区分;
  }

  /* 人口減少率例外（2005〜2015年の減少率11%以上）に当たる団体は
     3大都市圏内であっても3大都市圏外として扱います（仕様書 §4-2）。 */
  function 実質三大都市圏(city) {
    return !!city.三大都市圏 && !city.人口減少率例外;
  }

  function 圏キー(city) { return 実質三大都市圏(city) ? "圏内" : "圏外"; }

  /* 条件不利区域(b) は「過疎みなし区域・振興山村・離島・半島」の和集合です（仕様書 §3-3）。
     ある大字が (b) だと言うには1つ載っていれば足りますが、
     (c) だと言うにはそのどれにも載っていないことを確かめる必要があります。
     そのため、市町村が該当しうる法令のうち一覧が未収録のものを返します。 */
  function 未照合の法令(city) {
    var 該当 = city.該当法令 || [];
    var 済 = city.照合済み法令 || [];
    return 該当.filter(function (l) {
      return 区域レベルの法令.indexOf(l) >= 0 && 済.indexOf(l) < 0;
    });
  }

  /* ---------- データの鮮度 ---------- */
  function 基準日が古いか(meta, 今日) {
    if (!meta.基準日ISO) return false;
    var 年数 = meta.鮮度警告年数 || 3;
    var 期限 = new Date(meta.基準日ISO);
    if (isNaN(期限)) return false;
    期限.setFullYear(期限.getFullYear() + 年数);
    return (今日 || new Date()) > 期限;
  }

  /* ---------- 判定本体 ---------- */
  function judge(input, data, 今日) {
    input = input || {};
    var idx = 索引(data);
    var meta = data.meta, d3 = data.d3;

    var out = {
      result: "入力待ち",
      route: "—",
      city: null,
      oaza: null,
      区分キー: null,
      三大都市圏: null,
      symbol: null,
      原則: null,
      原則説明: null,
      原則照合済み: false,
      区域判定: null,
      reasons: [],
      warnings: [],
      例外: [],
      不足: null
    };

    /* データ全体にかかる注意（結論によらず常に付ける） */
    if (meta.dataStatus !== "verified") {
      out.warnings.push("同梱データは出典資料と未照合の暫定値です。この判定結果を決裁資料に用いないでください。");
    }
    if (基準日が古いか(meta, 今日)) {
      out.warnings.push("データ基準日（" + meta.基準日 + "）から" + (meta.鮮度警告年数 || 3) + "年以上が経過しています。出典資料の更新を確認してください。");
    }

    /* --- ① 例外ルート（仕様書 §3-2）を最優先で見る --- */
    var ex = input.exceptions || {};
    Object.keys(d3.例外ルート).forEach(function (k) {
      if (k.charAt(0) === "_") return;
      if (ex[k]) out.例外.push({ key: k, ラベル: d3.例外ルート[k].ラベル, 根拠文: d3.例外ルート[k].根拠文, verified: d3.例外ルート[k].verified });
    });

    /* 転出地が選ばれていれば、例外ルートでも参考として載せる */
    var city = input.cityCode ? idx.市町村[input.cityCode] : null;
    if (input.cityCode && !city) {
      out.result = "要確認";
      out.route = "市町村判定";
      out.reasons.push({ label: "市町村", value: "コード " + input.cityCode + " はこのツールに収録されていません" });
      out.warnings.push("選ばれた市町村がデータに見つかりません。データの差し替え漏れが考えられます。");
      return out;
    }
    out.city = city;
    if (city) {
      out.区分キー = 区分キー(city);
      out.三大都市圏 = 実質三大都市圏(city);
      if (city.sample) {
        out.warnings.push("「" + city.市町村名 + "」は判定分岐を確認するための動作確認用サンプルです。実データではありません。");
      } else if (city.verified === false) {
        out.warnings.push("「" + city.市町村名 + "」の区分・該当法令は出典資料と未照合です。");
      }
    }

    if (out.例外.length > 0) {
      out.result = "対象";
      out.route = "例外";
      out.reasons.push({ label: "適用したルート", value: "例外ルート（仕様書 §3-2）。地域要件のフローに関わらず対象となります" });
      out.例外.forEach(function (e) { out.reasons.push({ label: "該当する例外", value: e.ラベル }); });
      if (out.例外.some(function (e) { return e.verified === false; })) {
        out.warnings.push("例外ルートの根拠文は出典資料と未照合です。");
      }
      return out;
    }

    /* --- ② 市町村マスタで区分を見る（仕様書 §3-1 ステップ②） --- */
    if (!city) { out.不足 = "市町村"; return out; }

    var key = 圏キー(city) + "|" + out.区分キー;
    var 表 = d3.対応[key];
    if (!表) {
      out.result = "要確認";
      out.route = "市町村判定";
      out.reasons.push({ label: "確認表", value: "「" + key + "」に対応する行が確認表データにありません" });
      out.warnings.push("確認表データ（d3_principles.json）にこの組合せの行がありません。");
      return out;
    }
    out.symbol = 表.記号;
    out.原則 = 表.原則;
    out.原則説明 = 表.説明;
    out.原則照合済み = 表.verified === true;
    if (!out.原則照合済み) {
      out.warnings.push("適用した原則（" + 表.原則 + "）の番号・文言は確認表と未照合です。");
    }
    if (city.三大都市圏 && city.人口減少率例外) {
      out.reasons.push({ label: "3大都市圏の扱い", value: "人口減少率が11%以上のため、3大都市圏外として扱いました" });
    }

    if (out.symbol === "×") {
      out.result = "対象外";
      out.route = "市町村判定";
      out.reasons.push({ label: "市町村区分", value: city.市町村名 + " は " + city.区分 + "(a) のため、住所によらず対象となりません" });
      return out;
    }
    if (out.symbol === "○") {
      out.result = "対象";
      out.route = "市町村判定";
      out.reasons.push({ label: "市町村区分", value: city.市町村名 + " は " + (city.指定都市区分 !== "該当なし" ? "指定都市（" + city.指定都市区分 + "）" : city.区分) + " のため、住所によらず対象となります" });
      return out;
    }

    /* --- ③ 記号が△のときだけ大字の区域(b/c)を見る（ステップ③） --- */
    var 候補 = idx.市町村別大字[city.コード] || [];
    if (候補.length === 0) {
      out.result = "要確認";
      out.route = "区域判定";
      out.reasons.push({ label: "区域判定", value: city.市町村名 + " の大字データが収録されていません" });
      out.warnings.push("この市町村は区域(b/c)の判定が必要ですが、大字テーブルに1件も収録がありません。");
      return out;
    }
    if (!input.oazaId) { out.不足 = "大字"; return out; }

    var oaza = idx.大字[input.oazaId];
    if (!oaza || oaza.市町村コード !== city.コード) {
      out.result = "要確認";
      out.route = "区域判定";
      out.reasons.push({ label: "区域判定", value: "選ばれた大字がテーブルに見つかりません（未収録）" });
      out.warnings.push("大字テーブルに未収録の区域です。旧市町村名を確認のうえ、総務省又は島根県へ照会してください。");
      return out;
    }
    out.oaza = oaza;
    out.route = "区域判定";
    out.区域判定 = oaza.区域判定;

    /* 記号が△の行の説明文は (b) と (c) で文意が変わるため、区域が決まってから選び直します */
    var 確定 = !oaza.要確認理由;
    if (確定 && oaza.区域判定 === "c" && 表.説明c) out.原則説明 = 表.説明c;
    if (確定 && oaza.区域判定 === "b" && 表.説明b) out.原則説明 = 表.説明b;

    if (oaza.旧市町村名) {
      out.reasons.push({ label: "該当旧市町村", value: oaza.旧市町村名 });
    }

    /* 取り込みの段階で確定できなかったもの（新旧の突合に失敗した等） */
    if (oaza.要確認理由) {
      out.result = "要確認";
      out.reasons.push({ label: "区域判定", value: oaza.要確認理由 });
      out.warnings.push("この大字は区域を確定できません。番地まで含めて総務省又は島根県へ照会してください。");
      return out;
    }

    /* (b) は、4法令のうち1つに載っていれば言えます */
    if (oaza.区域判定 === "b") {
      out.result = "対象外";
      out.reasons.push({ label: "区域判定", value: "条件不利区域(b) に該当" });
      if (oaza.該当法令 && oaza.該当法令.length) {
        out.reasons.push({ label: "区域の根拠法令", value: oaza.該当法令.join("・") });
      }
      return out;
    }

    /* (c) は「4法令のどれにも載っていない」ことなので、
       市町村が該当しうる法令の一覧がすべて揃っていないと言えません。
       欠けている法令があれば、対象と言い切らずに要確認へ落とします。 */
    if (oaza.区域判定 === "c") {
      var 欠け = 未照合の法令(city);
      if (欠け.length) {
        out.result = "要確認";
        out.未照合法令 = 欠け;
        out.reasons.push({ label: "区域判定", value: "収録済みの一覧では条件不利区域(b) に当たりませんが、" + 欠け.join("・") + " の区域一覧が未収録のため、(c) と言い切れません" });
        out.warnings.push("この市町村にかかる " + 欠け.join("・") + " の区域一覧が投入されていません。(b)に当たらないことまでは確かめられますが、(c) の確定には全法令の一覧が要ります。総務省又は島根県へ照会してください。");
        return out;
      }
      out.result = "対象";
      out.reasons.push({ label: "区域判定", value: "条件不利区域(b) に該当しない ＝ (c)" });
      return out;
    }

    out.result = "要確認";
    out.reasons.push({ label: "区域判定", value: "区域の指定の有無を確認できていません" + (oaza.メモ ? "（" + oaza.メモ + "）" : "") });
    out.warnings.push("この区域は出典資料での確認が済んでいません。総務省又は島根県へ照会してください。");
    return out;
  }

  return {
    judge: judge,
    区分キー: 区分キー,
    実質三大都市圏: 実質三大都市圏,
    基準日が古いか: 基準日が古いか,
    未照合の法令: 未照合の法令,
    区域レベルの法令: 区域レベルの法令,
    索引: 索引
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Judge;
