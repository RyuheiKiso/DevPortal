// このファイルは Backstage のソースファイルにプラグイン登録用マーカーを挿入・管理する
// AST 解析を避け、マーカーコメントで挟む領域へ行単位で安全に挿入・削除を行う

// 標準ライブラリのフォーマットトレイトをインポートする
use std::fmt;

// PluginKind: プラグインの適用対象（フロントエンド / バックエンド）を表す列挙型
// Tauri Channel 経由で JSON 転送するため Serialize/Deserialize も実装する
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
// JSON シリアライズ時に snake_case のキーを使用する（frontend / backend）
#[serde(rename_all = "snake_case")]
pub enum PluginKind {
    // packages/app/src/App.tsx に追加するフロントエンドプラグイン
    Frontend,
    // packages/backend/src/index.ts に追加するバックエンドプラグイン
    Backend,
}

// PluginRegistration: マーカー間に挿入するプラグイン登録情報を表す構造体
#[derive(Debug, Clone)]
pub struct PluginRegistration {
    // npm パッケージ名（例: @backstage/plugin-kubernetes）
    pub package_name: String,
    // App.tsx に追加するインポート行（Frontend のみ使用、Backend は空文字でよい）
    pub import_line: String,
    // App.tsx のルート JSX またはindex.ts の backend.add() 行
    pub register_line: String,
}

// MarkerError: マーカー操作で発生しうるエラーを表す列挙型
#[derive(Debug)]
pub enum MarkerError {
    // マーカーの挿入位置が特定できなかった（ユーザーが大幅にファイルを変更した場合など）
    CannotLocate(String),
    // 同名プラグインが既にマーカー内に登録済み（冪等性チェック）
    AlreadyRegistered(String),
}

// MarkerError を人間が読めるメッセージに変換する Display 実装
impl fmt::Display for MarkerError {
    // フォーマッタにエラーメッセージを書き込む
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // エラーの種類ごとに適切なメッセージを返す
        match self {
            // 挿入位置不明の場合は詳細メッセージを含める
            MarkerError::CannotLocate(msg) => {
                write!(f, "マーカー挿入位置が特定できません: {}", msg)
            }
            // 登録済みの場合はパッケージ名を含める
            MarkerError::AlreadyRegistered(name) => {
                write!(f, "プラグイン '{}' は既に登録されています", name)
            }
        }
    }
}

// フロントエンド App.tsx 用インポート領域の開始マーカー
const FRONTEND_IMPORT_START: &str = "// devportal:plugin-imports:start";
// フロントエンド App.tsx 用インポート領域の終了マーカー
const FRONTEND_IMPORT_END: &str = "// devportal:plugin-imports:end";
// フロントエンド App.tsx 用ルート領域の開始マーカー（JSX コメント形式）
const FRONTEND_ROUTE_START: &str = "{/* devportal:plugin-routes:start */}";
// フロントエンド App.tsx 用ルート領域の終了マーカー（JSX コメント形式）
const FRONTEND_ROUTE_END: &str = "{/* devportal:plugin-routes:end */}";
// バックエンド index.ts 用領域の開始マーカー
const BACKEND_START: &str = "// devportal:plugin-backend:start";
// バックエンド index.ts 用領域の終了マーカー
const BACKEND_END: &str = "// devportal:plugin-backend:end";

// ファイル内にマーカーが存在しない場合、適切な位置に挿入して返す（冪等）
// 既にマーカーが存在する場合はソースをそのまま返す
pub fn ensure_markers(source: &str, kind: &PluginKind) -> Result<String, MarkerError> {
    // プラグイン種別に応じて適切なマーカー挿入処理に振り分ける
    match kind {
        // フロントエンド向けのマーカー挿入処理を呼ぶ
        PluginKind::Frontend => ensure_markers_frontend(source),
        // バックエンド向けのマーカー挿入処理を呼ぶ
        PluginKind::Backend => ensure_markers_backend(source),
    }
}

