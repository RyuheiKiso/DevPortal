#!/usr/bin/env python3
"""Merge framework/typescript catalog-info.yaml entries into Backstage app-config.yaml.

Backstage の default URL reader は file:// スキームを扱えず、REST API 経由の location
登録ではローカルファイルを読めない。本ヘルパーは app-config.yaml の
``catalog.locations`` に直接 ``type: file`` エントリを追記することで、再起動後の
FileLocationProcessor から確実に読み込めるようにする。

Outputs a single JSON line to stdout with the result summary so the caller
(register-all.ps1) can parse it cleanly::

    {"added": 17, "skipped": 0, "rules_added": ["Group", "Domain"]}
"""

# 標準ライブラリのみで完結 (Python 3.10+, PyYAML 6.x を前提)
import argparse
import json
import sys
from pathlib import Path

# PyYAML は Backstage setup の前提として既に Python 環境に導入済み
import yaml


def main() -> int:
    # コマンドライン引数定義 (caller の PowerShell が組み立てて渡す)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="編集対象の app-config.yaml の絶対パス")
    parser.add_argument("--catalog-root", required=True, help="catalog-info.yaml 群のルート (framework/typescript)")
    parser.add_argument(
        "--rel-paths",
        required=True,
        help="CatalogRoot からの相対パス (カンマ区切り、ex: owners.yaml,config/catalog-info.yaml,...)",
    )
    args = parser.parse_args()

    # 入力パスを Path オブジェクトに正規化
    config_path = Path(args.config)
    catalog_root = Path(args.catalog_root).resolve()
    # rel-paths は空要素を除外して trim
    rel_paths = [p.strip() for p in args.rel_paths.split(",") if p.strip()]

    # 既存 app-config.yaml を UTF-8 として読み込む (BOM 無し前提)
    with open(config_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}

    # 必要な階層を再帰的に確保する (catalog: -> rules / locations)
    catalog = cfg.setdefault("catalog", {})
    rules = catalog.setdefault("rules", [])
    # rules が空なら 1 件挿入 (Backstage デフォルトは少なくとも 1 件存在するはず)
    if not rules:
        rules.append({"allow": []})

    # Group / Domain が rules[0].allow に無ければ追記する
    # (owners.yaml に Group/Domain が含まれるため、これがないと取り込み時 rejected になる)
    allow_list = rules[0].setdefault("allow", [])
    rules_added: list[str] = []
    for kind in ("Group", "Domain"):
        if kind not in allow_list:
            allow_list.append(kind)
            rules_added.append(kind)

    # catalog.locations を取得 (未定義なら空配列)
    locations = catalog.setdefault("locations", [])
    # 既存エントリの target 値セット (重複検出用)
    existing_targets = {
        loc.get("target") for loc in locations if isinstance(loc, dict) and loc.get("target")
    }

    # 集計用カウンタ
    added_count = 0
    skipped_count = 0
    # 入力された相対パスをループして 1 件ずつマージする
    for rel in rel_paths:
        # CatalogRoot 配下の絶対パスを構築
        abs_path = (catalog_root / rel).resolve()
        # YAML 上はバックスラッシュをエスケープせず済むようフォワードスラッシュに統一する
        target = str(abs_path).replace("\\", "/")
        # 既存に同 target があれば SKIP として次へ
        if target in existing_targets:
            skipped_count += 1
            continue
        # 新規エントリを追記する (type は file、Backstage が FileLocationProcessor で消化する)
        locations.append({"type": "file", "target": target})
        added_count += 1

    # 編集済み構造を YAML に書き戻す
    # allow_unicode=True で日本語コメントが書き換えで化けないようにする (本ファイルにコメントは無いが念のため)
    # sort_keys=False でキー順序を可能な限り維持する (PyYAML はそれでも一部入れ替える可能性あり)
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(
            cfg,
            f,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
        )

    # 結果を JSON 1 行で出力 (caller がパースする)
    summary = {
        "added": added_count,
        "skipped": skipped_count,
        "rules_added": rules_added,
        "total_locations_after": len(locations),
    }
    print(json.dumps(summary, ensure_ascii=False))
    # 終了コード 0 (失敗時は例外発生で自然に非 0 になる)
    return 0


if __name__ == "__main__":
    sys.exit(main())
