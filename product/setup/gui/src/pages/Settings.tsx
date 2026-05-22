// 設定編集画面コンポーネント
// General / Verdaccio / Backstage / Appearance の 4 セクションで SetupConfig を編集する
// dirty 検出・バリデーション・手動保存・ナビ離脱ガードを実装する

// React のフックをインポートする（react-jsx transform を使用しているため React 自体は不要）
import { useState, useEffect, useCallback, useMemo } from 'react';
// API ラッパー関数をインポートする
import { loadConfig, saveConfig, pickDirectory } from '../api/tauri';
// ナビゲーション離脱ガードフックをインポートする
import { useNavigationGuard } from '../router/router';
// SetupConfig 型をインポートする
import type { SetupConfig } from '../api/types';
// テーマ管理フックをインポートする
import { useTheme } from '../theme/ThemeProvider';
// テーマモード型をインポートする
import type { ThemeMode } from '../theme/ThemeProvider';
// トースト通知フックをインポートする
import { useToast } from '../ui/ToastProvider';
// UI プリミティブをインポートする
import { Button } from '../ui/Button';
import { Banner } from '../ui/Banner';
import { Skeleton } from '../ui/Skeleton';
import { Segmented } from '../ui/Segmented';
import { Icon } from '../ui/Icon';
// ページで使用する lucide-react アイコンをインポートする
import { Save, RotateCcw, FolderOpen } from 'lucide-react';
// CSS Modules のスタイルをインポートする
import styles from './Settings.module.css';

// バリデーションエラーを保持するインターフェース
interface ValidationErrors {
  // service_prefix のエラー（空文字の場合）
  service_prefix?: string;
  // Verdaccio ポートのエラー（範囲外・非整数の場合）
  verdaccio_port?: string;
  // Verdaccio バージョンのエラー（空文字の場合）
  verdaccio_version?: string;
  // Backstage アプリ名のエラー（空文字の場合）
  backstage_app_name?: string;
  // Backstage フロントエンドポートのエラー
  backstage_frontend_port?: string;
  // Backstage バックエンドポートのエラー
  backstage_backend_port?: string;
}

// ポート番号の有効範囲（OS が割り当てる動的ポート範囲を避けるため 1024 以上）
const PORT_MIN = 1024;
// ポート番号の最大値（16 ビット符号なし整数の最大値）
const PORT_MAX = 65535;

// ポート番号文字列を検証してエラーメッセージを返すヘルパー関数
function validatePort(value: number, name: string): string | undefined {
  // 整数でない場合はエラー
  if (!Number.isInteger(value)) return `${name} は整数で入力してください`;
  // 範囲外の場合はエラー
  if (value < PORT_MIN || value > PORT_MAX) {
    return `${name} は ${PORT_MIN}〜${PORT_MAX} の範囲で入力してください`;
  }
  // 問題なければ undefined を返す
  return undefined;
}

