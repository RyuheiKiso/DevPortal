// このファイルは SetupEngine トレイトとコンポーネント実行エントリポイントを定義する
// Verdaccio/Backstage の各エンジン実装が共通のインターフェースを持つように強制する

// 独自エラー型を参照するために使用する
use crate::error::SetupError;

// 進捗イベント送信と操作種別の型を参照するために使用する
use crate::event::{Component, Reporter};

// セットアップ設定構造体を参照するために使用する
use crate::config::SetupConfig;

// サービス状態を表す列挙型を参照するために使用する
use crate::winsvc::ServiceStatus;

// ComponentStatus: 1 コンポーネントのステータス情報を表す構造体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ComponentStatus {
    // ステータスが属するコンポーネント種別
    pub component: Component,
    // Windows サービスの識別名
    pub service_name: String,
    // サービスの現在の実行状態
    pub service_status: ServiceStatus,
    // HTTP ヘルスチェックでエンドポイントに到達できるかどうか
    pub endpoint_reachable: bool,
    // ヘルスチェック対象のエンドポイント URL
    pub endpoint_url: String,
    // データディレクトリが存在するかどうか
    pub data_dir_exists: bool,
}

// SetupEngine: 各コンポーネントエンジンが実装するトレイト
// Send 境界を持ち、マルチスレッド環境で安全に使用できる
pub trait SetupEngine: Send {
    // コンポーネント名を返す（ログ表示用）
    fn name(&self) -> &str;

    // サービス名を返す（Windows サービス識別子）
    fn service_name(&self, config: &SetupConfig) -> String;

    // コンポーネントをインストールする
    // 失敗した場合は SetupError を返す
    fn install(&self, config: &SetupConfig, reporter: &Reporter) -> Result<(), SetupError>;

    // コンポーネントをアンインストールする
    // keep_data が true のとき、データディレクトリは保持する
    fn uninstall(
        &self,
        config: &SetupConfig,
        reporter: &Reporter,
        keep_data: bool,
    ) -> Result<(), SetupError>;

    // コンポーネントの現在の状態を返す
    // 失敗した場合は SetupError を返す
    fn status(&self, config: &SetupConfig) -> Result<ComponentStatus, SetupError>;
}

// コンポーネントに対応するエンジンを返すファクトリ関数
// Component 列挙型の値に基づいて適切な Engine 実装を返す
pub fn engine_for(component: Component) -> Box<dyn SetupEngine> {
    // コンポーネント種別に応じて対応するエンジンを返す
    match component {
        // Verdaccio コンポーネントには VerdaccioEngine を返す
        Component::Verdaccio => Box::new(crate::verdaccio::VerdaccioEngine),
        // Backstage コンポーネントには BackstageEngine を返す
        Component::Backstage => Box::new(crate::backstage::BackstageEngine),
        // BaGet コンポーネントには BaGetEngine を返す
        Component::BaGet => Box::new(crate::baget::BaGetEngine),
    }
}
