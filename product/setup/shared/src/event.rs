// このファイルは CLI/GUI 共通の進捗イベントと Reporter 型を定義する
// serde を使って JSON シリアライズ可能な列挙型を定義する

// 標準ライブラリのチャネル送信端を使って Reporter を実装する
use std::sync::mpsc::Sender;

// Component: セットアップ対象のコンポーネント種別を表す列挙型
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
// JSON シリアライズ時に snake_case のキーを使用する
#[serde(rename_all = "snake_case")]
pub enum Component {
    // npm プライベートレジストリサーバーの Verdaccio コンポーネント
    Verdaccio,
    // 開発者ポータルフレームワークの Backstage コンポーネント
    Backstage,
}

// ActionKind: セットアップ操作の種別を表す列挙型
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
// JSON シリアライズ時に snake_case のキーを使用する
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    // コンポーネントをインストールする操作
    Install,
    // コンポーネントをアンインストールする操作
    Uninstall,
    // コンポーネントの状態を確認する操作
    Status,
    // Windows サービスを起動する操作
    ServiceStart,
    // Windows サービスを停止する操作
    ServiceStop,
    // Windows サービスを再起動する操作
    ServiceRestart,
}

// SetupEvent: CLI/GUI 共通の進捗イベントを表す列挙型
// serde の内部タグ方式（tag="kind"）で JSON にシリアライズする
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
// JSON の "kind" フィールドで列挙型のバリアントを識別する
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SetupEvent {
    // セットアップのステップ開始を通知するイベント
    StepStart {
        // ステップを一意に識別する文字列 ID
        id: String,
        // ユーザーに表示するステップのラベル
        label: String,
        // セットアップ全体のステップ総数
        total_steps: u32,
        // 現在のステップのインデックス（0 始まり）
        index: u32,
    },

    // セットアップのステップ完了を通知するイベント
    StepDone {
        // 完了したステップの ID（StepStart の id と対応）
        id: String,
        // ステップ開始から完了までの経過時間（ミリ秒）
        duration_ms: u64,
    },

    // ステップの進捗率を通知するイベント
    Progress {
        // 進捗を報告するステップの ID
        id: String,
        // 進捗率（0〜100）
        percent: u8,
        // 進捗に付随する任意のメッセージ
        message: Option<String>,
    },

    // 外部コマンドの標準出力の 1 行を通知するイベント
    Stdout {
        // 出力が属するステップの ID
        id: String,
        // 標準出力の 1 行テキスト
        line: String,
    },

    // 外部コマンドの標準エラー出力の 1 行を通知するイベント
    Stderr {
        // 出力が属するステップの ID
        id: String,
        // 標準エラー出力の 1 行テキスト
        line: String,
    },

    // 警告メッセージを通知するイベント
    Warn {
        // 警告が属するステップの ID（ステップに関連しない場合は None）
        id: Option<String>,
        // 警告メッセージ本文
        message: String,
    },

    // 情報メッセージを通知するイベント（ステップに紐付かない一般情報）
    Info {
        // 情報メッセージ本文
        message: String,
    },

    // セットアップ操作の正常完了を通知するイベント
    Finished {
        // 操作が完了したコンポーネント種別
        component: Component,
        // 完了した操作の種別
        action: ActionKind,
        // 完了内容の要約テキスト
        summary: String,
    },

    // セットアップ操作の失敗を通知するイベント
    Failed {
        // 失敗したコンポーネント種別
        component: Component,
        // 失敗した操作の種別
        action: ActionKind,
        // エラーの説明テキスト
        error: String,
        // true のとき再試行や回復が可能なエラーであることを示す
        recoverable: bool,
    },
}

// Reporter: SetupEvent をチャネル経由で送信する Push 型ラッパ構造体
pub struct Reporter {
    // イベントを送信するチャネルの送信端（Arc で包まず単一所有のまま使用）
    sender: Sender<SetupEvent>,
}

// Reporter のメソッド実装ブロック
impl Reporter {
    // Reporter を新規作成する。引数にチャネルの送信端を受け取る
    pub fn new(sender: Sender<SetupEvent>) -> Self {
        // フィールドを初期化して返す
        Self { sender }
    }