// SetupConfig のドラフトをバリデーションして ValidationErrors を返す純粋関数
function validate(draft: SetupConfig): ValidationErrors {
  // エラーを蓄積するオブジェクト
  const errors: ValidationErrors = {};

  // service_prefix の空文字チェック
  if (!draft.service_prefix.trim()) {
    errors.service_prefix = 'サービスプレフィックスを入力してください';
  }

  // Verdaccio ポートのバリデーション
  const verdaccioPortErr = validatePort(draft.verdaccio.port, 'Verdaccio ポート');
  if (verdaccioPortErr) errors.verdaccio_port = verdaccioPortErr;

  // Verdaccio バージョンの空文字チェック
  if (!draft.verdaccio.version.trim()) {
    errors.verdaccio_version = 'バージョンを入力してください';
  }

  // Backstage アプリ名の空文字チェック
  if (!draft.backstage.app_name.trim()) {
    errors.backstage_app_name = 'アプリ名を入力してください';
  }

  // Backstage フロントエンドポートのバリデーション
  const frontendPortErr = validatePort(draft.backstage.frontend_port, 'フロントエンドポート');
  if (frontendPortErr) errors.backstage_frontend_port = frontendPortErr;

  // Backstage バックエンドポートのバリデーション
  const backendPortErr = validatePort(draft.backstage.backend_port, 'バックエンドポート');
  if (backendPortErr) errors.backstage_backend_port = backendPortErr;

  // Verdaccio・Backstage 全 3 ポートの組合せ重複チェック（バリデーションエラーのないもの同士）
  const portFields: Array<{ key: keyof ValidationErrors; val: number; name: string }> = [
    { key: 'verdaccio_port',           val: draft.verdaccio.port,          name: 'Verdaccio ポート' },
    { key: 'backstage_frontend_port',  val: draft.backstage.frontend_port,  name: 'フロントエンドポート' },
    { key: 'backstage_backend_port',   val: draft.backstage.backend_port,   name: 'バックエンドポート' },
  ];
  // バリデーション済みのポートフィールドだけを抽出して全組合せで重複を検出する
  const validPorts = portFields.filter((p) => !errors[p.key]);
  for (let i = 0; i < validPorts.length; i++) {
    for (let j = i + 1; j < validPorts.length; j++) {
      // 値が同じならどちらのフィールドにも重複エラーをセットする
      if (validPorts[i].val === validPorts[j].val) {
        errors[validPorts[i].key] = '他のポートと重複しています';
        errors[validPorts[j].key] = '他のポートと重複しています';
      }
    }
  }

  return errors;
}

// テーマの選択肢
const THEME_OPTIONS = [
  { value: 'light',  label: 'ライト' },
  { value: 'dark',   label: 'ダーク' },
  { value: 'system', label: 'システム' },
] as const;

// Backstage 起動モードの選択肢
const MODE_OPTIONS = [
  { value: 'dev',   label: 'Dev' },
  { value: 'build', label: 'Build' },
] as const;

