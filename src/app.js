/* ===========================================================
   公用文ジェネレーター — 画面の動き
   =========================================================== */
(function(){
"use strict";

var el = function(id){ return document.getElementById(id); };

/* ---------- 状態 ---------- */
var noMode = "num", sealMode = "omit", titleAlign = "center";
var store = { signs: [], froms: [] };
/* あとからWordで書き込むための空き行数（未確定事項#1の決定：固定値）。
   ただし、あて先や表題が長くて1ページに収まらないときは自動で減らす。 */
var BODY_ROWS = 10;
var KI_ROWS   = 8;

var STORE_KEY  = "kouyoubun.settings.v1";
var TMPL_KEY   = "kouyoubun.template.v1";
var customTmpl = null;   /* {name, b64} 差し替えたひな形 */

/* ---------- トースト ---------- */
var tTimer;
function toast(msg, warn){
  var t = el("toast");
  t.textContent = msg;
  t.classList.toggle("warn", !!warn);
  t.classList.add("show");
  clearTimeout(tTimer);
  tTimer = setTimeout(function(){ t.classList.remove("show"); }, 3600);
}

/* ---------- 保存・読み出し ---------- */
function loadStore(){
  try{
    var raw = localStorage.getItem(STORE_KEY);
    if(raw){
      var o = JSON.parse(raw);
      if(Array.isArray(o.signs)) store.signs = o.signs.filter(function(s){ return typeof s === "string"; });
      if(Array.isArray(o.froms)) store.froms = o.froms.filter(function(p){ return p && typeof p.l1 === "string"; });
    }
  }catch(e){ /* 壊れていたら初期状態で続行 */ }
}
function saveStore(){
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }catch(e){
    toast("設定を保存できませんでした。ブラウザの設定をご確認ください。", true);
  }
}
function loadTmpl(){
  try{
    var raw = localStorage.getItem(TMPL_KEY);
    if(raw){
      var o = JSON.parse(raw);
      if(o && o.b64) customTmpl = o;
    }
  }catch(e){ /* 無視 */ }
}

/* ---------- 日付 ---------- */
function eraYear(era, y){ return era === "令和" ? y - 2018 : y - 1988; }
function gregorianYear(){
  var y = Number(el("yy").value);
  if(!y) return null;
  return el("era").value === "令和" ? y + 2018 : y + 1988;
}
function setDate(y, m, d){
  var era = y >= 2019 ? "令和" : "平成";
  el("era").value = era;
  el("yy").value = eraYear(era, y);
  el("mm").value = m; el("dd").value = d;
  render();
}
function fiscalYear(){
  var n = new Date();
  return n.getMonth() + 1 >= 4 ? n.getFullYear() : n.getFullYear() - 1;
}

/* ---------- 小道具 ---------- */
function esc(s){ return String(s).replace(/[&<>]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]; }); }

/* 全角＝1、半角＝0.5 で数えた文字幅 */
function charWidth(s){
  var w = 0;
  for(var i = 0; i < s.length; i++){
    var c = s.charCodeAt(i);
    /* 半角英数・半角記号・半角カナ */
    w += (c <= 0x7F || (c >= 0xFF61 && c <= 0xFF9F)) ? 0.5 : 1;
  }
  return w;
}

function braceSVG(){
  return '<span class="brace" aria-hidden="true"><svg viewBox="0 0 20 100" preserveAspectRatio="none">' +
    '<path d="M3,3 C13,3 8,44 18,50 C8,56 13,97 3,97" fill="none" stroke="#1A1A1F" ' +
    'stroke-width="1.3" vector-effect="non-scaling-stroke" stroke-linecap="round"/></svg></span>';
}

/* 均等割り付け：渡した要素すべてを、一番長いものの幅にそろえる */
function kintoWari(nodes){
  nodes = Array.prototype.slice.call(nodes);
  if(!nodes.length) return;
  var max = 0;
  nodes.forEach(function(n){ n.style.width = "auto"; n.style.whiteSpace = "nowrap"; });
  nodes.forEach(function(n){ max = Math.max(max, n.offsetWidth); });
  nodes.forEach(function(n){ n.style.whiteSpace = "normal"; n.style.width = max + "px"; });
}