// フロントエンド App.tsx にマーカーを挿入する内部関数
fn ensure_markers_frontend(source: &str) -> Result<String, MarkerError> {
    // インポートマーカーと ルートマーカーの両方が存在するか確認する
    let has_import_markers = source.contains(FRONTEND_IMPORT_START);
    // ルートマーカーの存在確認（スペース有無を吸収するため trim 比較は行ごとに行う）
    let has_route_markers = source.contains(FRONTEND_ROUTE_START);

    // 両方のマーカーが既に存在する場合はそのまま返す
    if has_import_markers && has_route_markers {
        return Ok(source.to_string());
    }

    // ソースを行の配列に分解する
    let lines: Vec<&str> = source.lines().collect();
    // 結果行ベクタを初期化する（後の挿入のために String に変換）
    let mut result: Vec<String> = lines.iter().map(|l| l.to_string()).collect();

    // インポートマーカーがまだない場合：最後の import 文の後に挿入する
    if !has_import_markers {
        // `import ` で始まる最後の行のインデックスを探す
        let last_import_idx = lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.trim_start().starts_with("import "))
            .map(|(i, _)| i)
            .last();

        // import 文が1行も見つからない場合はエラーを返す
        let insert_after = last_import_idx.ok_or_else(|| {
            MarkerError::CannotLocate("App.tsx に import 文が見つかりません".to_string())
        })?;

        // 終了マーカーを先に挿入してから開始マーカーを挿入する（行番号ずれを防ぐため逆順）
        result.insert(insert_after + 1, FRONTEND_IMPORT_END.to_string());
        // 開始マーカーを終了マーカーの前（insert_after + 1）に挿入する
        result.insert(insert_after + 1, FRONTEND_IMPORT_START.to_string());
    }

    // ルートマーカーがまだない場合：<FlatRoutes> または <Routes> の直後に挿入する
    if !has_route_markers {
        // インポートマーカー挿入後の状態を再構築して検索する
        let updated_source = result.join("\n");
        // 更新後のソースを行の配列に再分解する
        let updated_lines: Vec<&str> = updated_source.lines().collect();

        // <FlatRoutes> または <Routes> の開始タグを持つ行のインデックスを探す
        let routes_tag_idx = updated_lines
            .iter()
            .enumerate()
            .find(|(_, l)| {
                // 行をトリムして開始タグの有無を確認する
                let t = l.trim();
                // Backstage v1.x の FlatRoutes または標準の Routes タグを検出する
                t.starts_with("<FlatRoutes") || t.starts_with("<Routes")
            })
            .map(|(i, _)| i);

        // Routes タグが見つからない場合はエラーを返す
        let insert_after = routes_tag_idx.ok_or_else(|| {
            MarkerError::CannotLocate(
                "App.tsx に <FlatRoutes> または <Routes> タグが見つかりません".to_string(),
            )
        })?;

        // 更新後のソースを再度行ベクタとして結果に設定する
        result = updated_lines.iter().map(|l| l.to_string()).collect();
        // 終了マーカーを先に挿入する（逆順挿入でインデックスずれを防ぐ）
        result.insert(insert_after + 1, format!("  {}", FRONTEND_ROUTE_END));
        // 開始マーカーを挿入する
        result.insert(insert_after + 1, format!("  {}", FRONTEND_ROUTE_START));
    }

    // 行ベクタを改行で結合して最終ソースを作成する
    let mut out = result.join("\n");
    // 元のソースが末尾改行で終わっていた場合は改行を維持する
    if source.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    // 変換後のソースを返す
    Ok(out)
}

// バックエンド index.ts にマーカーを挿入する内部関数
fn ensure_markers_backend(source: &str) -> Result<String, MarkerError> {
    // 既にバックエンドマーカーが存在する場合はそのまま返す
    if source.contains(BACKEND_START) {
        return Ok(source.to_string());
    }

    // ソースを行の配列に分解する
    let lines: Vec<&str> = source.lines().collect();

    // `backend.start` を含む行のインデックスを探す
    let start_call_idx = lines
        .iter()
        .enumerate()
        .find(|(_, l)| l.trim().starts_with("backend.start"))
        .map(|(i, _)| i)
        .ok_or_else(|| {
            MarkerError::CannotLocate(
                "index.ts に backend.start() 呼び出しが見つかりません".to_string(),
            )
        })?;

    // 行ベクタを String ベクタに変換する
    let mut result: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
    // backend.start() の直前に空行・開始マーカー・終了マーカーを挿入する
    result.insert(start_call_idx, BACKEND_END.to_string());
    // 開始マーカーを終了マーカーの前に挿入する
    result.insert(start_call_idx, BACKEND_START.to_string());
    // 前後の可読性のために空行を挿入する
    result.insert(start_call_idx, String::new());

    // 行ベクタを改行で結合して最終ソースを作成する
    let mut out = result.join("\n");
    // 末尾改行を元のソースに合わせて維持する
    if source.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    // 変換後のソースを返す
    Ok(out)
}

