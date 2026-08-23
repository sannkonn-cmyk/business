#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
総務省「過疎地域市町村等一覧」PDF を中間CSVにする

  使い方:  python3 chiiki/tools/ingest/read_kaso_pdf.py [PDF] [出力CSV]

このスクリプトだけ Python です。本体（Node・依存なし）とは切り離してあり、
出力の中間CSVをリポジトリに残すので、pypdf が無い環境でも取り込みは再現できます。
PDF が新しい版に差し替わったときだけ、これを流し直してください。

  必要なもの:  pip install pypdf

  この環境の注意:
    システムの cryptography が壊れており、pypdf の読み込みが失敗します。
    この PDF は暗号化されていないので、次のように迂回してください。
      mkdir -p /tmp/stub && echo 'raise ImportError' > /tmp/stub/cryptography.py
      PYTHONPATH=/tmp/stub python3 chiiki/tools/ingest/read_kaso_pdf.py

読み取ったあと、総務省の公表値（885団体＝全部過疎713・一部過疎158・みなし過疎14）と
突き合わせ、合わなければ止めます。表の崩れに気づかないまま先へ進まないためです。
"""

import csv
import os
import re
import sys

# 総務省の公表値（令和4年4月1日現在）。版が変わったらここも直してください。
検算 = {"合計": 885, "全部過疎": 713, "一部過疎": 158, "みなし過疎": 14}

区分語 = ("全部過疎", "一部過疎", "みなし過疎")
行 = re.compile(r"^(\d+)\s+(\S+?[都道府県])\s+(\S+?)\s+(全部過疎|一部過疎|みなし過疎)\s*(.*)$")

# 1行の並びは
#   番号 県 市町村 【過疎区分(R4)】 【みなされる区域(R4)】 【旧法下の区分】 【旧法下の区域】
# です。旧法の情報が区域に混ざらないよう、区分語（または「非該当」）で切ります。
#   例) 193 岩手県 奥州市 一部過疎 衣川村、江刺市 一部過疎 江刺市が該当
#       →  区域 = 衣川村・江刺市 ／ 旧法 = 一部過疎
区切り = re.compile(r"(全部過疎|一部過疎|みなし過疎|非該当|卒業)")


def 読む(pdf):
    try:
        from pypdf import PdfReader
    except ImportError as e:
        sys.exit(f"  pypdf が読み込めません（{e}）。上の「この環境の注意」をご覧ください。")

    r = PdfReader(pdf)
    出 = []
    for 頁 in r.pages:
        for ln in (頁.extract_text() or "").split("\n"):
            m = 行.match(ln.strip())
            if not m:
                continue
            _, 県, 市, 区分, 尾 = m.groups()
            切 = 区切り.search(尾)
            旧法 = 切.group(1) if 切 else ""
            区域文 = 尾[: 切.start()] if 切 else 尾
            区域 = [x.strip() for x in re.split(r"[、,]", 区域文)]
            区域 = [x for x in 区域 if x]
            出.append({
                "都道府県名": 県,
                "市町村名": 市,
                "過疎区分": 区分,
                "みなされる区域": "|".join(区域),
                "旧法下の区分": 旧法,
            })
    return 出


def main():
    ここ = os.path.dirname(os.path.abspath(__file__))
    根 = os.path.dirname(os.path.dirname(ここ))          # chiiki/
    pdf = sys.argv[1] if len(sys.argv) > 1 else os.path.join(根, "data", "source", "過疎地域市町村等一覧_R4.4.1.pdf")
    出力 = sys.argv[2] if len(sys.argv) > 2 else os.path.join(根, "data", "source", "中間_過疎一覧.csv")

    if not os.path.exists(pdf):
        sys.exit(f"  PDF がありません: {pdf}")

    rows = 読む(pdf)
    数 = {w: sum(1 for r in rows if r["過疎区分"] == w) for w in 区分語}
    数["合計"] = len(rows)

    print("")
    print(f"  読み取り: {数['合計']} 団体"
          f"（全部過疎 {数['全部過疎']} / 一部過疎 {数['一部過疎']} / みなし過疎 {数['みなし過疎']}）")

    ずれ = [f"{k}: 読み取り {数[k]} / 公表値 {検算[k]}" for k in 検算 if 数[k] != 検算[k]]
    if ずれ:
        print("")
        for z in ずれ:
            print("  ちがい  " + z)
        sys.exit("\n  公表値と合いません。表の読み取りが崩れている可能性があります。中止しました。\n")

    欠 = [r for r in rows if r["過疎区分"] == "一部過疎" and not r["みなされる区域"]]
    if 欠:
        sys.exit(f"\n  一部過疎なのに区域が読めていない団体が {len(欠)} 件あります: "
                 f"{[(r['都道府県名'], r['市町村名']) for r in 欠[:5]]}\n")

    区域数 = sum(len(r["みなされる区域"].split("|")) for r in rows if r["みなされる区域"])
    print(f"  一部過疎の区域（旧市町村）: {区域数} 件")

    with open(出力, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, ["都道府県名", "市町村名", "過疎区分", "みなされる区域", "旧法下の区分"])
        w.writeheader()
        w.writerows(rows)
    print(f"\n  出力: {os.path.relpath(出力)}")
    print("  公表値と一致しました。中間CSVを目で確かめてから match-by-prefix.js を流してください。\n")


if __name__ == "__main__":
    main()