/* ---------- 入力値をひとまとめに取り出す ---------- */
function collect(){
  var v = function(id){ return el(id).value.trim(); };
  var names = el("to").value.split("\n").map(function(s){ return s.trim(); }).filter(Boolean);

  var docno = "";
  if(noMode === "jimu") docno = "事務連絡";
  else if(noMode === "num" && (v("sign") || v("num"))) docno = v("sign") + "第" + v("num") + "号";

  var y = v("yy"), m = v("mm"), d = v("dd"), dateStr = "";
  if(y && m && d){
    dateStr = el("era").value + (Number(y) === 1 ? "元" : Number(y)) + "年" + Number(m) + "月" + Number(d) + "日";
  }

  var contact = [];
  var head = [v("cSec"), v("cName")].filter(Boolean).join("　");
  if(v("cSec")) contact.push({ label: "", text: v("cSec") });
  if(v("cName")) contact.push({ label: "担当", text: v("cName") });
  if(v("cTel"))  contact.push({ label: "電話", text: v("cTel") });
  if(v("cMail")) contact.push({ label: "メール", text: v("cMail") });

  var useKi = el("ki").checked;
  return {
    docno: docno,
    date: dateStr,
    to: names,
    honor: el("honor").value,
    from1: v("from1"),
    from2: v("from2"),
    seal: sealMode === "stamp",
    title: v("title"),
    titleAlign: titleAlign,
    ki: useKi,
    contact: contact,
    contactHead: head
  };
}

/* Word出力と同じ計算で空き行数を決める（プレビューと出力をずらさないため） */
function planRows(D){
  if(window.Docx && window.Docx.planRows){
    var r = window.Docx.planRows(D, charWidth);
    return { body: r.body, ki: r.ki };
  }
  return { body: BODY_ROWS, ki: KI_ROWS };
}

/* ---------- プレビュー描画 ---------- */
function render(){
  var D = collect();

  el("numArea").style.display = (noMode === "num") ? "" : "none";

  /* 文書番号・日付：2行を同じ幅で均等割り付け */
  el("vDocno").innerHTML = D.docno ? '<span class="kinto">' + esc(D.docno) + "</span>" : "";
  el("vDate").innerHTML  = D.date  ? '<span class="kinto">' + esc(D.date)  + "</span>" : "";
  kintoWari(document.querySelectorAll(".p-nums .kinto"));

  /* あて先 */
  var vTo = el("vTo");
  if(D.to.length === 0){
    vTo.innerHTML = "";
  }else{
    var cells = D.to.map(function(n){ return '<div><span class="kinto">' + esc(n) + "</span></div>"; }).join("");
    var needBrace = D.to.length >= 2 && D.honor;
    vTo.innerHTML = '<div class="to-group"><div class="to-names">' + cells + "</div>" +
      (needBrace ? braceSVG() + '<div class="to-honor">' + esc(D.honor) + "</div>"
                 : (D.honor ? '<div class="to-honor">　' + esc(D.honor) + "</div>" : "")) + "</div>";
    kintoWari(vTo.querySelectorAll(".kinto"));
  }

  /* 発信者＋公印：2行を同じ幅で均等割り付け */
  var vFrom = el("vFrom"), html = "";
  if(D.from1) html += '<div class="line1"><span class="kinto">' + esc(D.from1) + "</span>" +
                      (D.seal ? '<span class="seal">公印</span>' : "") + "</div>";
  if(D.from2) html += '<div><span class="kinto">' + esc(D.from2) + "</span></div>";
  vFrom.innerHTML = html;
  kintoWari(vFrom.querySelectorAll(".kinto"));
  applyPaperVars();

  /* 表題 */
  el("vTitle").textContent = D.title;
  el("vTitle").className = "p-title" + (D.titleAlign === "left" ? " left" : "");
  el("vTitle").style.display = D.title ? "" : "none";

  /* 空き行（Word出力と同じ行数） */
  var rows = planRows(D);
  setRows(el("vBody"), rows.body);
  setRows(el("vKiBody"), D.ki ? rows.ki : 0);

  /* 記 */
  el("vKi").style.display = D.ki ? "" : "none";

  /* 連絡先 */
  var vc = el("vContact");
  var lines = D.contact.map(function(c){ return c.label ? c.label + "　" + c.text : c.text; });
  vc.textContent = lines.join("\n");
  vc.style.display = lines.length ? "" : "none";

  checkOverflow();
}

function setRows(node, rows){
  if(rows <= 0){ node.style.display = "none"; return; }
  node.style.display = "flex";
  node.style.height = (rows * 2) + "em";
}