// マーカー間にプラグイン登録コードを挿入する（冪等性チェック付き）
// 同名パッケージが既にマーカー間に存在する場合は AlreadyRegistered を返す
// （ファイル全体ではなくマーカー領域のみを検索することで誤検知を防ぐ）
pub fn insert_plugin(
    source: &str,
    registration: &PluginRegistration,
    kind: &PluginKind,
) -> Result<String, MarkerError> {
    // 冪等性チェック：プラグイン種別に応じたマーカー領域のみを検索する
    let already_registered = match kind {
        // フロントエンドはインポートマーカー間を検索する（ルートマーカーは不要、import 行の有無で判定する）
        PluginKind::Frontend => contains_in_marker_region(
            source,
            FRONTEND_IMPORT_START,
            FRONTEND_IMPORT_END,
            &registration.package_name,
        ),
        // バックエンドはバックエンドマーカー間を検索する
        PluginKind::Backend => contains_in_marker_region(
            source,
            BACKEND_START,
            BACKEND_END,
            &registration.package_name,
        ),
    };
    // マーカー間に同名パッケージが存在する場合は重複登録エラーを返す
    if already_registered {
        return Err(MarkerError::AlreadyRegistered(registration.package_name.clone()));
    }

    // プラグイン種別ごとの挿入処理に振り分ける
    match kind {
        // フロントエンド向けのプラグイン挿入処理を呼ぶ
        PluginKind::Frontend => insert_frontend_plugin(source, registration),
        // バックエンド向けのプラグイン挿入処理を呼ぶ
        PluginKind::Backend => insert_backend_plugin(source, registration),
    }
}

// 指定したマーカー間の行に needle が含まれているかを確認するヘルパー関数
// マーカー行自体は検索対象に含めない（境界を除くマーカー内部のみを対象とする）
fn contains_in_marker_region(
    source: &str,
    start_marker: &str,
    end_marker: &str,
    needle: &str,
) -> bool {
    // ソースを行に分解する
    let lines: Vec<&str> = source.lines().collect();

    // 開始マーカーの行インデックスを探す（見つからない場合は false を返す）
    let start_idx = match lines
        .iter()
        .enumerate()
        .find(|(_, l)| l.trim() == start_marker.trim())
        .map(|(i, _)| i)
    {
        // 開始マーカーが見つかった場合はインデックスを使用する
        Some(i) => i,
        // 見つからない場合は false を返す（マーカーがない状態は未登録と見なす）
        None => return false,
    };

    // 終了マーカーの行インデックスを探す（見つからない場合は false を返す）
    let end_idx = match lines
        .iter()
        .enumerate()
        .skip(start_idx + 1)
        .find(|(_, l)| l.trim() == end_marker.trim())
        .map(|(i, _)| i)
    {
        // 終了マーカーが見つかった場合はインデックスを使用する
        Some(i) => i,
        // 見つからない場合は false を返す
        None => return false,
    };

    // マーカー間の行（境界を除く）に needle が含まれているか確認する
    lines[start_idx + 1..end_idx].iter().any(|l| l.contains(needle))
}

// フロントエンド App.tsx にプラグインのインポート行とルート行を挿入する
fn insert_frontend_plugin(
    source: &str,
    registration: &PluginRegistration,
) -> Result<String, MarkerError> {
    // インポートマーカー間にインポート行を挿入する
    let source = insert_between(
        source,
        FRONTEND_IMPORT_START,
        FRONTEND_IMPORT_END,
        &registration.import_line,
    )?;
    // ルートマーカー間にルート行（インデント付き）を挿入する
    let indented_route = format!("    {}", registration.register_line);
    // ルートマーカー間にルート行を挿入した最終ソースを返す
    insert_between(
        &source,
        FRONTEND_ROUTE_START,
        FRONTEND_ROUTE_END,
        &indented_route,
    )
}

