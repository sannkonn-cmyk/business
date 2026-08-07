/* ===========================================================
   公用文ジェネレーター — Word（.docx）の組み立て

   ひな形（例文.docx）を読み込み、word/document.xml の <w:body> の
   中身だけを差し替えます。用紙・余白・行送りを決めている <w:sectPr> と、
   styles.xml / theme1.xml / fontTable.xml には手を触れません。
   （＝様式が改定されたら、ひな形を差し替えるだけで追随できます）

   単位のメモ
     twips : 1/1440 インチ。全角1文字（10.5pt）＝ 210 twips
     EMU   : 1mm = 36000 EMU、1pt = 12700 EMU、1twip = 635 EMU
     行送り: 18pt = 360 twips = 228600 EMU

   均等割り付けについて
     ひな形と同じ w:jc="distribute" 方式を使います。段落の使える幅を
     「そろえたい幅」ちょうどに絞り込み、その中で文字を均等に散らします。
     （w:fitText でも同じことができますが、Word以外のソフトでは無視されて
       ずれて見えるため、より素直に伝わる distribute を採用しています）
   =========================================================== */
(function(){
"use strict";

var TW_CHAR  = 210;      /* 全角1文字の幅（twips） */
var TW_LINE  = 360;      /* 行送り（twips） */
var EMU_LINE = 228600;   /* 行送り（EMU） */
var EMU_TW   = 635;      /* 1 twip = 635 EMU */
var BODY_W   = 8504;     /* 本文の段落幅（twips）＝150mm */

var IND_NUM_RIGHT  = 282;  /* 文書番号・日付の右インデント（ひな形どおり） */
var IND_FROM_RIGHT = 565;  /* 発信者名の右インデント（約9.97mm。ひな形どおり） */
var TW_BRACE_COL   = 630;  /* 波括弧の列幅＝全角3文字 */

/* あとからWordで書き込むための空き行数 */
var MIN_BODY_ROWS = 3;   /* 本文の空き行の下限（これ以下には減らさない） */
var KI_ROWS   = 8;    /* 記書き */

/* 1ページに入る行数 = (紙の高さ − 上余白 − 下余白) ÷ 行送り
   = (16838 − 1985 − 1701) ÷ 360 = 36行 */
var PAGE_LINES = 36;
/* 連絡先の枠（ひな形と同じ 60.1mm × 28.0mm）。中身が多いときは下へ伸ばす。 */
var TXBX_W    = 2162175;   /* 枠の幅（EMU） */
var TXBX_H    = 1009650;   /* 枠の高さの下限（EMU）＝28mm */
var TXBX_INS_X = 91440;    /* 枠の内側の余白（左右それぞれ） */
var TXBX_INS_Y = 45720;    /* 枠の内側の余白（上下それぞれ） */
/* 枠の中で文字が使える幅（twips）。全角にして約14.8文字ぶん。 */
var TXBX_INNER = Math.round((TXBX_W - TXBX_INS_X * 2) / EMU_TW);

var NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
var URI_WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";

/* ---------- XML の小道具 ---------- */
/* XMLに入れられない制御文字を落としたうえで & < > を実体参照にする */
function esc(s){
  return String(s == null ? "" : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function tw2emu(tw){ return Math.round(tw * EMU_TW); }

var FONTS = '<w:rFonts w:ascii="ＭＳ 明朝" w:eastAsia="ＭＳ 明朝" w:hAnsi="ＭＳ 明朝" w:hint="eastAsia"/>';

/* w:rPr の子要素は、OOXMLの定める順序どおりに並べる必要がある。
   （rFonts → noProof → color → spacing → kern → sz → szCs → fitText）
   順序を崩すとWordが「修復が必要です」と言い出すので、ここは触らないこと。 */
function rPr(o){
  o = o || {};
  var s = FONTS;
  if(o.noProof) s += "<w:noProof/>";
  if(o.color)   s += '<w:color w:val="' + o.color + '"/>';
  if(o.spacing) s += '<w:spacing w:val="' + o.spacing + '"/>';
  if(o.kern0)   s += '<w:kern w:val="0"/>';
  s += '<w:sz w:val="21"/><w:szCs w:val="22"/>';
  if(o.fit)     s += '<w:fitText w:val="' + o.fit.val + '" w:id="' + o.fit.id + '"/>';
  return "<w:rPr>" + s + "</w:rPr>";
}
function run(text, o){
  return "<w:r>" + rPr(o) + '<w:t xml:space="preserve">' + esc(text) + "</w:t></w:r>";
}
/* w:pPr も順序どおり（pStyle → snapToGrid → spacing → ind → jc → rPr） */
function para(pprInner, inner){
  return "<w:p><w:pPr>" + (pprInner || "") + rPr() + "</w:pPr>" + (inner || "") + "</w:p>";
}
function blank(pprInner){ return para(pprInner, ""); }
function repeat(n, s){ var a = []; for(var i = 0; i < n; i++) a.push(s); return a.join(""); }

/* 段落の使える幅を width ちょうどに絞って均等割り付けする。
   使える幅 ＝ 段落幅 − 右インデント − 1行目インデント */
function kintoPPr(width, rightInd, extra){
  var first = Math.max(0, BODY_W - rightInd - width);
  return (extra || "") +
    '<w:ind w:right="' + rightInd + '"' + (first ? ' w:firstLine="' + first + '"' : "") + "/>" +
    '<w:jc w:val="distribute"/>';
}

/* テキストボックスの中の段落。
   ひな形の既定は w:line="60"（＝行送り25%）で、行グリッドの効かない
   テキストボックスの中では行が重なってしまう。ここで1行送りに直す。 */
var TXBX_PPR = '<w:snapToGrid w:val="0"/><w:spacing w:line="240" w:lineRule="auto"/>';

/* ---------- 図形 ---------- */

/* 公印枠：28mm角・赤の実線。発信者名1行目の最後の文字に左半分を重ねる。 */
function sealShape(){
  /* 横：本文右端(8504−565 twips) から半文字(105 twips) 左へ */
  var leftEmu = tw2emu(BODY_W - IND_FROM_RIGHT - TW_CHAR / 2);
  var size    = 1008000;                            /* 28mm角 */
  var topEmu  = Math.round((EMU_LINE - size) / 2);  /* 行の上下中央 ≒ −389700 */

  return "<w:r>" + rPr({ noProof: true }) + "<w:drawing>" +
    '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" ' +
    'relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>' + leftEmu + "</wp:posOffset></wp:positionH>" +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>' + topEmu + "</wp:posOffset></wp:positionV>" +
    '<wp:extent cx="' + size + '" cy="' + size + '"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="101" name="公印枠"/><wp:cNvGraphicFramePr/>' +
    "<a:graphic " + NS_A + '><a:graphicData uri="' + URI_WPS + '">' +
    "<wps:wsp><wps:cNvSpPr/><wps:spPr>" +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="' + size + '" cy="' + size + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>' +
    '<a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>' +
    "</wps:spPr><wps:txbx><w:txbxContent>" +
    "<w:p><w:pPr>" + TXBX_PPR + '<w:jc w:val="center"/>' + rPr({ color: "FF0000" }) + "</w:pPr>" +
    run("公　印", { color: "FF0000" }) + "</w:p>" +
    "</w:txbxContent></wps:txbx>" +
    '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" ' +
    'bIns="45720" anchor="ctr" anchorCtr="0"><a:noAutofit/></wps:bodyPr>' +
    "</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>";
}

/* 波括弧：プリセット図形 rightBrace。あて先の行数ぶんの高さに伸ばす。
   あて先表の中央セル（上下中央そろえ）に浮かせて置き、そこから行の先頭まで
   戻して位置を合わせる。浮かせているので、行より背が高くてもはみ出さない。 */
function braceShape(lines){
  var h = lines * EMU_LINE;
  var w = 130000;                                       /* 全角1文字強 */
  /* 中央セルは上そろえにしてあるので、段落の先頭＝あて先1行目の先頭。
     そこから真下へ「行数×18pt」伸ばせば、ちょうど全行にかかる。 */
  var top  = 0;
  var left = Math.round((tw2emu(TW_BRACE_COL) - w) / 2);

  return "<w:r>" + rPr({ noProof: true }) + "<w:drawing>" +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="251661312" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>' + left + "</wp:posOffset></wp:positionH>" +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>' + top + "</wp:posOffset></wp:positionV>" +
    '<wp:extent cx="' + w + '" cy="' + h + '"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="102" name="波括弧"/><wp:cNvGraphicFramePr/>' +
    "<a:graphic " + NS_A + '><a:graphicData uri="' + URI_WPS + '">' +
    "<wps:wsp><wps:cNvSpPr/><wps:spPr>" +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm>' +
    '<a:prstGeom prst="rightBrace"><a:avLst/></a:prstGeom><a:noFill/>' +
    '<a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>' +
    "</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>" +
    "</wp:anchor></w:drawing></w:r>";
}

/* 見出しの均等割り付け（「担当」「電話」「メール」を3文字幅にそろえる）。
   ひな形と同じく、1文字ずつに字間を足して幅を合わせる。 */
function kintoLabel(label, targetTw, id){
  var chars = String(label).split("");
  var extra = Math.round(targetTw / chars.length - TW_CHAR);
  return chars.map(function(c, i){
    return run(c, {
      spacing: (i < chars.length - 1 && extra > 0) ? extra : 0,
      kern0: true,
      fit: { val: targetTw, id: id }
    });
  }).join("");
}

/* 枠の中で何行になるかの見積もり。長いメールアドレスは折り返る。 */
function contactLineCount(lines, cw){
  var n = 0;
  lines.forEach(function(c){
    /* 見出しは3文字幅にそろえてあり、そのあとに「：」が1文字 */
    var w = (c.label ? 4 : 0) + cw(c.text);
    n += Math.max(1, Math.ceil(w * TW_CHAR / TXBX_INNER));
  });
  return n;
}
/* 中身に必要な枠の高さ（EMU）。ひな形の28mmを下限とし、足りなければ下へ伸ばす。 */
function contactHeight(lines, cw){
  /* 4行なら 4×18pt＋上下余白 ＝ 1,005,840 EMU となり、ひな形の28mm（1,009,650）とほぼ一致する。
     つまりこの式は、ひな形の枠の作りをそのまま言い直したもの。 */
  return Math.max(TXBX_H, contactLineCount(lines, cw) * EMU_LINE + TXBX_INS_Y * 2);
}

/* 連絡先のテキストボックス：黒の実線枠、幅はひな形どおり60.1mm。
   高さは28mmを下限に、中身がはみ出さないところまで伸ばす。 */
function contactShape(lines, cw){
  var inner = lines.map(function(c){
    var body = c.label
      ? kintoLabel(c.label, TW_BRACE_COL, c.id) + run("：" + c.text)
      : run(c.text);
    return "<w:p><w:pPr>" + TXBX_PPR + rPr() + "</w:pPr>" + body + "</w:p>";
  }).join("");
  var cy = contactHeight(lines, cw);

  return "<w:r>" + rPr({ noProof: true }) + "<w:drawing>" +
    '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" ' +
    'relativeHeight="251660288" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>3463290</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="' + TXBX_W + '" cy="' + cy + '"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="103" name="連絡先"/><wp:cNvGraphicFramePr/>' +
    "<a:graphic " + NS_A + '><a:graphicData uri="' + URI_WPS + '">' +
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>' +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="' + TXBX_W + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:solidFill><a:schemeClr val="lt1"/></a:solidFill>' +
    '<a:ln w="6350"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln>' +
    "</wps:spPr><wps:txbx><w:txbxContent>" + inner + "</w:txbxContent></wps:txbx>" +
    '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" ' +
    'bIns="45720" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr>' +
    "</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>";
}

/* ---------- あて先 ---------- */
/* 続きの行は1文字下がるぶん、幅を1文字ぶん多く見積もる */
function rowWidth(r, cw){ return (cw(r.text) + (r.cont ? 1 : 0)) * TW_CHAR; }
/* 幅を測るための文字列（続き行には下げぶんの全角スペースを足す） */
function rowSample(r){ return (r.cont ? "　" : "") + r.text; }

/* ---------- あて先の表 ---------- */
/* 罫線なし3列。中央・右のセルを上下中央にすることで、
   あて先が偶数行でも敬称がまん中に来ます。 */
function toTable(rows, honor, wName, cw, kinto){
  /* 長いあて先は列の中で折り返す。その折り返しも数えて波括弧の高さを決める。 */
  var lines = 0;
  rows.forEach(function(r){ lines += Math.max(1, Math.ceil(rowWidth(r, cw) / wName)); });

  var wHonor = Math.max(TW_CHAR, Math.ceil(cw(honor)) * TW_CHAR);
  var noBorder = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map(function(k){ return "<w:" + k + ' w:val="none" w:sz="0" w:space="0" w:color="auto"/>'; }).join("");

  /* 各行の行送りを18ptに固定 → 「行数×18pt」で作った波括弧とぴったり合う */
  var lineFix = '<w:snapToGrid w:val="0"/><w:spacing w:line="' + TW_LINE + '" w:lineRule="exact"/>';

  /* 続きの行（2行書きの2行目）は1文字下げるだけ。均等割り付けはかけない。
     ここで散らすと「代　表　取　締　役」のように間延びしてしまうため。 */
  var namesCell = rows.map(function(r){
    if(r.cont) return para(lineFix + '<w:ind w:firstLineChars="100" w:firstLine="' + TW_CHAR + '"/>', run(r.text));
    return kinto ? para(lineFix + '<w:jc w:val="distribute"/>', run(r.text))
                 : para(lineFix, run(r.text));
  }).join("");

  var tc = function(w, inner, mid){
    return "<w:tc><w:tcPr>" + '<w:tcW w:w="' + w + '" w:type="dxa"/>' +
      (mid ? '<w:vAlign w:val="center"/>' : "") + "</w:tcPr>" + inner + "</w:tc>";
  };

  return "<w:tbl><w:tblPr>" +
    '<w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblInd w:w="' + TW_CHAR + '" w:type="dxa"/>' +
    "<w:tblBorders>" + noBorder + "</w:tblBorders>" +
    '<w:tblLayout w:type="fixed"/>' +
    "<w:tblCellMar>" +
      '<w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
      '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>' +
    "</w:tblCellMar>" +
    "</w:tblPr>" +
    "<w:tblGrid>" +
      '<w:gridCol w:w="' + wName + '"/><w:gridCol w:w="' + TW_BRACE_COL + '"/>' +
      '<w:gridCol w:w="' + wHonor + '"/>' +
    "</w:tblGrid>" +
    "<w:tr>" +
      tc(wName, namesCell, false) +
      tc(TW_BRACE_COL, para(lineFix, braceShape(lines)), false) +
      tc(wHonor, para(lineFix, run(honor)), true) +
    "</w:tr></w:tbl>";
}

/* ---------- 1ページに収めるための行数の計算 ---------- */
/* あて先や表題が長いと、そのぶん下がつかえる。空き行を自動で減らして
   「体裁だけの状態」が必ず1ページに収まるようにする。
   利用者があとから本文を書き足せば、そこから自然に次ページへ伸びる。 */
function countLines(text, width, cw){
  return Math.max(1, Math.ceil(cw(text) * TW_CHAR / width));
}
function planRows(D, cw){
  var used = 0;

  if(D.docno) used += 1;
  if(D.date)  used += 1;
  if(D.docno || D.date) used += 1;               /* 空行 */

  if(D.to.length && D.toEntries <= 1){
    used += D.to.length + 1;                     /* あて先（2行書きなら2行）＋空行 */
  }else if(D.to.length){
    var wHonor = D.honor ? Math.max(TW_CHAR, Math.ceil(cw(D.honor)) * TW_CHAR) : 0;
    var limit  = BODY_W - TW_CHAR - (D.honor ? TW_BRACE_COL + wHonor : 0);
    var wName  = 0;
    D.to.forEach(function(r){ wName = Math.max(wName, cw(rowSample(r))); });
    wName = Math.min(Math.ceil(wName) * TW_CHAR, limit) || TW_CHAR;
    D.to.forEach(function(r){ used += countLines(rowSample(r), wName, cw); });
    used += 1;                                   /* 空行 */
  }

  if(D.from1) used += 1;
  if(D.from2) used += 1;
  if(D.title) used += 1 + countLines(D.title, BODY_W, cw);  /* 空行＋表題 */
  used += 1;                                     /* 本文の前の空行 */

  if(D.ki) used += 1 + 1 + KI_ROWS;              /* 空行＋「記」＋記書きの空き行 */
  /* 連絡先は「空行1行＋枠の高さぶん」。枠が伸びたらそのぶん多く確保する。 */
  if(D.contact.length) used += 1 + Math.max(4, contactLineCount(D.contact, cw));

  /* 残りは全部、本文の空き行にあてる。こうすると体裁だけの状態でちょうど
     1ページ分になり、連絡先の枠も自然に用紙の下のほうへ落ち着く。 */
  var room = PAGE_LINES - used;
  return {
    body: Math.max(MIN_BODY_ROWS, room),
    ki: KI_ROWS,
    fits: room >= MIN_BODY_ROWS
  };
}

/* ---------- 本体の組み立て ---------- */
function buildBody(D, cw){
  var out = [];
  var rows = planRows(D, cw);
  /* 均等割り付けの基準幅（twips）＝ そのグループで一番長い行 */
  /* 均等割り付けの基準幅。
     半角文字の実寸はフォントによって変わる（ＭＳ明朝はちょうど全角の半分だが、
     代替フォントではもう少し広い）。使える幅が足りないと折り返してしまうので、
     文字単位に切り上げたうえ、半角を含む行があるときは全角1文字ぶん余裕を足す。 */
  var hasHalf = function(s){ return /[\u0000-\u00FF\uFF61-\uFF9F]/.test(s || ""); };
  var groupWidth = function(arr, limit){
    var m = 0, half = false;
    arr.forEach(function(s){
      if(!s) return;
      m = Math.max(m, cw(s));
      if(hasHalf(s)) half = true;
    });
    if(!m) return 0;
    return Math.min((Math.ceil(m) + (half ? 1 : 0)) * TW_CHAR, limit);
  };

  /* --- 文書番号・発信年月日：右寄せ、2行を同じ幅に均等割り付け --- */
  var wNum = groupWidth([D.docno, D.date], BODY_W - IND_NUM_RIGHT);
  var numPPr = kintoPPr(wNum, IND_NUM_RIGHT);
  if(D.docno) out.push(para(numPPr, run(D.docno)));
  if(D.date)  out.push(para(numPPr, run(D.date)));
  if(D.docno || D.date) out.push(blank('<w:jc w:val="right"/>'));

  /* --- あて先 --- */
  if(D.to.length && D.toEntries <= 1){
    /* 1件（2行書きを含む）のときは波括弧を出さず、
       最後の行の右に全角1つ空けて敬称を置く。
       続きの行は、あて先全体の1文字下げに加えてもう1文字下げる。 */
    var last = D.to.length - 1;
    D.to.forEach(function(r, i){
      var text = r.text + (i === last && D.honor ? "　" + D.honor : "");
      var ind = r.cont
        ? '<w:ind w:firstLineChars="200" w:firstLine="' + (TW_CHAR * 2) + '"/>'
        : '<w:ind w:firstLineChars="100" w:firstLine="' + TW_CHAR + '"/>';
      out.push(para(ind, run(text)));
    });
    out.push(blank(""));
  }else if(D.to.length){
    var wHonor = D.honor ? Math.max(TW_CHAR, Math.ceil(cw(D.honor)) * TW_CHAR) : 0;
    /* 表全体が本文の幅からはみ出さないよう、あて先の列幅に上限をかける */
    var limit = BODY_W - TW_CHAR - (D.honor ? TW_BRACE_COL + wHonor : 0);
    var wName = groupWidth(D.to.map(rowSample), limit);

    /* 均等割り付けは連名のときだけ。画面で「そろえない」を選べば止められる。 */
    var kinto = D.toKinto !== "off";

    if(D.honor){
      out.push(toTable(D.to, D.honor, wName, cw, kinto));
    }else{
      /* 敬称なし：波括弧も敬称の列も出さない。 */
      D.to.forEach(function(r){
        if(r.cont){
          out.push(para('<w:ind w:firstLineChars="200" w:firstLine="' + (TW_CHAR * 2) + '"/>', run(r.text)));
        }else if(kinto){
          out.push(para(kintoPPr(wName, BODY_W - TW_CHAR - wName), run(r.text)));
        }else{
          out.push(para('<w:ind w:firstLineChars="100" w:firstLine="' + TW_CHAR + '"/>', run(r.text)));
        }
      });
    }
    out.push(blank(""));
  }

  /* --- 発信者名：右寄せ、1行目・2行目を同じ幅に均等割り付け --- */
  var wFrom = groupWidth([D.from1, D.from2], BODY_W - IND_FROM_RIGHT);
  var fromPPr = kintoPPr(wFrom, IND_FROM_RIGHT);
  if(D.from1) out.push(para(fromPPr, (D.seal ? sealShape() : "") + run(D.from1)));
  if(D.from2) out.push(para(fromPPr, run(D.from2)));

  /* --- 表題 --- */
  if(D.title){
    out.push(blank('<w:ind w:right="-1"/><w:jc w:val="both"/>'));
    var tPPr = (D.titleAlign === "left")
      ? '<w:ind w:right="-1" w:firstLineChars="300" w:firstLine="630"/>'
      : '<w:ind w:right="-1"/><w:jc w:val="center"/>';
    /* 字間を0.25文字（＝2.625pt＝52/20pt）広げる */
    out.push(para(tPPr, run(D.title, { spacing: 52 })));
  }

  /* --- 本文：あとから書き込むための空き行 --- */
  out.push(blank('<w:ind w:right="-1"/>'));
  out.push(repeat(rows.body, blank('<w:ind w:left="2" w:right="-1" w:firstLineChars="100" w:firstLine="210"/>')));

  /* --- 記書き --- */
  if(D.ki){
    out.push(blank(""));
    out.push(para('<w:pStyle w:val="af1"/>', run("記")));
    out.push(repeat(rows.ki, blank("")));
  }

  /* --- 連絡先 --- */
  if(D.contact.length){
    var lines = D.contact.map(function(c, i){ return { label: c.label, text: c.text, id: 1010 + i }; });
    out.push(blank(""));
    out.push(para('<w:pStyle w:val="af3"/>', contactShape(lines, cw)));
  }

  var xml = out.join("");
  /* 本文が空でも <w:body> には段落が1つ必要 */
  return xml || blank("");
}

/* ---------- ひな形に差し込んで .docx を作る ---------- */

/* ひな形には作成時のレビューコメントが残っている。そのまま持ち出すと
   作る文書すべてにコメントが同梱されてしまうので、関連部品ごと取り除く。 */
/* JSZip は既定でフォルダ項目も作るが、Wordのひな形には無いので作らせない */
var NO_FOLDERS = { createFolders: false };

var COMMENT_PARTS = ["comments.xml", "commentsExtended.xml", "commentsIds.xml",
                     "commentsExtensible.xml", "people.xml"];
function stripComments(zip){
  var present = COMMENT_PARTS.filter(function(n){ return !!zip.file("word/" + n); });
  if(!present.length) return Promise.resolve();
  present.forEach(function(n){ zip.remove("word/" + n); });

  var jobs = [];
  var rels = zip.file("word/_rels/document.xml.rels");
  if(rels) jobs.push(rels.async("string").then(function(x){
    present.forEach(function(n){
      x = x.replace(new RegExp('<Relationship[^>]*Target="' + n + '"[^>]*/>', "g"), "");
    });
    zip.file("word/_rels/document.xml.rels", x, NO_FOLDERS);
  }));
  var ct = zip.file("[Content_Types].xml");
  if(ct) jobs.push(ct.async("string").then(function(x){
    present.forEach(function(n){
      x = x.replace(new RegExp('<Override[^>]*PartName="/word/' + n + '"[^>]*/>', "g"), "");
    });
    zip.file("[Content_Types].xml", x, NO_FOLDERS);
  }));
  return Promise.all(jobs);
}

function b64ToBytes(b64){
  var bin = atob(b64), n = bin.length, a = new Uint8Array(n);
  for(var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
  return a;
}

function build(templateB64, D, cw){
  return Promise.resolve().then(function(){
    if(!templateB64) throw new Error("ひな形が読み込めませんでした。");
    if(typeof JSZip === "undefined") throw new Error("ZIPライブラリが読み込めませんでした。");

    return JSZip.loadAsync(b64ToBytes(templateB64)).then(function(zip){
      var f = zip.file("word/document.xml");
      if(!f) throw new Error("ひな形の中身が想定と違います（word/document.xml がありません）。");
      return f.async("string").then(function(xml){
        var i = xml.indexOf("<w:body>");
        var j = xml.lastIndexOf("<w:sectPr");
        if(i < 0 || j < 0) throw new Error("ひな形の中身が想定と違います（本文の位置が特定できません）。");

        /* <w:body> と <w:sectPr> の間だけを差し替える。
           <w:sectPr>（用紙・余白・行送り）はひな形のまま残します。 */
        var head = xml.slice(0, i + "<w:body>".length);
        var tail = xml.slice(j);
        zip.file("word/document.xml", head + buildBody(D, cw) + tail, NO_FOLDERS);

        return stripComments(zip);
      }).then(function(){
        return zip.generateAsync({
          type: "blob",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          compression: "DEFLATE",
          compressionOptions: { level: 6 }
        });
      });
    });
  });
}

window.Docx = { build: build, buildBody: buildBody, planRows: planRows };

})();
