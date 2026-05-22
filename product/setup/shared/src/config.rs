// このファイルはセットアップ全体の設定構造体と TOML ファイル入出力を定義する
// serde と toml クレートを使ってファイル読み書きを行う

// ファイルシステムパスを扱うために PathBuf を使用する
use std::path::PathBuf;

// ファイル読み書き用のトレイトをまとめてインポートする
use std::io::{Read, Write};

// 独自エラー型を参照する
use crate::error::SetupError;

// BackstageMode: Backstage の起動モードを表す列挙型
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
// JSON/TOML シリアライズ時に snake_case のキーを使用する
#[serde(rename_all = "snake_case")]
pub enum BackstageMode {
    // `yarn dev` で起動するホットリロード開発モード
    Dev,
    // `yarn build && yarn start` で起動するプロダクションビルドモード
    Build,
}

// BackstageMode のデフォルト値を Dev に設定する
impl Default for BackstageMode {
    // デフォルト値として Dev バリアントを返す
    fn default() -> Self {
        // 開発モードをデフォルトとして使用する
        BackstageMode::Dev
    }
}

// VerdaccioConfig: Verdaccio 固有の設定をまとめた構造体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VerdaccioConfig {
    // Verdaccio が待ち受けるポート番号（デフォルト 4873）
    pub port: u16,
    // インストールする Verdaccio のバージョン指定文字列（デフォルト "^5"）
    pub version: String,
    // アンインストール時にデータ（storage）を保持するかどうか（デフォルト true）
    pub keep_data_on_uninstall: bool,
}

// VerdaccioConfig のデフォルト値を定義する
impl Default for VerdaccioConfig {
    // デフォルト値を持つ VerdaccioConfig を返す
    fn default() -> Self {
        // 各フィールドに仕様書で指定されたデフォルト値を設定する
        Self {
            // Verdaccio 標準のデフォルトポート
            port: 4873,
            // npm semver 範囲指定でメジャーバージョン 5 以上を許容する
            version: "^5".to_string(),
            // データは保持する（誤削除防止のため true がデフォルト）
            keep_data_on_uninstall: true,
        }
    }
}

// BackstageConfig: Backstage 固有の設定をまとめた構造体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BackstageConfig {
    // create-app の --path オプションに渡すアプリ名（デフォルト "devportal-backstage"）
    pub app_name: String,
    // Backstage フロントエンドが待ち受けるポート番号（デフォルト 3000）
    pub frontend_port: u16,
    // Backstage バックエンドが待ち受けるポート番号（デフォルト 7007）
    pub backend_port: u16,
    // アンインストール時にデータを保持するかどうか（デフォルト true）
    pub keep_data_on_uninstall: bool,
    // 起動モード（Dev または Build）
    pub mode: BackstageMode,
}

// BackstageConfig のデフォルト値を定義する
impl Default for BackstageConfig {
    // デフォルト値を持つ BackstageConfig を返す
    fn default() -> Self {
        // 各フィールドに仕様書で指定されたデフォルト値を設定する
        Self {
            // create-app で使うデフォルトのアプリディレクトリ名
            app_name: "devportal-backstage".to_string(),
            // Backstage 標準のフロントエンドポート
            frontend_port: 3000,
            // Backstage 標準のバックエンドポート
            backend_port: 7007,
            // データは保持する（誤削除防止のため true がデフォルト）
            keep_data_on_uninstall: true,
            // 開発モードをデフォルトとして使用する
            mode: BackstageMode::default(),
        }
    }
}

// BaGetConfig: BaGet 固有の設定をまとめた構造体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BaGetConfig {
    // BaGet が待ち受けるポート番号（デフォルト 5000）
    pub port: u16,
    // インストールする BaGet のバージョン指定文字列（デフォルト "0.4.0-preview2"）
    pub version: String,
    // アンインストール時にデータ（packages / db）を保持するかどうか（デフォルト true）
    pub keep_data_on_uninstall: bool,
}