    // 情報メッセージを Info イベントとして送信する
    pub fn info(&self, message: impl Into<String>) {
        // チャネルが切断済みの場合は送信エラーをサイレントに無視する
        let _ = self.sender.send(SetupEvent::Info {
            // Into<String> を String に変換して格納
            message: message.into(),
        });
    }

    // 警告メッセージを Warn イベントとして送信する
    pub fn warn(&self, id: Option<String>, message: impl Into<String>) {
        // チャネルが切断済みの場合は送信エラーをサイレントに無視する
        let _ = self.sender.send(SetupEvent::Warn {
            // 警告が属するステップ ID（省略可）
            id,
            // Into<String> を String に変換して格納
            message: message.into(),
        });
    }

    // ステップ開始イベントを送信する
    pub fn step_start(
        &self,
        // ステップを一意に識別する ID
        id: impl Into<String>,
        // ユーザーに表示するラベル
        label: impl Into<String>,
        // 全ステップ数
        total_steps: u32,
        // 現在のステップインデックス
        index: u32,
    ) {
        // チャネルが切断済みの場合は送信エラーをサイレントに無視する
        let _ = self.sender.send(SetupEvent::StepStart {
            // ID を String に変換
            id: id.into(),
            // ラベルを String に変換
            label: label.into(),
            // 全ステップ数をそのまま格納
            total_steps,
            // インデックスをそのまま格納
            index,
        });
    }

    // ステップ完了イベントを送信する
    pub fn step_done(&self, id: impl Into<String>, duration_ms: u64) {
        // チャネルが切断済みの場合は送信エラーをサイレントに無視する
        let _ = self.sender.send(SetupEvent::StepDone {
            // ID を String に変換
            id: id.into(),
            // 経過時間をそのまま格納
            duration_ms,
        });
    }

    // 進捗パーセントを Progress イベントとして送信する
    // percent: 0〜100 の進捗率
    // message: 進捗に付随する任意のメッセージ（省略可）
    pub fn progress(&self, id: impl Into<String>, percent: u8, message: Option<String>) {
        // チャネルが切断済みの場合は送信エラーをサイレントに無視する
        let _ = self.sender.send(SetupEvent::Progress {
            // ID を String に変換
            id: id.into(),
            // 進捗率をそのまま格納
            percent,
            // メッセージをそのまま格納
            message,
        });
    }

    // 標準出力の 1 行を Stdout イベントとして送信する
    pub fn stdout_line(&self, id: impl Into<String>, line: impl Into<String>) {
        // チャネルが切断済みの場合は送信エラーをサイレントに無視する
        let _ = self.sender.send(SetupEvent::Stdout {
            // ID を String に変換
            id: id.into(),
            // 行テキストを String に変換
            line: line.into(),
        });
    }

    // 標準エラー出力の 1 行を Stderr イベントとして送信する
    pub fn stderr_line(&self, id: impl Into<String>, line: impl Into<String>) {
        // チャネルが切断済みの場合は送信エラーをサイレントに無視する
        let _ = self.sender.send(SetupEvent::Stderr {
            // ID を String に変換
            id: id.into(),
            // 行テキストを String に変換
            line: line.into(),
        });
    }

    // セットアップ正常完了イベントを送信する
    pub fn finished(
        &self,
        // 完了したコンポーネント種別
        component: Component,
        // 実行した操作の種別
        action: ActionKind,
        // 完了内容の要約テキスト
        summary: impl Into<String>,
    ) {
        // チャネルが切断済みの場合は送信エラーをサイレントに無視する
        let _ = self.sender.send(SetupEvent::Finished {
            // コンポーネントをそのまま格納
            component,
            // 操作種別をそのまま格納
            action,
            // 要約テキストを String に変換
            summary: summary.into(),
        });
    }

    // セットアップ失敗イベントを送信する
    pub fn failed(
        &self,
        // 失敗したコンポーネント種別
        component: Component,
        // 失敗した操作の種別
        action: ActionKind,
        // エラーの説明テキスト
        error: impl Into<String>,
        // 回復可能かどうかのフラグ
        recoverable: bool,
    ) {
        // チャネルが切断済みの場合は送信エラーをサイレントに無視する
        let _ = self.sender.send(SetupEvent::Failed {
            // コンポーネントをそのまま格納
            component,
            // 操作種別をそのまま格納
            action,
            // エラーテキストを String に変換
            error: error.into(),
            // 回復可能フラグをそのまま格納
            recoverable,
        });
    }
}
