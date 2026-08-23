/* ===========================================================
   代表点をポリゴンに落とす

   国土数値情報（過疎地域 A17 / 半島 A18 / 離島 A19 / 振興山村 A24）の
   ポリゴンに、位置参照情報の大字代表点が入るかどうかを見ます。

   外部ライブラリは使いません。座標系は国土数値情報・位置参照情報とも
   世界測地系の緯度経度なので、投影変換も要りません。

   仕様書 §7-1 のとおり、代表点だけの判定には誤りの余地があります。
   そこで【緩衝帯】を設け、ポリゴンの境界から一定距離より近い点は
   内外にかかわらず「要確認」として返します。黙って誤るより、
   照会を促すほうが決裁資料としては安全だからです。
   =========================================================== */
"use strict";

const 既定 = {
  緩衝m: 300,        // 境界からこの距離より近ければ要確認
  格子度: 0.1        // 索引の升目（およそ11km）
};

/* ---------- 距離（数百mの範囲で使うので、平面近似で足ります） ---------- */
function 点と線分の距離m(緯, 経, a, b, cos緯) {
  const m度 = 111320;
  const x = 経 * cos緯 * m度, y = 緯 * m度;
  const x1 = a[0] * cos緯 * m度, y1 = a[1] * m度;
  const x2 = b[0] * cos緯 * m度, y2 = b[1] * m度;
  const dx = x2 - x1, dy = y2 - y1;
  const 長さ2 = dx * dx + dy * dy;
  let t = 長さ2 === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / 長さ2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = x1 + t * dx, py = y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

/* ---------- 環の内外（レイキャスティング） ---------- */
function 環の中か(緯, 経, 環) {
  let 中 = false;
  for (let i = 0, j = 環.length - 1; i < 環.length; j = i++) {
    const xi = 環[i][0], yi = 環[i][1], xj = 環[j][0], yj = 環[j][1];
    if ((yi > 緯) !== (yj > 緯) && 経 < ((xj - xi) * (緯 - yi)) / (yj - yi) + xi) 中 = !中;
  }
  return 中;
}

/* GeoJSON の Polygon は [外環, 穴, 穴, …] */
function 多角形の中か(緯, 経, 多角形) {
  if (!多角形.length || !環の中か(緯, 経, 多角形[0])) return false;
  for (let i = 1; i < 多角形.length; i++) if (環の中か(緯, 経, 多角形[i])) return false;  // 穴の中
  return true;
}

function 形の中か(緯, 経, 形) {
  if (!形) return false;
  if (形.type === "Polygon") return 多角形の中か(緯, 経, 形.coordinates);
  if (形.type === "MultiPolygon") return 形.coordinates.some((p) => 多角形の中か(緯, 経, p));
  return false;
}

/* 境界までの最短距離。緩衝帯の判定に使います。 */
function 境界までの距離m(緯, 経, 形) {
  if (!形) return Infinity;
  const cos緯 = Math.cos(緯 * Math.PI / 180);
  let 最短 = Infinity;
  const 環を見る = (環) => {
    for (let i = 0, j = 環.length - 1; i < 環.length; j = i++) {
      const d = 点と線分の距離m(緯, 経, 環[j], 環[i], cos緯);
      if (d < 最短) 最短 = d;
    }
  };
  const 多角形を見る = (p) => p.forEach(環を見る);
  if (形.type === "Polygon") 多角形を見る(形.coordinates);
  else if (形.type === "MultiPolygon") 形.coordinates.forEach(多角形を見る);
  return 最短;
}

/* ---------- 外接矩形と格子索引 ----------
   全国で19万点 × 数千ポリゴンを総当たりすると終わらないので、
   升目に区切って候補を絞ります。 */
function 外接矩形(形) {
  let 西 = Infinity, 東 = -Infinity, 南 = Infinity, 北 = -Infinity;
  const 環を見る = (環) => 環.forEach((c) => {
    if (c[0] < 西) 西 = c[0]; if (c[0] > 東) 東 = c[0];
    if (c[1] < 南) 南 = c[1]; if (c[1] > 北) 北 = c[1];
  });
  const 多角形を見る = (p) => p.forEach(環を見る);
  if (!形) return null;
  if (形.type === "Polygon") 多角形を見る(形.coordinates);
  else if (形.type === "MultiPolygon") 形.coordinates.forEach(多角形を見る);
  else return null;
  return { 西, 東, 南, 北 };
}

function 索引を作る(features, opts) {
  const 設定 = Object.assign({}, 既定, opts || {});
  const 格子 = new Map();
  const 余白 = 設定.緩衝m / 111320;   // 緩衝帯のぶんだけ升目を広く取る
  const 要素 = [];
  features.forEach((f, i) => {
    const 枠 = 外接矩形(f.geometry);
    if (!枠) return;
    要素.push({ f, 枠 });
    const g = 設定.格子度;
    for (let x = Math.floor((枠.西 - 余白) / g); x <= Math.floor((枠.東 + 余白) / g); x++) {
      for (let y = Math.floor((枠.南 - 余白) / g); y <= Math.floor((枠.北 + 余白) / g); y++) {
        const k = x + ":" + y;
        if (!格子.has(k)) 格子.set(k, []);
        格子.get(k).push(要素.length - 1);
      }
    }
  });
  return { 格子, 要素, 設定 };
}

/**
 * 点がどのポリゴンに入るかを引きます。
 * @returns {{当たり: Object|null, 境界近い: boolean, 境界までm: number}}
 *   当たり     … 入っていた feature（複数入る場合は最初の1つ）
 *   境界近い   … 緩衝帯の中。内外にかかわらず要確認にしてください
 */
function 引く(索引, 緯, 経) {
  const g = 索引.設定.格子度;
  const 候補 = 索引.格子.get(Math.floor(経 / g) + ":" + Math.floor(緯 / g)) || [];
  const 余白度 = 索引.設定.緩衝m / 111320;
  let 当たり = null, 最短 = Infinity;
  for (const i of 候補) {
    const { f, 枠 } = 索引.要素[i];
    if (経 < 枠.西 - 余白度 || 経 > 枠.東 + 余白度 || 緯 < 枠.南 - 余白度 || 緯 > 枠.北 + 余白度) continue;
    if (!当たり && 形の中か(緯, 経, f.geometry)) 当たり = f;
    const d = 境界までの距離m(緯, 経, f.geometry);
    if (d < 最短) 最短 = d;
  }
  return { 当たり, 境界近い: 最短 < 索引.設定.緩衝m, 境界までm: 最短 === Infinity ? Infinity : Math.round(最短) };
}

module.exports = { 索引を作る, 引く, 形の中か, 多角形の中か, 環の中か, 境界までの距離m, 外接矩形, 既定 };
