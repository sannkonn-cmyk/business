#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
総務省「地域おこし協力隊及び地域プロジェクトマネージャーの
特別交付税措置に係る地域要件確認表」PDF を中間CSVにする

  使い方:  python3 chiiki/tools/ingest/read_kakuninhyou_pdf.py [PDF] [出力CSV]
  必要なもの:  pip install pypdf

この確認表は、全国すべての市町村について
  ・地方公共団体コード
  ・３大都市圏の内／外
  ・指定都市かどうか
  ・地域要件区分（都市地域 / 全部条件不利地域 / 一部条件不利地域）
を持っています。**判定フローのステップ②はこれ1枚で完成します。**
振興山村・離島・半島の一覧を別に集める必要はありません。

  この環境の注意:
    システムの cryptography が壊れているため、次のように迂回してください。
      mkdir -p /tmp/stub && echo 'raise ImportError' > /tmp/stub/cryptography.py
      PYTHONPATH=/tmp/stub python3 chiiki/tools/ingest/read_kakuninhyou_pdf.py

【指定都市の見分け方】
確認表は「３大都市圏」「指定都市」「条件不利地域」の3列に★を付けますが、
テキストに起こすと空欄が詰まって★の位置が分からなくなります。
そこで、★の数から次のように逆算します。

    指定都市 = ★の数 −（３大都市圏内なら1）−（条件不利地域なら1）

３大都市圏の内外と条件不利地域かどうかは、隣の「地域要件区分」の文言で分かるためです。

