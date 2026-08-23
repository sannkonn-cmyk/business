/* ===========================================================
   国土数値情報の GeoJSON を読む

   対象:
     A17 過疎地域 / A18 半島振興対策実施地域 / A19 離島振興対策実施地域 / A24 振興山村

   zip のまま渡しても、展開済みの .geojson を渡しても読めます。
   属性の名前はデータセットごとに違うので、決め打ちにせず、
   読み込んだあとに「どんな属性があるか」を出して確かめられるようにしています。

   使い方（中身を確かめる）:
     node chiiki/tools/ingest/read-geojson.js <ファイル>

   全国ぶんは数十MBになることがあります。足りなければ
     node --max-old-space-size=4096 …
   で回してください。
   =========================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSZipを読む } = require("./read-isj.js");

/* GeoJSON の入れ物はいくつか形があるので、feature の配列にそろえます */
function 平らにする(o) {
  if (!o) return [];
  if (o.type === "FeatureCollection") return (o.features || []).filter((f) => f && f.geometry);
  if (o.type === "Feature") return o.geometry ? [o] : [];
  if (o.type === "GeometryCollection") return (o.geometries || []).map((g) => ({ type: "Feature", geometry: g, properties: {} }));
  if (o.type === "Polygon" || o.type === "MultiPolygon") return [{ type: "Feature", geometry: o, properties: {} }];
  return [];
}

async function read(ファイル) {
  let features = [];
  if (/\.zip$/i.test(ファイル)) {
    const JSZip = JSZipを読む();
    const z = await JSZip.loadAsync(fs.readFileSync(ファイル));
    const 名 = Object.keys(z.files).filter((n) => /\.(geojson|json)$/i.test(n) && !z.files[n].dir);
    if (!名.length) throw new Error("zip の中に .geojson がありません: " + ファイル);
    for (const n of 名) features = features.concat(平らにする(JSON.parse(await z.files[n].async("string"))));
  } else {
    features = 平らにする(JSON.parse(fs.readFileSync(ファイル, "utf8")));
  }
  return features;
}

/* 属性にどんな名前が使われているかを数えます（データセットごとに違うため） */
function 属性の様子(features, 上限) {
  const 数 = new Map();
  const 例 = new Map();
  features.forEach((f) => {
    Object.keys(f.properties || {}).forEach((k) => {
      数.set(k, (数.get(k) || 0) + 1);
      const v = f.properties[k];
      if (v !== null && v !== "" && !例.has(k)) 例.set(k, String(v));
    });
  });
  return [...数.entries()].sort((a, b) => b[1] - a[1]).slice(0, 上限 || 30)
    .map(([k, n]) => ({ 属性: k, 件数: n, 例: 例.get(k) || "" }));
}

/* 属性の中から、それらしい名前の値を拾います（データセット差を吸収するため） */
function 拾う(props, 候補) {
  if (!props) return "";
  for (const c of 候補) {
    for (const k of Object.keys(props)) {
      if (k === c || k.indexOf(c) >= 0) {
        const v = props[k];
        if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
      }
    }
  }
  return "";
}

module.exports = { read, 平らにする, 属性の様子, 拾う };

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error("使い方: node chiiki/tools/ingest/read-geojson.js <GeoJSONまたはzip>"); process.exit(1); }
  read(f).then((features) => {
    const 種 = {};
    features.forEach((x) => { const t = x.geometry.type; 種[t] = (種[t] || 0) + 1; });
    console.log("");
    console.log(`  ${path.basename(f)}: ${features.length.toLocaleString()} 件`);
    console.log("  形の種類:", Object.keys(種).map((k) => `${k} ${種[k]}`).join(" / "));
    console.log("");
    console.log("  属性:");
    console.log("    " + "属性名".padEnd(22) + "件数".padStart(8) + "  例");
    属性の様子(features).forEach((a) => {
      console.log("    " + a.属性.padEnd(22) + String(a.件数).padStart(8) + "  " + a.例.slice(0, 40));
    });
    console.log("");
    console.log("  この一覧を見て、市町村コード・旧市町村名・島名にあたる属性を");
    console.log("  add-polygon-laws.js の設定に書いてください。");
    console.log("");
  }).catch((e) => { console.error("  " + e.message); process.exit(1); });
}
