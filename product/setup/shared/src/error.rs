// このファイルはセットアップ処理全体で使用するエラー型を定義する
// thiserror クレートを使って SetupError 列挙型を実装する

// thiserror の Error マクロを使って Display と Error トレイトを自動実装する
use thiserror::Error;

// SetupError: セットアップ処理中に発生しうるすべてのエラーを表す列挙型
#[derive(Debug, Error)]
pub enum SetupError {
    // 前提コマンドが PATH 上に見つからなかった場合のエラー
    #[error("必要なコマンドが見つかりません: {0}")]
    PrereqMissing(String),

    // nssm.exe が検索パス候補のどこにも存在しなかった場合のエラー
    #[error("nssm.exe が見つかりません。検索パス: {0:?}")]
    NssmNotFound(Vec<std::path::PathBuf>),

    // NSSM コマンドの実行は成功したが終了コードが失敗を示した場合のエラー
    #[error("NSSM コマンドが失敗しました。コマンド: {cmd}\n出力: {output}")]
    NssmFailed {
        // 実行した NSSM コマンドの文字列表現
        cmd: String,
        // NSSM が返した stdout/stderr の結合出力
        output: String,
    },

    // 外部コマンドの終了コードが 0 以外だった場合のエラー
    #[error("外部コマンドが失敗しました。コマンド: {cmd}、終了コード: {code}")]
    CommandFailed {
        // 実行したコマンドの文字列表現
        cmd: String,
        // プロセスが返した終了コード
        code: i32,
    },

    // 管理者権限（Elevated）なしで管理者権限が必要な操作を実行しようとした場合のエラー
    #[error("この操作には管理者権限が必要です。管理者として再起動してください。")]
    NotElevated,

    // 指定されたポートがすでに別プロセスで使用されている場合のエラー
    #[error("ポート {0} はすでに使用中です。")]
    PortInUse(u16),

    // 指定されたサービスがすでにインストール済みである場合のエラー
    #[error("サービス '{0}' はすでにインストールされています。")]
    ServiceAlreadyInstalled(String),

    // 標準 I/O エラーを透過的にラップするバリアント（#[from] で自動変換）
    #[error("I/O エラー: {0}")]
    Io(#[from] std::io::Error),

    // serde_yaml の Error は Send 非対応のため String にラップした YAML パースエラー
    #[error("YAML パースエラー: {0}")]
    Yaml(String),

    // 上記のどのカテゴリにも属さないその他のエラー
    #[error("エラー: {0}")]
    Other(String),
}