/* 用紙幅から公印サイズと発信者の右インデントを実寸で決める */
function applyPaperVars(){
  var paper = el("paper");
  var w = paper.clientWidth || 1;
  /* padding を含まない用紙全体の幅を基準にする（A4＝210mm） */
  var full = paper.getBoundingClientRect().width;
  paper.style.setProperty("--sealW", sealMode === "stamp" ? (full * 28 / 210) + "px" : "0px");
  paper.style.setProperty("--fromIndent", (full * 10 / 210) + "px");
}
window.addEventListener("resize", function(){ applyPaperVars(); checkOverflow(); });

function checkOverflow(){
  var paper = el("paper");
  var over = paper.scrollHeight > paper.clientHeight + 2;
  el("warnOverflow").style.display = over ? "" : "none";
}

/* ---------- 操作：セグメントボタン ---------- */
function segGroup(attr, setter){
  var btns = document.querySelectorAll("[" + attr + "]");
  btns.forEach(function(b){
    b.addEventListener("click", function(){
      setter(b.getAttribute(attr));
      btns.forEach(function(x){ x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      render();
    });
  });
}
segGroup("data-no",   function(v){ noMode = v; });
segGroup("data-ta",   function(v){ titleAlign = v; });
segGroup("data-seal", function(v){ sealMode = v; });

document.querySelectorAll("input, select, textarea").forEach(function(n){
  n.addEventListener("input", render);
  n.addEventListener("change", render);
});

/* ---------- 日付の入力補助 ---------- */
el("qToday").addEventListener("click", function(){
  var n = new Date(); setDate(n.getFullYear(), n.getMonth() + 1, n.getDate());
});
el("q41").addEventListener("click", function(){ setDate(fiscalYear(), 4, 1); });
el("q331").addEventListener("click", function(){ setDate(fiscalYear() + 1, 3, 31); });
el("qClear").addEventListener("click", function(){
  el("yy").value = ""; el("mm").value = ""; el("dd").value = ""; render();
});

/* ---------- 登録：文書記号 ---------- */
function refreshSign(){
  var sel = el("signSel"), cur = sel.value;
  sel.innerHTML = '<option value="">登録した記号から選ぶ</option>';
  store.signs.forEach(function(s){
    var o = document.createElement("option");
    o.value = s; o.textContent = s; sel.appendChild(o);
  });
  sel.value = store.signs.indexOf(cur) >= 0 ? cur : "";
  el("signMng").disabled = store.signs.length === 0;
}
el("signAdd").addEventListener("click", function(){
  var s = el("sign").value.trim();
  if(!s){ toast("先に記号を入力してください。", true); return; }
  if(store.signs.indexOf(s) >= 0){ toast("「" + s + "」はすでに登録されています。"); return; }
  store.signs.push(s); saveStore(); refreshSign();
  toast("記号「" + s + "」を登録しました。次回からプルダウンで選べます。");
});
el("signSel").addEventListener("change", function(){
  if(this.value){ el("sign").value = this.value; render(); }
});

/* ---------- 登録：発信者セット ---------- */
function refreshFrom(){
  var sel = el("fromSel");
  sel.innerHTML = '<option value="">登録した発信者から選ぶ</option>';
  store.froms.forEach(function(p, i){
    var o = document.createElement("option");
    o.value = String(i); o.textContent = p.l1; sel.appendChild(o);
  });
  sel.value = "";
  el("fromMng").disabled = store.froms.length === 0;
}
function sameFrom(a, b){
  return a.l1 === b.l1 && a.l2 === b.l2 && a.sec === b.sec &&
         a.name === b.name && a.tel === b.tel && a.mail === b.mail;
}
el("fromAdd").addEventListener("click", function(){
  var v = function(id){ return el(id).value.trim(); };
  var p = { l1: v("from1"), l2: v("from2"), sec: v("cSec"), name: v("cName"), tel: v("cTel"), mail: v("cMail") };
  if(!p.l1){ toast("先に発信者の1行目を入力してください。", true); return; }
  var dup = store.froms.some(function(q){ return sameFrom(p, q); });
  if(dup){ toast("同じ内容がすでに登録されています。"); return; }
  store.froms.push(p); saveStore(); refreshFrom();
  toast("「" + p.l1 + "」を連絡先ごと登録しました。");
});
el("fromSel").addEventListener("change", function(){
  if(this.value === "") return;
  var p = store.froms[Number(this.value)];
  if(!p) return;
  el("from1").value = p.l1 || ""; el("from2").value = p.l2 || "";
  el("cSec").value = p.sec || ""; el("cName").value = p.name || "";
  el("cTel").value = p.tel || ""; el("cMail").value = p.mail || "";
  render();
});

/* ---------- 登録の管理ダイアログ ---------- */
var mngMode = "sign";
function openMng(mode){
  mngMode = mode;
  el("mngTitle").textContent = mode === "sign" ? "登録した文書記号の管理" : "登録した発信者の管理";
  el("mngHelp").textContent = mode === "sign"
    ? "並べ替えと削除ができます。並び順は、プルダウンに出てくる順番です。"
    : "並べ替えと削除ができます。1行目・2行目と連絡先がひとまとめで保存されています。";
  drawMng();
  el("dlgMng").showModal();
}
function drawMng(){
  var list = mngMode === "sign" ? store.signs : store.froms;
  var box = el("mngList");
  if(!list.length){ box.innerHTML = '<div class="empty">登録はまだありません。</div>'; return; }
  var ul = document.createElement("ul");
  ul.className = "plist";
  list.forEach(function(item, i){
    var li = document.createElement("li");
    var nm = document.createElement("div");
    nm.className = "nm";
    if(mngMode === "sign"){
      nm.textContent = item;
    }else{
      nm.textContent = item.l1;
      var sub = [item.l2, item.sec, item.name, item.tel, item.mail].filter(Boolean).join("／");
      if(sub){ var s = document.createElement("small"); s.textContent = sub; nm.appendChild(s); }
    }
    li.appendChild(nm);
    li.appendChild(mkIc("↑", "上へ移動", i === 0, function(){ swap(list, i, i - 1); }));
    li.appendChild(mkIc("↓", "下へ移動", i === list.length - 1, function(){ swap(list, i, i + 1); }));
    li.appendChild(mkIc("✕", "削除", false, function(){
      var label = mngMode === "sign" ? item : item.l1;
      if(!confirm("「" + label + "」を削除します。よろしいですか？")) return;
      list.splice(i, 1); afterMng();
    }, true));
    ul.appendChild(li);
  });
  box.innerHTML = "";
  box.appendChild(ul);
}
function mkIc(txt, label, disabled, fn, isDel){
  var b = document.createElement("button");
  b.type = "button"; b.className = "ic" + (isDel ? " del" : "");
  b.textContent = txt; b.title = label;
  b.setAttribute("aria-label", label);
  b.disabled = disabled;
  b.addEventListener("click", fn);
  return b;
}
function swap(list, a, b){ var t = list[a]; list[a] = list[b]; list[b] = t; afterMng(); }
function afterMng(){ saveStore(); refreshSign(); refreshFrom(); drawMng(); }

el("signMng").addEventListener("click", function(){ openMng("sign"); });
el("fromMng").addEventListener("click", function(){ openMng("from"); });

document.querySelectorAll("[data-close]").forEach(function(b){
  b.addEventListener("click", function(){ el(b.getAttribute("data-close")).close(); });
});

/* ---------- 設定の書き出し・読み込み ---------- */
el("btnBackup").addEventListener("click", function(){ el("dlgBackup").showModal(); });

function download(blob, filename){
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}

el("btnExport").addEventListener("click", function(){
  var data = { app: "公用文ジェネレーター", version: 1, signs: store.signs, froms: store.froms };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  var n = new Date();
  var pad = function(x){ return ("0" + x).slice(-2); };
  download(blob, "公用文ジェネレーター設定_" + n.getFullYear() + pad(n.getMonth() + 1) + pad(n.getDate()) + ".json");
  toast("設定を書き出しました。ダウンロードフォルダをご確認ください。");
});

el("btnImport").addEventListener("click", function(){ el("fileImport").click(); });
el("fileImport").addEventListener("change", function(){
  var f = this.files && this.files[0];
  this.value = "";
  if(!f) return;
  var r = new FileReader();
  r.onload = function(){
    var o;
    try{ o = JSON.parse(r.result); }
    catch(e){ toast("このファイルは読み込めませんでした。書き出したJSONファイルをお選びください。", true); return; }
    var added = 0;
    (Array.isArray(o.signs) ? o.signs : []).forEach(function(s){
      if(typeof s === "string" && s && store.signs.indexOf(s) < 0){ store.signs.push(s); added++; }
    });
    (Array.isArray(o.froms) ? o.froms : []).forEach(function(p){
      if(p && typeof p.l1 === "string" && p.l1 && !store.froms.some(function(q){ return sameFrom(p, q); })){
        store.froms.push({ l1:p.l1||"", l2:p.l2||"", sec:p.sec||"", name:p.name||"", tel:p.tel||"", mail:p.mail||"" });
        added++;
      }
    });
    saveStore(); refreshSign(); refreshFrom();
    toast(added ? added + "件を追加しました。" : "追加できる新しい登録はありませんでした。");
  };
  r.readAsText(f);
});

/* ---------- ひな形の確認・差し替え ---------- */
function drawTmplState(){
  el("tmplState").innerHTML = customTmpl
    ? "いま使っているひな形：<b>" + esc(customTmpl.name) + "</b>（差し替え済み）"
    : "いま使っているひな形：<b>同梱の標準ひな形</b>";
  el("btnTmplReset").disabled = !customTmpl;
}
el("btnTmpl").addEventListener("click", function(){ drawTmplState(); el("dlgTmpl").showModal(); });
el("btnTmplLoad").addEventListener("click", function(){ el("fileTmpl").click(); });
el("fileTmpl").addEventListener("change", function(){
  var f = this.files && this.files[0];
  this.value = "";
  if(!f) return;
  if(!/\.docx$/i.test(f.name)){ toast("Wordのファイル（.docx）をお選びください。", true); return; }
  var r = new FileReader();
  r.onload = function(){
    var b64 = String(r.result).split(",")[1] || "";
    try{
      localStorage.setItem(TMPL_KEY, JSON.stringify({ name: f.name, b64: b64 }));
      customTmpl = { name: f.name, b64: b64 };
      drawTmplState();
      toast("ひな形を「" + f.name + "」に差し替えました。");
    }catch(e){
      toast("ひな形を保存できませんでした。ファイルが大きすぎる可能性があります。", true);
    }
  };
  r.readAsDataURL(f);
});
el("btnTmplReset").addEventListener("click", function(){
  localStorage.removeItem(TMPL_KEY);
  customTmpl = null;
  drawTmplState();
  toast("同梱の標準ひな形に戻しました。");
});

/* ---------- 出力 ---------- */
function outFilename(D){
  var y = gregorianYear(), m = el("mm").value, d = el("dd").value, stamp;
  var pad = function(x){ return ("0" + Number(x)).slice(-2); };
  if(y && m && d){ stamp = String(y) + pad(m) + pad(d); }
  else{
    var n = new Date();
    stamp = String(n.getFullYear()) + pad(n.getMonth() + 1) + pad(n.getDate());
  }
  var name = D.title || "公用文";
  name = name.replace(/[\\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  return stamp + "_" + (name || "公用文") + ".docx";
}

el("btnOut").addEventListener("click", function(){
  var D = collect();
  if(typeof window.Docx === "undefined"){
    toast("このビルドはWord出力を含んでいません（画面確認用）。", true);
    return;
  }
  var btn = this;
  btn.disabled = true;
  var b64 = customTmpl ? customTmpl.b64 : (window.__TEMPLATE_B64__ || "");
  window.Docx.build(b64, D, charWidth).then(function(blob){
    download(blob, outFilename(D));
    toast("Wordファイルを出力しました。ダウンロードフォルダをご確認ください。");
  }).catch(function(e){
    console.error(e);
    toast("出力に失敗しました：" + (e && e.message ? e.message : e), true);
  }).then(function(){ btn.disabled = false; });
});

el("btnClear").addEventListener("click", function(){
  if(!confirm("入力した内容をすべて消します。よろしいですか？\n（登録した記号・発信者は消えません）")) return;
  document.querySelectorAll("#numArea input[type=text], .form-body input[type=text], .form-body textarea")
    .forEach(function(n){ n.value = ""; });
  el("yy").value = ""; el("mm").value = ""; el("dd").value = "";
  el("signSel").value = ""; el("fromSel").value = "";
  el("ki").checked = false;
  render();
});

/* ---------- 起動 ---------- */
loadStore();
loadTmpl();
refreshSign();
refreshFrom();
var now = new Date();
setDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
/* 初回描画で幅が確定したあと、公印などの実寸をもう一度あわせる */
requestAnimationFrame(function(){ applyPaperVars(); render(); });

})();
