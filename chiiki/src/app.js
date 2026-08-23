/* ===========================================================
   画面の動き
   ・都道府県 → 市町村 → 大字 の3段プルダウン
   ・選ぶそばから判定し、根拠テキストを組み立てる
   ・履歴は「履歴に残す」を押したときだけ localStorage に入れる
   =========================================================== */
"use strict";

(function () {

  var DATA = window.__DATA__;
  var 履歴キー = "chiiki_youken_history_v1";
  var 履歴上限 = 50;

  var $ = function (id) { return document.getElementById(id); };
  var 埋め込み表示 = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();

  var 状態 = { pref: "", cityCode: "", oazaId: "", res: null, txt: "", 大字全件: [] };

  /* ---------- 小物 ---------- */
  function トースト(msg, warn) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast show" + (warn ? " warn" : "");
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.className = "toast"; }, 2600);
  }
  function 選択肢(sel, list, 先頭) {
    sel.innerHTML = "";
    var o = document.createElement("option");
    o.value = ""; o.textContent = 先頭; sel.appendChild(o);
    list.forEach(function (it) {
      var e = document.createElement("option");
      e.value = it.value; e.textContent = it.label;
      sel.appendChild(e);
    });
  }
  function 例外の状態() {
    return { 隊員経験者: $("ex1").checked, 海外在留: $("ex2").checked, JET終了者: $("ex3").checked };
  }
  function 例外あり() {
    var e = 例外の状態();
    return e.隊員経験者 || e.海外在留 || e.JET終了者;
  }

  /* ---------- 起動時のしつらえ ---------- */
  var データ未投入 = false;

  function 初期化() {
    var meta = DATA.meta;
    データ未投入 = !DATA.d1.市町村.length;

    $("badgeDate").textContent = "データ基準日 " + (meta.基準日 || "—");
    var 済 = meta.dataStatus === "verified" && !データ未投入;
    $("badgeStatus").textContent = データ未投入 ? "データ未投入" : 済 ? "照合済み" : "暫定（要照合）";
    $("badgeStatus").className = "badge " + (済 ? "ok" : "warn");

    if (!済) {
      $("alertHead").textContent = meta.暫定データ警告.見出し;
      $("alertBody").textContent = meta.暫定データ警告.本文;
      $("alertBar").hidden = false;
    }

    $("inName").textContent = meta.転入地.都道府県名 + meta.転入地.市町村名;
    $("inKubun").textContent = "区分：" + meta.転入地.説明;
    $("inRoot").textContent = "根拠：" + meta.転入地.根拠;

    $("credit").textContent = meta.ライセンス表記 + "　／　" + meta.免責;

    var 県 = [];
    DATA.d1.市町村.forEach(function (m) { if (県.indexOf(m.都道府県名) < 0) 県.push(m.都道府県名); });
    県.sort();
    選択肢($("selPref"), 県.map(function (p) { return { value: p, label: p }; }), データ未投入 ? "データがありません" : "選んでください");
    if (データ未投入) {
      ["selPref", "selCity", "selOaza"].forEach(function (id) { $(id).disabled = true; });
      ["ex1", "ex2", "ex3"].forEach(function (id) { $(id).disabled = true; });
      $("btnClear").disabled = true;
    }

    if (埋め込み表示) {
      $("btnSave").disabled = true;
      $("btnSave").title = "埋め込み表示ではファイルの保存ができません";
    }

    描画();
  }

  /* ---------- プルダウンの連動 ---------- */
  function 市町村を並べる() {
    var list = DATA.d1.市町村
      .filter(function (m) { return m.都道府県名 === 状態.pref; })
      .map(function (m) { return { value: m.コード, label: m.市町村名 }; });
    選択肢($("selCity"), list, "選んでください");
    $("selCity").disabled = list.length === 0;
  }

  function 大字を並べる() {
    状態.大字全件 = DATA.d2.大字
      .filter(function (o) { return o.市町村コード === 状態.cityCode; })
      .map(function (o) { return { value: o.id, label: o.大字名 }; });
    $("oazaFilter").value = "";
    /* 全国では1市町村に3,000件を超える大字があります。数が多いときだけ絞り込み欄を出します。 */
    $("oazaFilter").hidden = 状態.大字全件.length <= 30;
    大字を絞り込む();
    return 状態.大字全件.length;
  }

  function 大字を絞り込む() {
    var q = $("oazaFilter").value.trim();
    var list = q ? 状態.大字全件.filter(function (o) { return o.label.indexOf(q) >= 0; }) : 状態.大字全件;
    var 先頭 = q && !list.length ? "見つかりません" :
               q ? "選んでください（" + list.length + " / " + 状態.大字全件.length + " 件）" :
               "選んでください（" + 状態.大字全件.length + " 件）";
    選択肢($("selOaza"), list, 先頭);
    /* 絞り込みで選択中の大字が消えたら、選択も外します */
    if (状態.oazaId && !list.some(function (o) { return o.value === 状態.oazaId; })) 状態.oazaId = "";
    else $("selOaza").value = 状態.oazaId || "";
  }

  /* ---------- 描画 ---------- */
  function 描画() {
    if (データ未投入) {
      $("verdict").setAttribute("data-state", "none");
      $("verdictMark").textContent = "—";
      $("verdictText").textContent = "データが投入されていないため、判定できません。";
      $("report").textContent = DATA.meta.暫定データ警告.本文;
      ["btnCopy", "btnPrint", "btnSave", "btnKeep"].forEach(function (id) { $(id).disabled = true; });
      return;
    }
    var 例外 = 例外あり();
    $("addrField").classList.toggle("dimmed", 例外);
    ["selPref", "selCity", "selOaza"].forEach(function (id) { $(id).tabIndex = 例外 ? -1 : 0; });

    var res = Judge.judge({
      cityCode: 例外 ? "" : 状態.cityCode,
      oazaId: 例外 ? "" : 状態.oazaId,
      exceptions: 例外の状態()
    }, DATA);
    状態.res = res;

    /* 大字プルダウンの開け閉め（②で結論が出るなら閉じたままにする） */
    if (例外) {
      $("selOaza").disabled = true;
      $("oazaHint").textContent = "例外ルートに当てはまるため、住所による判定は行いません。";
      $("oazaHint").className = "hint strong";
    } else if (!状態.cityCode) {
      $("selOaza").disabled = true;
      $("oazaHint").textContent = "市町村を選ぶと、必要な場合だけ大字を選べるようになります。";
      $("oazaHint").className = "hint";
    } else if (res.不足 === "大字" || res.route === "区域判定") {
      $("selOaza").disabled = false;
      $("oazaHint").textContent = "この市町村は同じ市町村内でも住所によって結論が変わります。大字を選んでください。";
      $("oazaHint").className = "hint strong";
    } else {
      $("selOaza").disabled = true;
      $("oazaHint").textContent = "この市町村は住所によらず結論が決まるため、大字を選ぶ必要はありません。";
      $("oazaHint").className = "hint";
    }

    /* 判定 */
    var v = $("verdict");
    var 文 = {
      "対象": "特別交付税措置の対象となります。",
      "対象外": "特別交付税措置の対象となりません。",
      "要確認": "このツールでは判定できません。総務省又は島根県へ照会してください。",
      "入力待ち": res.不足 === "大字" ? "大字・町丁目を選んでください。" : "住所を選んでください。"
    };
    v.setAttribute("data-state", res.result === "入力待ち" ? "none" : res.result);
    $("verdictMark").textContent = res.result === "入力待ち" ? "—" : res.result;
    $("verdictText").textContent = 文[res.result] || "";

    /* 道すじ */
    道すじ(res, 例外);

    /* 注意事項 */
    var ul = $("warns");
    ul.innerHTML = "";
    (res.warnings || []).forEach(function (w) {
      var li = document.createElement("li");
      li.textContent = w;
      if (w.indexOf("決裁資料") >= 0 || w.indexOf("照会") >= 0) li.className = "severe";
      ul.appendChild(li);
    });

    /* 根拠テキスト */
    var 出せる = res.result !== "入力待ち";
    状態.txt = 出せる ? Report.build(res, DATA) : "";
    $("report").textContent = 出せる ? 状態.txt : "住所を選ぶか、例外ルートに印を付けると、ここに根拠テキストが出ます。";
    ["btnCopy", "btnPrint", "btnKeep"].forEach(function (id) { $(id).disabled = !出せる; });
    $("btnSave").disabled = !出せる || 埋め込み表示;
  }

  function 道すじ(res, 例外) {
    var s1 = $("step1"), s2 = $("step2"), s3 = $("step3");
    [s1, s2, s3].forEach(function (li) { li.className = ""; li.querySelector(".rs").textContent = "—"; });

    if (例外) {
      s1.className = "skip"; s1.querySelector(".rs").textContent = "例外ルートのため不要";
      s2.className = "skip"; s2.querySelector(".rs").textContent = "不要";
      s3.className = "skip"; s3.querySelector(".rs").textContent = "不要";
      return;
    }
    if (res.city) {
      s1.className = "on";
      s1.querySelector(".rs").textContent = Report.住所文(res);
    }
    if (res.区分キー) {
      s2.className = "on";
      s2.querySelector(".rs").textContent = (res.city.指定都市区分 !== "該当なし" ? "指定都市（" + res.city.指定都市区分 + "）" : res.city.区分) + "　記号 " + (res.symbol || "—");
    }
    if (res.symbol === "△") {
      s3.className = res.oaza ? "on" : "";
      s3.querySelector(".rs").textContent = res.oaza
        ? (res.oaza.境界跨ぎ ? "境界跨ぎのため確定できない" : res.oaza.区域判定 === "b" ? "条件不利区域(b)" : res.oaza.区域判定 === "c" ? "(b)以外＝(c)" : "指定の有無が未確認")
        : "大字の選択待ち";
    } else if (res.symbol) {
      s3.className = "skip";
      s3.querySelector(".rs").textContent = "不要（②で結論）";
    }
  }

  /* ---------- 履歴 ---------- */
  function 履歴読む() {
    try { return JSON.parse(localStorage.getItem(履歴キー) || "[]"); } catch (e) { return []; }
  }
  function 履歴書く(a) {
    try { localStorage.setItem(履歴キー, JSON.stringify(a)); return true; }
    catch (e) { トースト("このブラウザでは履歴を保存できません。", true); return false; }
  }
  function 履歴に残す() {
    var res = 状態.res;
    if (!res || res.result === "入力待ち") return;
    var a = 履歴読む();
    a.unshift({
      日時: Report.日時文字列(new Date()),
      見出し: Report.見出し(res),
      結論: res.result,
      本文: 状態.txt
    });
    if (a.length > 履歴上限) a.length = 履歴上限;
    if (履歴書く(a)) トースト("履歴に残しました（" + a.length + " 件）");
  }
  function 履歴を描く() {
    var a = 履歴読む(), box = $("historyList");
    box.innerHTML = "";
    if (!a.length) {
      var d = document.createElement("div");
      d.className = "empty"; d.textContent = "保存された判定はありません。";
      box.appendChild(d);
      return;
    }
    var ul = document.createElement("ul");
    ul.className = "plist";
    a.forEach(function (h, i) {
      var li = document.createElement("li");
      var nm = document.createElement("div");
      nm.className = "nm";
      var rr = document.createElement("span");
      rr.className = "rr " + h.結論; rr.textContent = h.結論;
      nm.appendChild(rr);
      nm.appendChild(document.createTextNode("　" + h.見出し.replace(/ → .*$/, "")));
      var sm = document.createElement("small");
      sm.textContent = h.日時;
      nm.appendChild(sm);
      li.appendChild(nm);

      var b1 = document.createElement("button");
      b1.className = "ic"; b1.type = "button"; b1.textContent = "本文をコピー";
      b1.onclick = function () { コピーする(h.本文); };
      li.appendChild(b1);

      var b2 = document.createElement("button");
      b2.className = "ic del"; b2.type = "button"; b2.textContent = "削除";
      b2.onclick = function () {
        var cur = 履歴読む(); cur.splice(i, 1); 履歴書く(cur); 履歴を描く();
      };
      li.appendChild(b2);
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  /* ---------- 出力 ---------- */
  function コピーする(txt) {
    if (!txt) return;
    var done = function () { トースト("コピーしました。"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { 旧式コピー(txt, done); });
    } else 旧式コピー(txt, done);
  }
  function 旧式コピー(txt, done) {
    var ta = document.createElement("textarea");
    ta.value = txt;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); }
    catch (e) { トースト("コピーできませんでした。本文を選んでコピーしてください。", true); }
    document.body.removeChild(ta);
  }
  function 保存する() {
    if (!状態.txt) return;
    try {
      var 名 = "地域要件判定_" + Report.日時文字列(new Date()).replace(/[-: ]/g, "") + ".txt";
      var blob = new Blob(["﻿" + 状態.txt], { type: "text/plain;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = 名;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      トースト("保存しました：" + 名);
    } catch (e) {
      トースト("保存できませんでした。コピーをお使いください。", true);
    }
  }
  function 印刷する() {
    if (!状態.txt) return;
    $("printArea").textContent = 状態.txt;
    window.print();
  }

  /* ---------- データ・出典ダイアログ ---------- */
  function 出典を描く() {
    var meta = DATA.meta, b = $("aboutBody");
    b.innerHTML = "";
    var h = function (t) { var e = document.createElement("h4"); e.textContent = t; b.appendChild(e); };
    var p = function (t, cls) { var e = document.createElement("p"); e.textContent = t; if (cls) e.className = cls; b.appendChild(e); };

    if (meta.dataStatus !== "verified") {
      p(meta.暫定データ警告.見出し + " " + meta.暫定データ警告.本文, "caution");
      p(meta.暫定データ警告.解除方法);
    }
    h("データ基準日");
    p(meta.基準日);
    h("収録している範囲");
    p(meta.収録範囲.注記);
    p("収録件数：市町村 " + DATA.d1.市町村.length + " 件／大字・町丁目 " + DATA.d2.大字.length + " 件");
    var 欠け = DATA.d1.市町村.filter(function (m) { return (m.該当法令 || []).some(function (l) { return ["過疎","山村","離島","半島"].indexOf(l) >= 0 && (m.照合済み法令 || []).indexOf(l) < 0; }); });
    if (欠け.length) p("区域一覧が未収録の法令がある市町村が " + 欠け.length + " 件あります。これらの市町村では、条件不利区域(b) に当たらないことまでは確かめられますが、(c) と言い切れないため「要確認」になります。");
    h("判定のしくみ");
    p("①住所から市町村を特定 → ②市町村マスタで区分を見る → ③一部条件不利地域のときだけ大字の区域(b/c)を見る、という順に判定します。転入地が全部条件不利地域(a)に固定されているため、確認表のうち「3大都市圏外／全部条件不利地域」の1列だけを参照しており、判定記号は ○・△・× の3種のみです。");
    h("出典");
    var ul = document.createElement("ul");
    meta.出典.forEach(function (s) {
      var li = document.createElement("li");
      li.appendChild(document.createTextNode(s.名称 + (s.現在日 ? "（" + s.現在日 + "現在）" : "") + " "));
      if (s.url) {
        var a = document.createElement("a");
        a.href = s.url; a.textContent = s.url; a.target = "_blank"; a.rel = "noreferrer noopener";
        li.appendChild(a);
      }
      ul.appendChild(li);
    });
    b.appendChild(ul);
    h("ライセンス");
    p(meta.ライセンス表記);
    h("この結果の位置づけ");
    p(meta.免責, "caution");
  }

  /* ---------- つなぎ込み ---------- */
  function 起動() {
    初期化();

    $("selPref").addEventListener("change", function () {
      状態.pref = this.value; 状態.cityCode = ""; 状態.oazaId = "";
      市町村を並べる();
      選択肢($("selOaza"), [], "選んでください");
      描画();
    });
    $("selCity").addEventListener("change", function () {
      状態.cityCode = this.value; 状態.oazaId = "";
      大字を並べる();
      描画();
    });
    $("selOaza").addEventListener("change", function () {
      状態.oazaId = this.value;
      描画();
    });
    $("oazaFilter").addEventListener("input", function () {
      大字を絞り込む();
      描画();
    });
    ["ex1", "ex2", "ex3"].forEach(function (id) { $(id).addEventListener("change", 描画); });

    $("btnClear").addEventListener("click", function () {
      状態 = { pref: "", cityCode: "", oazaId: "", res: null, txt: "", 大字全件: [] };
      $("selPref").value = "";
      選択肢($("selCity"), [], "選んでください"); $("selCity").disabled = true;
      選択肢($("selOaza"), [], "選んでください"); $("selOaza").disabled = true;
      $("oazaFilter").value = ""; $("oazaFilter").hidden = true;
      ["ex1", "ex2", "ex3"].forEach(function (id) { $(id).checked = false; });
      描画();
      トースト("入力をクリアしました。");
    });

    $("btnCopy").addEventListener("click", function () { コピーする(状態.txt); });
    $("btnSave").addEventListener("click", 保存する);
    $("btnPrint").addEventListener("click", 印刷する);
    $("btnKeep").addEventListener("click", 履歴に残す);

    $("btnHistory").addEventListener("click", function () { 履歴を描く(); $("dlgHistory").showModal(); });
    $("btnHistClose").addEventListener("click", function () { $("dlgHistory").close(); });
    $("btnHistClear").addEventListener("click", function () {
      if (!履歴読む().length) { トースト("履歴はありません。"); return; }
      if (!window.confirm("保存されている判定をすべて削除します。よろしいですか。")) return;
      履歴書く([]); 履歴を描く(); トースト("履歴をすべて削除しました。");
    });

    $("btnAbout").addEventListener("click", function () { 出典を描く(); $("dlgAbout").showModal(); });
    $("btnAboutClose").addEventListener("click", function () { $("dlgAbout").close(); });
  }

  /* レビュー用の埋め込み表示では、この時点で既に読み込みが終わっていることがあります。
     DOMContentLoaded を待つだけだと起動しないので、状態を見て分けます。 */
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", 起動);
  else 起動();
})();