// バックエンド index.ts にプラグインの backend.add() 行を挿入する
fn insert_backend_plugin(
    source: &str,
    registration: &PluginRegistration,
) -> Result<String, MarkerError> {
    // バックエンドマーカー間に登録行を挿入する
    insert_between(source, BACKEND_START, BACKEND_END, &registration.register_line)
}

// 指定したマーカー間のコンテンツ末尾に1行を挿入するヘルパー関数
fn insert_between(
    source: &str,
    start_marker: &str,
    end_marker: &str,
    content: &str,
) -> Result<String, MarkerError> {
    // ソースを行の配列に分解する
    let lines: Vec<&str> = source.lines().collect();

    // 開始マーカーの行インデックスを探す（行をトリムして比較する）
    let start_idx = lines
        .iter()
        .enumerate()
        .find(|(_, l)| l.trim() == start_marker.trim())
        .map(|(i, _)| i)
        .ok_or_else(|| {
            MarkerError::CannotLocate(format!("開始マーカー '{}' が見つかりません", start_marker))
        })?;

    // 終了マーカーの行インデックスを探す（開始マーカーの後から検索する）
    let end_idx = lines
        .iter()
        .enumerate()
        .skip(start_idx + 1)
        .find(|(_, l)| l.trim() == end_marker.trim())
        .map(|(i, _)| i)
        .ok_or_else(|| {
            MarkerError::CannotLocate(format!("終了マーカー '{}' が見つかりません", end_marker))
        })?;

    // 行ベクタを String ベクタに変換する
    let mut result: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
    // 終了マーカーの直前（マーカー間の末尾）にコンテンツを挿入する
    result.insert(end_idx, content.to_string());

    // 行ベクタを改行で結合して最終ソースを作成する
    let mut out = result.join("\n");
    // 末尾改行を維持する
    if source.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    // 挿入後のソースを返す
    Ok(out)
}

// マーカー間からプラグイン名を含む行を削除する
// 削除対象のパッケージ名を含む行のみを除去し、マーカー外のコードは一切変更しない
pub fn remove_plugin(
    source: &str,
    plugin_name: &str,
    kind: &PluginKind,
) -> Result<String, MarkerError> {
    // プラグイン種別ごとの削除処理に振り分ける
    match kind {
        PluginKind::Frontend => {
            // インポートマーカー間からプラグインに関連する行を削除する
            let source =
                remove_from_between(source, FRONTEND_IMPORT_START, FRONTEND_IMPORT_END, plugin_name)?;
            // ルートマーカー間からプラグインに関連する行を削除する
            remove_from_between(
                &source,
                FRONTEND_ROUTE_START,
                FRONTEND_ROUTE_END,
                plugin_name,
            )
        }
        PluginKind::Backend => {
            // バックエンドマーカー間からプラグインに関連する行を削除する
            remove_from_between(source, BACKEND_START, BACKEND_END, plugin_name)
        }
    }
}

// 指定したマーカー間からプラグイン名を含む行を削除するヘルパー関数
fn remove_from_between(
    source: &str,
    start_marker: &str,
    end_marker: &str,
    plugin_name: &str,
) -> Result<String, MarkerError> {
    // ソースを行の配列に分解する
    let lines: Vec<&str> = source.lines().collect();

    // 開始マーカーの行インデックスを探す
    let start_idx = lines
        .iter()
        .enumerate()
        .find(|(_, l)| l.trim() == start_marker.trim())
        .map(|(i, _)| i)
        .ok_or_else(|| {
            MarkerError::CannotLocate(format!("開始マーカー '{}' が見つかりません", start_marker))
        })?;

    // 終了マーカーの行インデックスを探す
    let end_idx = lines
        .iter()
        .enumerate()
        .skip(start_idx + 1)
        .find(|(_, l)| l.trim() == end_marker.trim())
        .map(|(i, _)| i)
        .ok_or_else(|| {
            MarkerError::CannotLocate(format!("終了マーカー '{}' が見つかりません", end_marker))
        })?;

    // マーカー外の行はすべて保持し、マーカー間の行はプラグイン名を含まない行のみ保持する
    let result: Vec<String> = lines
        .iter()
        .enumerate()
        .filter(|(i, l)| {
            // マーカー（境界を含む）の外側の行は常に保持する
            if *i <= start_idx || *i >= end_idx {
                return true;
            }
            // マーカー間の行：プラグイン名を含む行は削除する（含まない行は保持する）
            !l.contains(plugin_name)
        })
        .map(|(_, l)| l.to_string())
        .collect();

    // 行ベクタを改行で結合して最終ソースを作成する
    let mut out = result.join("\n");
    // 末尾改行を維持する
    if source.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    // 削除後のソースを返す
    Ok(out)
}