// BaGetConfig のデフォルト値を定義する
impl Default for BaGetConfig {
    // デフォルト値を持つ BaGetConfig を返す
    fn default() -> Self {
        // 各フィールドに仕様書で指定されたデフォルト値を設定する
        Self {
            // BaGet のデフォルトポート
            port: 5000,
            // インストールするデフォルトバージョン
            version: "0.4.0-preview2".to_string(),
            // データは保持する（誤削除防止のため true がデフォルト）
            keep_data_on_uninstall: true,
        }
    }
}

// SetupConfig: セットアップ全体の設定をまとめたルート構造体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SetupConfig {
    // Windows サービス名のプレフィックス（デフォルト "DevPortal"）
    pub service_prefix: String,
    // インストール先ルートディレクトリ（None のとき %ProgramData%\DevPortal を使う）
    pub install_root: Option<PathBuf>,
    // Verdaccio 固有の設定
    pub verdaccio: VerdaccioConfig,
    // Backstage 固有の設定
    pub backstage: BackstageConfig,
    // BaGet 固有の設定（[baget] セクションがない既存 TOML からの読み込み時にデフォルト値を使う）
    #[serde(default)]
    pub baget: BaGetConfig,
}

// SetupConfig のデフォルト値を定義する
impl Default for SetupConfig {
    // デフォルト値を持つ SetupConfig を返す
    fn default() -> Self {
        // 各フィールドに仕様書で指定されたデフォルト値を設定する
        Self {
            // サービス名のプレフィックスはツール名に合わせる
            service_prefix: "DevPortal".to_string(),
            // None のとき paths モジュールが %ProgramData%\DevPortal を自動解決する
            install_root: None,
            // Verdaccio のデフォルト設定を使用する
            verdaccio: VerdaccioConfig::default(),
            // Backstage のデフォルト設定を使用する
            backstage: BackstageConfig::default(),
            // BaGet のデフォルト設定を使用する
            baget: BaGetConfig::default(),
        }
    }
}

// SetupConfig のファイル入出力メソッドを実装するブロック
impl SetupConfig {
    // 指定されたパスの TOML ファイルから設定を読み込む
    pub fn from_file(path: &PathBuf) -> Result<Self, SetupError> {
        // TOML ファイルをテキストとして開く
        let mut file = std::fs::File::open(path)?;
        // ファイル内容を文字列バッファに読み込む
        let mut contents = String::new();
        // 全内容を contents に格納する
        file.read_to_string(&mut contents)?;
        // toml クレートで TOML テキストを SetupConfig にデシリアライズする
        let config: Self = toml::from_str(&contents)
            // TOML パースエラーは SetupError::Other にラップして返す
            .map_err(|e| SetupError::Other(format!("TOML パースエラー: {e}")))?;
        // 正常にパースできた設定を返す
        Ok(config)
    }

    // 現在の設定を指定されたパスに TOML ファイルとして保存する
    pub fn save_to(&self, path: &PathBuf) -> Result<(), SetupError> {
        // 親ディレクトリが存在しない場合は再帰的に作成する
        if let Some(parent) = path.parent() {
            // 親ディレクトリを再帰作成（既存でもエラーにならない）
            std::fs::create_dir_all(parent)?;
        }
        // 設定構造体を TOML 形式の文字列にシリアライズする
        let toml_str = toml::to_string_pretty(self)
            // シリアライズエラーは SetupError::Other にラップして返す
            .map_err(|e| SetupError::Other(format!("TOML シリアライズエラー: {e}")))?;
        // 指定パスに新規ファイルを作成（既存ファイルは上書き）する
        let mut file = std::fs::File::create(path)?;
        // シリアライズした文字列をバイト列として書き込む
        file.write_all(toml_str.as_bytes())?;
        // 正常終了を示す Ok(()) を返す
        Ok(())
    }
}