// 設定画面コンポーネント
export function Settings() {
  // トースト通知関数を取得する
  const { showSuccess, showDanger } = useToast();
  // テーマ管理フックから mode と setMode を取得する
  const { mode, setMode } = useTheme();
  // Rust から読み込んだ保存済み設定（dirty 判定の基準値）
  const [savedConfig, setSavedConfig] = useState<SetupConfig | null>(null);
  // 編集中のドラフト設定
  const [draft, setDraft] = useState<SetupConfig | null>(null);
  // 設定読み込み中フラグ
  const [loadError, setLoadError] = useState<string | null>(null);
  // 保存中フラグ
  const [saving, setSaving] = useState(false);

  // dirty かどうかを JSON.stringify で比較して判定する
  const isDirty = useMemo(
    () => savedConfig !== null && draft !== null &&
      JSON.stringify(draft) !== JSON.stringify(savedConfig),
    [savedConfig, draft]
  );

  // ドラフトのバリデーションエラーを計算する
  const errors = useMemo(
    () => draft ? validate(draft) : {} as ValidationErrors,
    [draft]
  );

  // バリデーションエラーが 1 つ以上あるかどうかを判定する
  const hasErrors = Object.keys(errors).length > 0;

  // 初回マウント時に setup.toml から設定を読み込む
  useEffect(() => {
    // アンマウント後に setState が走らないよう mounted フラグで保護する
    let mounted = true;
    loadConfig()
      .then((config) => {
        // アンマウント済みの場合は state 更新をスキップする
        if (!mounted) return;
        // 読み込んだ設定を保存済みとドラフトの両方にセットする
        setSavedConfig(config);
        setDraft(config);
      })
      .catch((e) => {
        // アンマウント済みの場合は state 更新をスキップする
        if (!mounted) return;
        // 読み込み失敗時はエラーメッセージを表示する
        setLoadError(`設定読み込み失敗: ${String(e)}`);
      });
    return () => { mounted = false; };
  }, []);

  // ナビゲーション離脱ガード（dirty 状態でサイドバー等から他ページへ遷移しようとした場合に確認する）
  // ルーター層の navigate() が呼ばれる前に同期的に確認するため、Settings がアンマウントされる前に動く
  // 注意: Tauri ウィンドウの「×」ボタンによる終了には対応できない（OS レベルの操作のため）
  useNavigationGuard(
    // dirty 状態のときのみガードを有効にする
    isDirty,
    // ネイティブ確認ダイアログで離脱を確認する（true で遷移許可、false でキャンセル）
    () => window.confirm('変更が保存されていません。このページを離れますか？'),
  );

  // ドラフトの特定フィールドを更新するヘルパー関数
  const updateDraft = useCallback(<K extends keyof SetupConfig>(
    key: K,
    value: SetupConfig[K],
  ) => {
    // 既存のドラフトをスプレッドして指定フィールドを上書きする
    setDraft((prev) => prev ? { ...prev, [key]: value } : prev);
  }, []);

  // Verdaccio 設定のフィールドを更新するヘルパー関数
  const updateVerdaccio = useCallback(<K extends keyof SetupConfig['verdaccio']>(
    key: K,
    value: SetupConfig['verdaccio'][K],
  ) => {
    setDraft((prev) =>
      prev ? { ...prev, verdaccio: { ...prev.verdaccio, [key]: value } } : prev
    );
  }, []);

  // Backstage 設定のフィールドを更新するヘルパー関数
  const updateBackstage = useCallback(<K extends keyof SetupConfig['backstage']>(
    key: K,
    value: SetupConfig['backstage'][K],
  ) => {
    setDraft((prev) =>
      prev ? { ...prev, backstage: { ...prev.backstage, [key]: value } } : prev
    );
  }, []);

  // インストール先フォルダ選択ダイアログを開くコールバック
  const handlePickInstallRoot = useCallback(async () => {
    // ネイティブフォルダ選択ダイアログを表示する
    const picked = await pickDirectory(draft?.install_root ?? undefined);
    // フォルダが選択された場合のみドラフトを更新する
    if (picked) updateDraft('install_root', picked);
  }, [draft?.install_root, updateDraft]);

  // 設定を保存するコールバック
  const handleSave = useCallback(async () => {
    // バリデーションエラーがある場合は保存しない
    if (!draft || hasErrors) return;
    // 保存中フラグを立てる
    setSaving(true);
    try {
      // Rust 側の cmd_save_config でファイルに書き込む
      await saveConfig(draft);
      // 保存が成功したら savedConfig をドラフトで更新する（dirty がクリアされる）
      setSavedConfig(draft);
      // 成功トーストを表示する
      showSuccess('設定を保存しました');
    } catch (e) {
      // 保存失敗時はエラートーストを表示する
      showDanger(`保存失敗: ${String(e)}`);
    } finally {
      // 保存中フラグを解除する
      setSaving(false);
    }
  }, [draft, hasErrors, showSuccess, showDanger]);

  // 変更を破棄してドラフトを保存済み設定に戻すコールバック
  const handleDiscard = useCallback(() => {
    // savedConfig が存在する場合のみドラフトをリセットする
    if (savedConfig) setDraft(savedConfig);
  }, [savedConfig]);

  // Ctrl+S / Cmd+S キーボードショートカットで設定を保存する（handleSave の定義後に配置）
  useEffect(() => {
    // キーダウンイベントのハンドラを定義する
    const handler = (e: KeyboardEvent) => {
      // Ctrl キー（Windows/Linux）または Meta キー（macOS）+ S の組み合わせを検出する
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        // ブラウザのデフォルト保存ダイアログを抑制する
        e.preventDefault();
        // dirty かつバリデーションエラーなしかつ保存中でない場合のみ保存する
        if (isDirty && !hasErrors && !saving) {
          handleSave();
        }
      }
    };
    // keydown イベントを購読する
    window.addEventListener('keydown', handler);
    // アンマウント時にイベントリスナーを解除する
    return () => window.removeEventListener('keydown', handler);
  }, [isDirty, hasErrors, saving, handleSave]);

  // 読み込みエラー時はエラーバナーを表示する
  if (loadError) {
    return (
      <div className={styles.page}>
        <Banner variant="danger" title="読み込みエラー">{loadError}</Banner>
      </div>
    );
  }

  // 設定が読み込まれるまでスケルトンを表示する
  if (!draft) {
    return (
      <div className={styles.page}>
        {/* スケルトンプレースホルダーを 3 つ表示する */}
        <Skeleton height={32} />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </div>
    );
  }

  // 設定画面を描画する
  return (
    <div className={styles.page}>

      {/* ─── ページヘッダー（タイトル + 保存/破棄ボタン）─── */}
      <div className={styles.pageHeader}>
        {/* 左側: ページタイトルと説明文 */}
        <div>
          <h1 className={styles.pageTitle}>Settings</h1>
          <p className={styles.pageDesc}>セットアップの設定を編集します</p>
        </div>
        {/* 右側: 保存と破棄ボタン（dirty 時のみ有効にする）*/}
        <div className={styles.headerActions}>
          {/* 破棄ボタン（dirty 時のみ表示する）*/}
          {isDirty && (
            <Button variant="ghost" size="sm" onClick={handleDiscard}>
              <Icon icon={RotateCcw} size={14} />
              破棄
            </Button>
          )}
          {/* 保存ボタン（dirty かつエラーなしの場合に有効にする）*/}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            // dirty でなければ無効、バリデーションエラーがあれば無効、保存中は無効
            disabled={!isDirty || hasErrors || saving}
          >
            <Icon icon={Save} size={14} />
            {/* dirty かつ未保存の場合は ● ドットを付けて変更を示す */}
            {isDirty ? '● 保存' : '保存'}
          </Button>
        </div>
      </div>

      {/* バリデーションエラーがある場合は警告バナーを表示する */}
      {hasErrors && (
        <Banner variant="warning" title="入力エラー">
          一部の項目に入力エラーがあります。修正してから保存してください。
        </Banner>
      )}

      {/* ─── General セクション ─── */}
      <section className={styles.section}>
        {/* セクションラベル */}
        <span className={styles.sectionLabel}>General</span>

        {/* サービスプレフィックスの設定行 */}
        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor="service-prefix">
            サービスプレフィックス
          </label>
          <div className={styles.formControl}>
            {/* サービスプレフィックスのテキスト入力 */}
            <input
              id="service-prefix"
              type="text"
              // ドラフトの値を表示する
              value={draft.service_prefix}
              // 変更時にドラフトを更新する
              onChange={(e) => updateDraft('service_prefix', e.target.value)}
              // バリデーションエラーがある場合はエラースタイルを適用する
              className={[styles.input, errors.service_prefix ? styles.inputError : ''].join(' ')}
            />
            {/* バリデーションエラーメッセージを表示する */}
            {errors.service_prefix && (
              <span className={styles.errorMsg}>{errors.service_prefix}</span>
            )}
          </div>
        </div>

        {/* インストールルートの設定行 */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>
            インストール先
          </label>
          <div className={styles.formControl}>
            {/* パス表示 + 操作ボタンの行 */}
            <div className={styles.pathRow}>
              {/* 現在のインストール先パスを読み取り専用で表示する */}
              <span className={draft.install_root ? styles.pathText : styles.pathPlaceholder}>
                {draft.install_root ?? '%ProgramData%\\DevPortal（既定）'}
              </span>
              {/* フォルダ選択ボタン */}
              <Button variant="secondary" size="sm" onClick={handlePickInstallRoot}>
                <Icon icon={FolderOpen} size={14} />
                選択…
              </Button>
              {/* install_root が設定されている場合のみ既定に戻すボタンを表示する */}
              {draft.install_root && (
                <Button variant="ghost" size="sm" onClick={() => updateDraft('install_root', null)}>
                  <Icon icon={RotateCcw} size={14} />
                  既定に戻す
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Verdaccio セクション ─── */}
      <section className={styles.section}>
        {/* セクションラベル */}
        <span className={styles.sectionLabel}>Verdaccio</span>

        {/* Verdaccio ポートの設定行 */}
        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor="verdaccio-port">
            ポート
          </label>
          <div className={styles.formControl}>
            {/* ポート番号の数値入力 */}
            <input
              id="verdaccio-port"
              type="number"
              // ポートの有効範囲を指定する
              min={PORT_MIN}
              max={PORT_MAX}
              // ドラフトの値を表示する
              value={draft.verdaccio.port}
              // 変更時に数値に変換してドラフトを更新する
              onChange={(e) => updateVerdaccio('port', Number(e.target.value))}
              // バリデーションエラーがある場合はエラースタイルを適用する
              className={[styles.input, styles.inputNarrow, errors.verdaccio_port ? styles.inputError : ''].join(' ')}
            />
            {/* バリデーションエラーメッセージを表示する */}
            {errors.verdaccio_port && (
              <span className={styles.errorMsg}>{errors.verdaccio_port}</span>
            )}
          </div>
        </div>

        {/* Verdaccio バージョンの設定行 */}
        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor="verdaccio-version">
            バージョン指定
          </label>
          <div className={styles.formControl}>
            {/* バージョン指定のテキスト入力（例: ^5、latest） */}
            <input
              id="verdaccio-version"
              type="text"
              // ドラフトの値を表示する
              value={draft.verdaccio.version}
              // 変更時にドラフトを更新する
              onChange={(e) => updateVerdaccio('version', e.target.value)}
              // バリデーションエラーがある場合はエラースタイルを適用する
              className={[styles.input, styles.inputNarrow, errors.verdaccio_version ? styles.inputError : ''].join(' ')}
            />
            {/* バリデーションエラーメッセージを表示する */}
            {errors.verdaccio_version && (
              <span className={styles.errorMsg}>{errors.verdaccio_version}</span>
            )}
          </div>
        </div>

        {/* データ保持オプションの設定行 */}
        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor="verdaccio-keep-data">
            データを保持
          </label>
          <div className={styles.formControl}>
            {/* チェックボックスとラベルを横並びにする行 */}
            <label className={styles.checkboxRow}>
              {/* データ保持チェックボックス */}
              <input
                id="verdaccio-keep-data"
                type="checkbox"
                // ドラフトの値でチェック状態を制御する
                checked={draft.verdaccio.keep_data_on_uninstall}
                // 変更時にドラフトを更新する
                onChange={(e) => updateVerdaccio('keep_data_on_uninstall', e.target.checked)}
                // チェックボックスのスタイルクラスを適用する
                className={styles.checkbox}
              />
              {/* チェックボックスのラベルテキスト */}
              <span>アンインストール時にデータを保持する</span>
            </label>
          </div>
        </div>
      </section>

      {/* ─── Backstage セクション ─── */}
      <section className={styles.section}>
        {/* セクションラベル */}
        <span className={styles.sectionLabel}>Backstage</span>

        {/* アプリ名の設定行 */}
        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor="backstage-app-name">
            アプリ名
          </label>
          <div className={styles.formControl}>
            {/* アプリ名のテキスト入力 */}
            <input
              id="backstage-app-name"
              type="text"
              // ドラフトの値を表示する
              value={draft.backstage.app_name}
              // 変更時にドラフトを更新する
              onChange={(e) => updateBackstage('app_name', e.target.value)}
              // バリデーションエラーがある場合はエラースタイルを適用する
              className={[styles.input, errors.backstage_app_name ? styles.inputError : ''].join(' ')}
            />
            {/* バリデーションエラーメッセージを表示する */}
            {errors.backstage_app_name && (
              <span className={styles.errorMsg}>{errors.backstage_app_name}</span>
            )}
          </div>
        </div>

        {/* フロントエンドポートの設定行 */}
        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor="backstage-frontend-port">
            フロントエンドポート
          </label>
          <div className={styles.formControl}>
            {/* フロントエンドポートの数値入力 */}
            <input
              id="backstage-frontend-port"
              type="number"
              // ポートの有効範囲を指定する
              min={PORT_MIN}
              max={PORT_MAX}
              // ドラフトの値を表示する
              value={draft.backstage.frontend_port}
              // 変更時に数値に変換してドラフトを更新する
              onChange={(e) => updateBackstage('frontend_port', Number(e.target.value))}
              // バリデーションエラーがある場合はエラースタイルを適用する
              className={[styles.input, styles.inputNarrow, errors.backstage_frontend_port ? styles.inputError : ''].join(' ')}
            />
            {/* バリデーションエラーメッセージを表示する */}
            {errors.backstage_frontend_port && (
              <span className={styles.errorMsg}>{errors.backstage_frontend_port}</span>
            )}
          </div>
        </div>

        {/* バックエンドポートの設定行 */}
        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor="backstage-backend-port">
            バックエンドポート
          </label>
          <div className={styles.formControl}>
            {/* バックエンドポートの数値入力 */}
            <input
              id="backstage-backend-port"
              type="number"
              // ポートの有効範囲を指定する
              min={PORT_MIN}
              max={PORT_MAX}
              // ドラフトの値を表示する
              value={draft.backstage.backend_port}
              // 変更時に数値に変換してドラフトを更新する
              onChange={(e) => updateBackstage('backend_port', Number(e.target.value))}
              // バリデーションエラーがある場合はエラースタイルを適用する
              className={[styles.input, styles.inputNarrow, errors.backstage_backend_port ? styles.inputError : ''].join(' ')}
            />
            {/* バリデーションエラーメッセージを表示する */}
            {errors.backstage_backend_port && (
              <span className={styles.errorMsg}>{errors.backstage_backend_port}</span>
            )}
          </div>
        </div>

        {/* 起動モードの設定行 */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>
            起動モード
          </label>
          <div className={styles.formControl}>
            {/* dev / build のセグメントコントロール */}
            <Segmented
              // 起動モードの選択肢を渡す
              options={MODE_OPTIONS as unknown as Array<{ value: string; label: string }>}
              // 現在のドラフト値を表示する
              value={draft.backstage.mode}
              // 変更時にドラフトを更新する
              onChange={(v) => updateBackstage('mode', v as 'dev' | 'build')}
            />
          </div>
        </div>

        {/* データ保持オプションの設定行 */}
        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor="backstage-keep-data">
            データを保持
          </label>
          <div className={styles.formControl}>
            {/* チェックボックスとラベルを横並びにする行 */}
            <label className={styles.checkboxRow}>
              {/* データ保持チェックボックス */}
              <input
                id="backstage-keep-data"
                type="checkbox"
                // ドラフトの値でチェック状態を制御する
                checked={draft.backstage.keep_data_on_uninstall}
                // 変更時にドラフトを更新する
                onChange={(e) => updateBackstage('keep_data_on_uninstall', e.target.checked)}
                // チェックボックスのスタイルクラスを適用する
                className={styles.checkbox}
              />
              {/* チェックボックスのラベルテキスト */}
              <span>アンインストール時にデータを保持する</span>
            </label>
          </div>
        </div>
      </section>

      {/* ─── Appearance セクション（localStorage のみ永続化・setup.toml は更新しない）─── */}
      <section className={styles.section}>
        {/* セクションラベル */}
        <span className={styles.sectionLabel}>Appearance</span>

        {/* テーマ選択の設定行 */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>
            テーマ
          </label>
          <div className={styles.formControl}>
            {/* light / dark / system のセグメントコントロール */}
            <Segmented
              // テーマの選択肢を渡す
              options={THEME_OPTIONS as unknown as Array<{ value: string; label: string }>}
              // ThemeProvider の現在の mode を表示する
              value={mode}
              // 変更時に ThemeProvider の setMode を呼び出す（localStorage に自動保存される）
              onChange={(v) => setMode(v as ThemeMode)}
            />
            {/* テーマ設定の補足説明 */}
            <span className={styles.helpText}>
              この設定は setup.toml ではなくブラウザのローカルストレージに保存されます
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