// 単体テストモジュール
#[cfg(test)]
mod tests {
    // 親モジュールの全アイテムをテストスコープにインポートする
    use super::*;

    // @backstage/create-app で生成される素の App.tsx のテスト用サンプル
    fn sample_app_tsx() -> &'static str {
        // Backstage v1.x の典型的な App.tsx（import + FlatRoutes 構造）
        r#"import React from 'react';
import { Navigate, Route } from 'react-router-dom';
import { AppRouter, FlatRoutes } from '@backstage/core-app-api';
import { CatalogIndexPage } from '@backstage/plugin-catalog';

const routes = (
  <FlatRoutes>
    <Route path="/" element={<Navigate to="catalog" />} />
    <Route path="/catalog" element={<CatalogIndexPage />} />
  </FlatRoutes>
);
"#
    }

    // @backstage/create-app で生成される素の index.ts のテスト用サンプル
    fn sample_index_ts() -> &'static str {
        // Backstage v1.x の典型的な新スタイルバックエンド（backend.add + backend.start）
        r#"import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();
backend.add(import('@backstage/plugin-app-backend'));
backend.start();
"#
    }

    // ensure_markers はフロントエンド App.tsx に両方のマーカーを正しく挿入する
    #[test]
    fn ensure_markers_inserts_into_clean_app_tsx() {
        // テスト用の素の App.tsx ソースを取得する
        let source = sample_app_tsx();
        // ensure_markers を呼び出してマーカーを挿入する
        let result = ensure_markers(source, &PluginKind::Frontend).unwrap();
        // インポートマーカーが挿入されていることを確認する
        assert!(result.contains(FRONTEND_IMPORT_START), "インポート開始マーカーが存在しない");
        // インポート終了マーカーが挿入されていることを確認する
        assert!(result.contains(FRONTEND_IMPORT_END), "インポート終了マーカーが存在しない");
        // ルートマーカーが挿入されていることを確認する
        assert!(result.contains(FRONTEND_ROUTE_START), "ルート開始マーカーが存在しない");
        // ルート終了マーカーが挿入されていることを確認する
        assert!(result.contains(FRONTEND_ROUTE_END), "ルート終了マーカーが存在しない");
    }

    // ensure_markers はバックエンド index.ts にマーカーを正しく挿入する
    #[test]
    fn ensure_markers_inserts_into_backend_index_ts() {
        // テスト用の素の index.ts ソースを取得する
        let source = sample_index_ts();
        // ensure_markers を呼び出してバックエンドマーカーを挿入する
        let result = ensure_markers(source, &PluginKind::Backend).unwrap();
        // バックエンド開始マーカーが挿入されていることを確認する
        assert!(result.contains(BACKEND_START), "バックエンド開始マーカーが存在しない");
        // バックエンド終了マーカーが挿入されていることを確認する
        assert!(result.contains(BACKEND_END), "バックエンド終了マーカーが存在しない");
        // backend.start() がマーカーの後に存在することを確認する（順序が正しいか）
        let backend_end_pos = result.find(BACKEND_END).unwrap();
        let start_call_pos = result.find("backend.start").unwrap();
        // 終了マーカーが backend.start() より前に来ることを確認する
        assert!(backend_end_pos < start_call_pos, "マーカーが backend.start() の後に挿入されている");
    }

    // ensure_markers は既にマーカーが存在する場合にソースを変更しない（冪等性）
    #[test]
    fn ensure_markers_is_idempotent() {
        // テスト用のソースを取得する
        let source = sample_app_tsx();
        // 1 回目のマーカー挿入を実行する
        let once = ensure_markers(source, &PluginKind::Frontend).unwrap();
        // 2 回目のマーカー挿入を実行する（冪等性の確認）
        let twice = ensure_markers(&once, &PluginKind::Frontend).unwrap();
        // 2 回実行しても結果が変わらないことを確認する
        assert_eq!(once, twice, "2 回実行すると結果が変わった（冪等性違反）");
    }

    // insert_plugin はインポート行とルート行をマーカー間に正しく追記する
    #[test]
    fn insert_plugin_writes_between_markers() {
        // テスト用のソースにマーカーを挿入する
        let source = sample_app_tsx();
        // マーカーを挿入してプラグイン挿入の準備をする
        let with_markers = ensure_markers(source, &PluginKind::Frontend).unwrap();
        // テスト用のプラグイン登録情報を作成する
        let registration = PluginRegistration {
            package_name: "@backstage/plugin-kubernetes".to_string(),
            import_line: "import { KubernetesPage } from '@backstage/plugin-kubernetes';".to_string(),
            register_line: "<Route path=\"/kubernetes\" element={<KubernetesPage />} />".to_string(),
        };
        // プラグインを挿入する
        let result = insert_plugin(&with_markers, &registration, &PluginKind::Frontend).unwrap();
        // インポート行がマーカー間に挿入されていることを確認する
        assert!(result.contains("import { KubernetesPage }"), "インポート行が挿入されていない");
        // ルート行がマーカー間に挿入されていることを確認する
        assert!(result.contains("<Route path=\"/kubernetes\""), "ルート行が挿入されていない");
        // インポートマーカーの後にインポート行が来ることを確認する
        let import_start_pos = result.find(FRONTEND_IMPORT_START).unwrap();
        let import_line_pos = result.find("import { KubernetesPage }").unwrap();
        // インポート開始マーカーの後にインポート行が来ることを確認する
        assert!(import_start_pos < import_line_pos, "インポート行がマーカーの前にある");
    }

    // remove_plugin は対象プラグインの行のみをマーカー間から削除する
    #[test]
    fn remove_plugin_deletes_only_target() {
        // テスト用のソースにマーカーを挿入する
        let source = sample_app_tsx();
        // マーカーを挿入する
        let with_markers = ensure_markers(source, &PluginKind::Frontend).unwrap();
        // 1 個目のプラグインを挿入する
        let reg1 = PluginRegistration {
            package_name: "@backstage/plugin-kubernetes".to_string(),
            import_line: "import { KubernetesPage } from '@backstage/plugin-kubernetes';".to_string(),
            register_line: "<Route path=\"/kubernetes\" element={<KubernetesPage />} />".to_string(),
        };
        // 2 個目のプラグインを挿入する
        let reg2 = PluginRegistration {
            package_name: "@backstage/plugin-techdocs".to_string(),
            import_line: "import { TechDocsPage } from '@backstage/plugin-techdocs';".to_string(),
            register_line: "<Route path=\"/docs\" element={<TechDocsPage />} />".to_string(),
        };
        // 2 つのプラグインを順番に挿入する
        let with_p1 = insert_plugin(&with_markers, &reg1, &PluginKind::Frontend).unwrap();
        // 2 個目のプラグインを挿入する
        let with_p2 = insert_plugin(&with_p1, &reg2, &PluginKind::Frontend).unwrap();
        // kubernetes プラグインのみを削除する
        let after_remove =
            remove_plugin(&with_p2, "@backstage/plugin-kubernetes", &PluginKind::Frontend).unwrap();
        // kubernetes に関連する行が削除されていることを確認する
        assert!(
            !after_remove.contains("@backstage/plugin-kubernetes"),
            "削除対象のプラグインが残っている"
        );
        // techdocs に関連する行が残っていることを確認する
        assert!(
            after_remove.contains("@backstage/plugin-techdocs"),
            "削除対象以外のプラグインが削除された"
        );
    }
}
