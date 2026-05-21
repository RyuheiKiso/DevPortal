// このクレートはセットアップ処理の共通ロジックを CLI と GUI-backend の両方に提供する

// セットアップ処理全体で使用するエラー型を定義するモジュール
pub mod error;

// CLI/GUI 共通の進捗イベントと Reporter 型を定義するモジュール
pub mod event;

// セットアップ全体の設定構造体と TOML ファイル入出力を定義するモジュール
pub mod config;

// セットアップで使用する各種パスの解決ロジックを定義するモジュール
pub mod paths;

// セットアップ前提条件（必須コマンド）の確認ロジックを定義するモジュール
pub mod prereq;

// 外部コマンド実行のユーティリティ関数を定義するモジュール
pub mod process;

// Windows の管理者権限確認と昇格（runas）の機能を実装するモジュール
pub mod elevation;

// Windows サービスの状態を sc.exe で確認する機能を提供するモジュール
pub mod winsvc;

// NSSM CLI のラッパ構造体を定義するモジュール
pub mod nssm;

// SetupEngine トレイトとコンポーネント実行エントリポイントを定義するモジュール
pub mod engine;

// Verdaccio npm レジストリの SetupEngine 実装を定義するモジュール
pub mod verdaccio;

// Backstage 開発者ポータルの SetupEngine 実装を定義するモジュール
pub mod backstage;

// NSSM バイナリを HTTP で動的取得・SHA-256 検証・ZIP 展開するモジュール
pub mod nssm_fetcher;

// Hello World 文字列を返す共通関数（cli と gui-backend の両方から利用される）
pub fn greeting() -> &'static str {
    // 固定文字列 "Hello World" を返す
    "Hello World"
}

// このモジュールの単体テストを定義するブロック
#[cfg(test)]
mod tests {
    // 親モジュールのアイテム（greeting）を取り込む
    use super::*;

    // greeting() が "Hello World" を返すことを確認するテスト
    #[test]
    fn greeting_returns_hello_world() {
        // 期待値と実際の戻り値を比較
        assert_eq!(greeting(), "Hello World");
    }
}
