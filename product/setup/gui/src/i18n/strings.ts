// UI テキストを一元管理する日本語辞書（将来の国際化対応に向けたスケルトン）
// 現時点では日本語のみ。実際の i18n ライブラリ導入時にここを起点に展開する

// アプリ全体で使用する UI テキストの定義
export const strings = {

  // ナビゲーション関連のテキスト
  nav: {
    // サイドバーのブランド名
    brand: 'DevPortal',
    // Overview ページのナビラベル
    overview: 'Overview',
    // Settings ページのナビラベル
    settings: 'Settings',
  },

  // Overview ページのテキスト
  overview: {
    // ページタイトル
    title: 'Overview',
    // ページの説明文
    desc: 'コンポーネントの状態を確認・操作します',
    // 前提チェックボタンのラベル
    prereqCheck: '前提チェック',
    // 前提チェック実行中のラベル
    prereqChecking: '確認中…',
    // 更新ボタンのラベル
    refresh: '更新',
    // 更新中のラベル
    refreshing: '更新中…',
    // コンポーネントが見つからない場合のメッセージ
    empty: 'コンポーネントが見つかりません',
    // 前提条件セクションのラベル
    prereqSection: 'PREREQUISITES',
    // コンポーネントセクションのラベル
    componentsSection: 'COMPONENTS',
    // 前提条件チェック結果: 全OK
    prereqAllOk: 'すべて OK',
    // 前提条件チェック結果: 問題あり
    prereqIssues: '問題あり',
  },

  // ComponentCard のテキスト
  card: {
    // サービス名ラベル
    serviceName: 'サービス名',
    // エンドポイントラベル
    endpoint: 'エンドポイント',
    // データラベル
    data: 'データ',
    // データ存在
    dataExists: '存在する',
    // データ未作成
    dataNotFound: '未作成',
    // インストールボタン
    install: 'インストール',
    // 削除ボタン
    uninstall: '削除',
    // 開始ボタン
    start: '開始',
    // 停止ボタン
    stop: '停止',
    // ログを開くボタン
    openLogs: 'ログ',
  },

  // サービスステータスのラベル
  serviceStatus: {
    // 実行中
    running: '実行中',
    // 停止中
    stopped: '停止中',
    // 一時停止
    paused: '一時停止',
    // 遷移中
    pending: '遷移中',
    // 未インストール
    not_installed: '未インストール',
    // 不明
    unknown: '不明',
  },

  // Install ページのテキスト
  install: {
    // セクションラベル: インストール先
    destSection: 'インストール先',
    // プレースホルダーテキスト
    defaultDest: '%ProgramData%\\DevPortal（既定）',
    // フォルダ選択ボタン
    pickDir: '選択…',
    // 既定に戻すボタン
    resetDir: '既定に戻す',
    // 進捗セクションラベル
    progressSection: '進捗',
    // 開始ボタン
    start: 'インストール開始',
    // 実行中のボタンラベル
    starting: 'インストール中…',
  },

  // Uninstall ページのテキスト
  uninstall: {
    // 警告テキスト
    warning: 'この操作は元に戻せません。サービスの停止・ファイルの削除が行われます。',
    // 削除対象セクションラベル
    destSection: '削除対象ディレクトリ',
    // データ保持セクションラベル
    dataSection: 'データの扱い',
    // データ保持チェックボックスラベル
    keepDataLabel: 'データを保持する',
    // 確認入力セクションラベルのテンプレート
    confirmSection: '確認のため {name} と入力してください',
    // 削除ボタンのラベルテンプレート
    deleteLabel: '{name} を削除する',
    // 実行中のボタンラベル
    deleting: 'アンインストール中…',
    // 進捗セクションラベル
    progressSection: '進捗',
  },

  // Stepper のテキスト
  stepper: {
    // ステップ状態: 完了
    done: '完了',
    // ステップ状態: 実行中
    running: '実行中',
    // ステップ状態: 失敗
    failed: '失敗',
    // ステップ状態: スキップ
    skipped: 'スキップ',
    // ステップ状態: 待機中
    pending: '待機中',
    // 完了バナータイトル
    successTitle: 'セットアップ完了',
    // 失敗バナータイトル
    failureTitle: 'セットアップ失敗',
    // Overview へ戻るボタン
    backToOverview: 'Overview へ戻る',
    // 再試行ボタン
    retry: '再試行',
    // エラーコピーボタン
    copyError: 'エラーをコピー',
  },

  // Settings ページのテキスト
  settings: {
    // ページタイトル
    title: 'Settings',
    // ページの説明文
    desc: 'セットアップの設定を編集します',
    // 保存ボタン
    save: '保存',
    // dirty 時の保存ボタン（● ドット付き）
    saveDirty: '● 保存',
    // 破棄ボタン
    discard: '破棄',
    // General セクション
    generalSection: 'General',
    // Verdaccio セクション
    verdaccioSection: 'Verdaccio',
    // Backstage セクション
    backstageSection: 'Backstage',
    // Appearance セクション
    appearanceSection: 'Appearance',
    // バリデーションエラーのバナータイトル
    validationTitle: '入力エラー',
    // バリデーションエラーの本文
    validationDesc: '一部の項目に入力エラーがあります。修正してから保存してください。',
    // 保存成功メッセージ
    savedMsg: '設定を保存しました',
    // テーマ設定の補足説明
    themeHint: 'この設定は setup.toml ではなくブラウザのローカルストレージに保存されます',
  },

} as const;

// 文字列辞書のルートキー型（将来的に言語切り替えを実装する際の型ガード用）
export type StringsRoot = typeof strings;
