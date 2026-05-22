// このファイルは npm レジストリの検索 API を使って Backstage プラグインを検索する機能を提供する
// ureq（既存の同期 HTTP クライアント）を使ってネットワーク通信を行う

// JSON 値を扱うために serde_json をインポートする
use serde_json::Value;

// セットアップエラー型を参照するために使用する
use crate::error::SetupError;

// プラグインの種別（フロントエンド / バックエンド）を参照するために使用する
use crate::plugin_markers::PluginKind;

// PluginCandidate: npm レジストリから取得したプラグイン候補を表す構造体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PluginCandidate {
    // npm パッケージ名（例: @backstage/plugin-kubernetes）
    pub name: String,
    // パッケージの最新バージョン文字列
    pub version: String,
    // パッケージの説明文（npm description フィールド）
    pub description: String,
    // プラグインの適用対象種別（name のサフィックスで推定する）
    pub kind: PluginKind,
    // リポジトリ URL（取得できない場合は None）
    pub repository_url: Option<String>,
}

// npm レジストリで Backstage プラグインを検索して候補リストを返す関数
// query: 検索クエリ文字列（例: "kubernetes"）
// ureq を使って同期 HTTP リクエストを送信する（10 秒タイムアウト）
pub fn search(query: &str) -> Result<Vec<PluginCandidate>, SetupError> {
    // URL エンコードが必要な文字は ureq が自動処理するためそのまま組み立てる
    // keywords:backstage を付加することで Backstage 向けパッケージに絞り込む
    let url = format!(
        "https://registry.npmjs.org/-/v1/search?text={}&keywords%3Abackstage&size=50",
        urlencoding_simple(query)
    );

    // ureq エージェントを 10 秒タイムアウトで設定して GET リクエストを送信する
    let response = ureq::get(&url)
        // タイムアウトを 10 秒に設定する
        .timeout(std::time::Duration::from_secs(10))
        // リクエストを実行する
        .call()
        // ネットワークエラーを SetupError::Other に変換する
        .map_err(|e| SetupError::Other(format!("npm レジストリ検索エラー: {}", e)))?;

    // レスポンスボディを文字列として読み込む（ureq の json feature なしでも動作する方法）
    let body_str = response
        // レスポンスボディを UTF-8 文字列として読み込む
        .into_string()
        // 読み込みエラーを SetupError::Other に変換する
        .map_err(|e| SetupError::Other(format!("npm レジストリ レスポンス読み込みエラー: {}", e)))?;

    // 文字列を serde_json::Value として解析する
    let body: Value = serde_json::from_str(&body_str)
        // JSON パースエラーを SetupError::Other に変換する
        .map_err(|e| SetupError::Other(format!("npm レジストリ JSON パースエラー: {}", e)))?;

    // objects 配列を取得する（npm registry v1/search のレスポンス形式）
    let objects: &Vec<Value> = match body.get("objects").and_then(|v: &Value| v.as_array()) {
        // objects 配列が存在する場合はそれを使用する
        Some(arr) => arr,
        // 存在しない場合は空のリストを返す
        None => return Ok(Vec::new()),
    };

    // 各パッケージ情報を PluginCandidate に変換する
    let mut candidates: Vec<PluginCandidate> = Vec::new();
    // objects 配列の各要素を処理する
    for obj in objects {
        // package オブジェクトを取得する
        let pkg: &Value = match obj.get("package") {
            // package フィールドが存在する場合はそれを使用する
            Some(p) => p,
            // 存在しない場合はこのエントリをスキップする
            None => continue,
        };

        // パッケージ名を取得する（取得できない場合はスキップする）
        let name: String = match pkg.get("name").and_then(|v: &Value| v.as_str()) {
            // 名前が取得できた場合は String に変換して使用する
            Some(n) => n.to_string(),
            // 取得できない場合はスキップする
            None => continue,
        };

        // Backstage プラグインのパッケージ名パターンに合致するか確認する
        // @backstage/plugin-* または他のスコープの backstage-plugin-* のみを対象とする
        if !is_backstage_plugin(&name) {
            // 対象外のパッケージはスキップする
            continue;
        }

        // バージョン文字列を取得する（不明の場合は "unknown" を使う）
        let version: String = pkg
            .get("version")
            .and_then(|v: &Value| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        // パッケージの説明文を取得する（不明の場合は空文字を使う）
        let description: String = pkg
            .get("description")
            .and_then(|v: &Value| v.as_str())
            .unwrap_or("")
            .to_string();

        // リポジトリ URL を取得する（存在しない場合は None）
        let repository_url: Option<String> = pkg
            .get("links")
            .and_then(|l: &Value| l.get("repository"))
            .and_then(|v: &Value| v.as_str())
            .map(|s: &str| s.to_string());

        // パッケージ名のサフィックスからプラグイン種別を推定する
        let kind = infer_kind(&name);

        // PluginCandidate を作成してリストに追加する
        candidates.push(PluginCandidate {
            // パッケージ名を格納する
            name,
            // バージョン文字列を格納する
            version,
            // 説明文を格納する
            description,
            // 推定した種別を格納する
            kind,
            // リポジトリ URL を格納する（Option<String>）
            repository_url,
        });
    }

    // 候補リストを返す
    Ok(candidates)
}

// パッケージ名が Backstage プラグインのパターンに合致するか確認するヘルパー関数
fn is_backstage_plugin(name: &str) -> bool {
    // @backstage/plugin-* パターン
    if name.starts_with("@backstage/plugin-") {
        return true;
    }
    // その他のスコープの backstage-plugin-* パターン（コミュニティプラグイン）
    if name.contains("/backstage-plugin-") {
        return true;
    }
    // スコープなしの backstage-plugin-* パターン
    if name.starts_with("backstage-plugin-") {
        return true;
    }
    // いずれのパターンにも合致しない場合は false を返す
    false
}

// パッケージ名のサフィックスからプラグイン種別（Frontend / Backend）を推定するヘルパー関数
fn infer_kind(name: &str) -> PluginKind {
    // パッケージ名が "-backend" で終わる場合はバックエンドプラグインと推定する
    if name.ends_with("-backend") {
        return PluginKind::Backend;
    }
    // "-backend-module-" を含む場合もバックエンドと推定する（モジュール拡張パターン）
    if name.contains("-backend-module-") {
        return PluginKind::Backend;
    }
    // 上記以外はフロントエンドプラグインと推定する
    PluginKind::Frontend
}

// URL クエリパラメータ用の簡易エンコード関数
// ureq はパスの自動エンコードをしないため手動でスペースなどをエンコードする
fn urlencoding_simple(s: &str) -> String {
    // 変換後の文字列を格納するバッファ
    let mut encoded = String::new();
    // 入力文字列の各バイトを処理する
    for c in s.chars() {
        // 英数字とハイフン・アンダースコア・ドット以外はパーセントエンコードする
        if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
            // そのまま追加する
            encoded.push(c);
        } else if c == ' ' {
            // スペースは '+' に変換する（application/x-www-form-urlencoded 形式）
            encoded.push('+');
        } else {
            // その他の文字は UTF-8 バイトをパーセントエンコードする
            for byte in c.to_string().as_bytes() {
                // パーセント記号と 16 進数 2 桁で表現する
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    // エンコードした文字列を返す
    encoded
}