【人口減少率例外】
３大都市圏の11都府県に属しながら区分が「３大都市圏外」と書かれている市町村は、
人口減少率11％以上のため３大都市圏外として扱われる団体です（確認表 1.(1)）。
仕様書 §8 で入手方法が未確認とされていたリストは、ここから作れます。
"""

import csv
import os
import re
import sys

# ３大都市圏の11都府県（確認表 1.(1)）
三大都市圏 = {"11", "12", "13", "14", "21", "23", "24", "26", "27", "28", "29"}
区域法令 = ["過疎", "山村", "離島", "半島"]

行 = re.compile(
    r"^(\d{6})\s+(\S+?[都道府県])\s+(\S+?)\s*((?:★\s*)*)"
    r"(３大都市圏[内外])[\s　]*(都市地域|全部条件不利地域|一部条件不利地域)\s+([○△▲□×\s]+)$"
)

見出し = ["市町村コード", "都道府県名", "市町村名", "区分", "指定都市区分", "該当法令",
        "照合済み法令", "三大都市圏", "人口減少率例外", "区域の旧市町村", "備考"]


def 読む(pdf):
    try:
        from pypdf import PdfReader
    except ImportError as e:
        sys.exit(f"  pypdf が読み込めません（{e}）。上の「この環境の注意」をご覧ください。")

    r = PdfReader(pdf)
    rows, 読めなかった = [], []
    for pg in r.pages:
        for ln in (pg.extract_text() or "").split("\n"):
            ln = ln.strip()
            if not re.match(r"^\d{6}\s", ln):
                continue
            m = 行.match(ln)
            if not m:
                読めなかった.append(ln[:90])
                continue
            コード6, 県, 市, 星, 圏, 区分, 適否 = m.groups()
            コード = コード6[:5]
            星数 = 星.count("★")
            圏内 = 圏 == "３大都市圏内"
            条件不利 = 区分 != "都市地域"
            指定都市 = 星数 - (1 if 圏内 else 0) - (1 if 条件不利 else 0)
            rows.append({
                "市町村コード": コード,
                "都道府県名": 県,
                "市町村名": 市.replace("※", "").strip(),
                "区分": 区分,
                "_指定都市": 指定都市 >= 1,
                "_圏内": 圏内,
                "_卒業団体": "※" in 市,
                "_適否": " ".join(適否.split()),
            })
    return rows, 読めなかった


def main():
    ここ = os.path.dirname(os.path.abspath(__file__))
    根 = os.path.dirname(os.path.dirname(ここ))
    pdf = sys.argv[1] if len(sys.argv) > 1 else os.path.join(根, "data", "source", "地域要件確認表.pdf")
    出力 = sys.argv[2] if len(sys.argv) > 2 else os.path.join(根, "data", "source", "中間_市町村区分.csv")

    if not os.path.exists(pdf):
        sys.exit(f"  PDF がありません: {pdf}")

    rows, 読めなかった = 読む(pdf)
    if not rows:
        sys.exit("  1行も読めませんでした。表の書式が変わった可能性があります。")

    # 一部過疎の旧市町村名は、過疎一覧の側が持っています
    過疎区域 = {}
    過疎csv = os.path.join(根, "data", "source", "中間_過疎一覧.csv")
    if os.path.exists(過疎csv):
        with open(過疎csv, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r.get("みなされる区域"):
                    過疎区域[(r["都道府県名"], r["市町村名"])] = r["みなされる区域"]

    出 = []
    for r in rows:
        一部 = r["区分"] == "一部条件不利地域"
        # 確認表は「どの法令で条件不利か」までは書いていません。
        # 一部条件不利地域では区域(b/c)の判定が要るので、4法令すべてを候補として挙げ、
        # 一覧を投入できた法令だけを「照合済み法令」に立てます。
        # （判定エンジンは、覆えていなければ (c) を「要確認」に落とします）
        該当 = 区域法令 if 一部 else []
        指定都市区分 = "該当なし"
        if r["_指定都市"]:
            指定都市区分 = "条件不利地域を含む" if r["区分"] != "都市地域" else "条件不利地域を含まない"
        備考 = ["地域要件確認表による"]
        if r["_卒業団体"]:
            備考.append("過疎法の経過措置を受ける卒業団体")
        出.append({
            "市町村コード": r["市町村コード"],
            "都道府県名": r["都道府県名"],
            "市町村名": r["市町村名"],
            "区分": r["区分"],
            "指定都市区分": 指定都市区分,
            "該当法令": "|".join(該当),
            "照合済み法令": "",           # build-data.js が 取得記録.json から埋めます
            "三大都市圏": 1 if r["_圏内"] else 0,
            # 11都府県なのに「３大都市圏外」＝人口減少率11％以上の例外団体
            "人口減少率例外": 1 if (r["市町村コード"][:2] in 三大都市圏 and not r["_圏内"]) else 0,
            "区域の旧市町村": ("過疎:" + 過疎区域[(r["都道府県名"], r["市町村名"])].replace("|", "・"))
                            if (r["都道府県名"], r["市町村名"]) in 過疎区域 else "",
            "備考": "|".join(備考),
        })

    数 = {}
    for o in 出:
        数[o["区分"]] = 数.get(o["区分"], 0) + 1
    指定都市 = [o for o in 出 if o["指定都市区分"] != "該当なし"]
    例外 = [o for o in 出 if o["人口減少率例外"] == 1]
    圏内 = [o for o in 出 if o["三大都市圏"] == 1]

    print("")
    print(f"  読み取り: {len(出)} 団体")
    for k in ["都市地域", "全部条件不利地域", "一部条件不利地域"]:
        print(f"    {k:<9} {数.get(k, 0):>5} 件")
    print("")
    print(f"  ３大都市圏内 : {len(圏内)} 件")
    print(f"  指定都市     : {len(指定都市)} 件（実際は20市）")
    print(f"  人口減少率例外: {len(例外)} 件"
          + (f"  {'、'.join(o['都道府県名'] + o['市町村名'] for o in 例外[:6])}" if 例外 else ""))
    if len(例外) > 6:
        print(f"                 …ほか {len(例外) - 6} 件")

    if len(指定都市) != 20:
        print("")
        print(f"  警告: 指定都市が {len(指定都市)} 件です（20市のはず）。★の数からの逆算が合っていません。")
        print("        " + "、".join(o["市町村名"] for o in 指定都市[:25]))
    if 読めなかった:
        print("")
        print(f"  警告: 読めなかった行が {len(読めなかった)} 件あります:")
        for x in 読めなかった[:5]:
            print("    " + x)

    with open(出力, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, 見出し)
        w.writeheader()
        w.writerows(出)
    print("")
    print(f"  出力: {os.path.relpath(出力)}")
    print("")


if __name__ == "__main__":
    main()
