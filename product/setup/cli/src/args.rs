// このファイルは clap derive マクロを使って CLI の引数構造体を定義する
// サブコマンドごとに引数構造体を分けて見通しよく管理する

// Cli: devportal-setup コマンドのトップレベル引数構造体
#[derive(clap::Parser)]
// コマンド名と説明文を指定する
#[command(name = "devportal-setup", about = "DevPortal セットアップツール")]
pub struct Cli {
    /// JSON 形式で進捗を出力する（CI・スクリプト連携用）
    // グローバルフラグとしてすべてのサブコマンドで使用できるようにする
    #[arg(long, global = true)]
    pub json: bool,

    /// 設定ファイルのパス（省略時は %ProgramData%\DevPortal\config\setup.toml）
    // グローバルフラグとして設定ファイルのパスを指定できるようにする
    #[arg(long, global = true)]
    pub config: Option<std::path::PathBuf>,

    /// 昇格ループ防止フラグ（内部使用。直接指定しないこと）
    // ユーザーに表示しない内部フラグとして定義する
    #[arg(long, global = true, hide = true)]
    pub no_elevate: bool,

    // サブコマンドを必須フィールドとして定義する
    #[command(subcommand)]
    pub command: Commands,
}

// Commands: トップレベルのサブコマンド列挙型
#[derive(clap::Subcommand)]
pub enum Commands {
    /// Verdaccio / Backstage / BaGet をインストールして Windows サービスに登録する
    // インストールコマンドの引数構造体を関連付ける
    Install(InstallArgs),
    /// Verdaccio / Backstage / BaGet のサービスを削除しアンインストールする
    // アンインストールコマンドの引数構造体を関連付ける
    Uninstall(UninstallArgs),
    /// インストール済みコンポーネントの状態を表示する
    // ステータス確認コマンドの引数構造体を関連付ける
    Status(StatusArgs),
    /// 前提コマンドの存在確認のみ実行する
    // doctor コマンドは引数を持たないためユニットバリアントとして定義する
    Doctor,
    /// Windows サービスの制御（管理者権限が必要）
    // サービス制御コマンドの引数構造体を関連付ける
    Service(ServiceArgs),
    /// セットアップ設定の表示・変更
    // 設定コマンドの引数構造体を関連付ける
    Config(ConfigArgs),
}

// InstallArgs: install サブコマンドの引数構造体
#[derive(clap::Args)]
pub struct InstallArgs {
    /// インストール対象（verdaccio / backstage / baget / all）
    // ポジショナル引数としてインストール対象を受け取る
    pub target: String,
    /// Verdaccio のポート番号
    // オプション引数として Verdaccio のポート番号を受け取る
    #[arg(long)]
    pub verdaccio_port: Option<u16>,
    /// Backstage フロントエンドのポート番号
    // オプション引数として Backstage フロントエンドのポート番号を受け取る
    #[arg(long)]
    pub backstage_port: Option<u16>,
    /// BaGet のポート番号
    // オプション引数として BaGet のポート番号を受け取る
    #[arg(long)]
    pub baget_port: Option<u16>,
    /// インストール先のベースディレクトリ
    // オプション引数としてインストール先ディレクトリを受け取る
    #[arg(long)]
    pub install_dir: Option<std::path::PathBuf>,
    /// 確認プロンプトをスキップ
    // フラグ引数として確認スキップを受け取る
    #[arg(long)]
    pub yes: bool,
}

// UninstallArgs: uninstall サブコマンドの引数構造体
#[derive(clap::Args)]
pub struct UninstallArgs {
    // ポジショナル引数としてアンインストール対象を受け取る
    pub target: String,
    /// データディレクトリを保持する
    // フラグ引数としてデータ保持オプションを受け取る
    #[arg(long)]
    pub keep_data: bool,
    /// サービスが停止しない場合に強制終了する
    // フラグ引数として強制終了オプションを受け取る
    #[arg(long)]
    pub force: bool,
    // フラグ引数として確認スキップを受け取る
    #[arg(long)]
    pub yes: bool,
}

// StatusArgs: status サブコマンドの引数構造体
#[derive(clap::Args)]
pub struct StatusArgs {
    /// 確認対象（省略時は全コンポーネント）
    // オプショナルなポジショナル引数として対象コンポーネントを受け取る
    pub target: Option<String>,
}

// ServiceArgs: service サブコマンドの引数構造体
#[derive(clap::Args)]
pub struct ServiceArgs {
    // サービス操作のサブコマンドを必須フィールドとして定義する
    #[command(subcommand)]
    pub action: ServiceAction,
}

// ServiceAction: service サブコマンドの操作種別列挙型
#[derive(clap::Subcommand)]
pub enum ServiceAction {
    // サービスを起動するサブコマンド
    Start {
        // 操作対象のコンポーネント名を受け取る
        target: String,
    },
    // サービスを停止するサブコマンド
    Stop {
        // 操作対象のコンポーネント名を受け取る
        target: String,
    },
    // サービスを再起動するサブコマンド
    Restart {
        // 操作対象のコンポーネント名を受け取る
        target: String,
    },
    // サービスのログを表示するサブコマンド
    Logs {
        // 操作対象のコンポーネント名を受け取る
        target: String,
        // 末尾から表示する行数（デフォルト 50 行）
        #[arg(long, default_value = "50")]
        tail: usize,
    },
}

// ConfigArgs: config サブコマンドの引数構造体
#[derive(clap::Args)]
pub struct ConfigArgs {
    // 設定操作のサブコマンドを必須フィールドとして定義する
    #[command(subcommand)]
    pub action: ConfigAction,
}

// ConfigAction: config サブコマンドの操作種別列挙型
#[derive(clap::Subcommand)]
pub enum ConfigAction {
    // 現在の設定を表示するサブコマンド
    Show,
    // 設定値を変更するサブコマンド
    Set {
        // 変更対象のキー名を受け取る（例: verdaccio.port, baget.port）
        key: String,
        // 設定する値を受け取る（文字列として受け取り後でパースする）
        value: String,
    },
}
