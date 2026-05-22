// アプリ左側に固定されるナビゲーションサイドバーコンポーネント
// 各ページへのナビリンクとテーマトグルを提供する

// CSS Modules のスタイルをインポートする
import styles from './Sidebar.module.css';
// ルーター（現在のルートと navigate 関数）をインポートする
import { useRouter } from '../router/router';
// Route の型をインポートする
import type { Route } from '../router/router';
// テーマ管理フックをインポートする
import { useTheme } from '../theme/ThemeProvider';
// アイコンコンポーネントをインポートする
import { Icon } from '../ui/Icon';
// アイコンボタンコンポーネントをインポートする
import { IconButton } from '../ui/IconButton';
// 各ナビアイテムに使用する lucide-react アイコンをインポートする
import {
  // ブランドロゴに使うアイコン（コンポーネント群）
  Boxes,
  // Overview（ダッシュボード）ページのアイコン
  LayoutDashboard,
  // Verdaccio ページのアイコン（パッケージレジストリ）
  Package,
  // Backstage ページのアイコン（開発者ポータル）
  Building2,
  // BaGet ページのアイコン（NuGet パッケージ）
  PackageOpen,
  // Settings ページのアイコン
  Settings,
  // Plugins ページのアイコン（パズルピース）
  Puzzle,
  // ライトテーマのアイコン
  Sun,
  // ダークテーマのアイコン
  Moon,
  // システムテーマのアイコン
  Monitor,
} from 'lucide-react';
// lucide-react の LucideIcon 型をインポートする
import type { LucideIcon } from 'lucide-react';

// アプリのバージョン文字列（package.json から動的に取得する方法もあるが固定で管理する）
const APP_VERSION = 'v0.1.0';

// コンポーネント種別の型をインポートする
import type { ComponentKind } from '../api/types';

// ナビゲーションアイテムの定義型
interface NavItemDef {
  // アイテムのラベルテキスト
  label: string;
  // アイテムに対応するルートの page 値
  page: Route['page'];
  // アイテムに表示するアイコン
  icon: LucideIcon;
  // detail ページの場合に遷移先コンポーネント種別を指定する
  component?: ComponentKind;
}

// サイドバーに表示するナビゲーションアイテムの定義
const NAV_ITEMS: NavItemDef[] = [
  // Overview（ダッシュボード）へのリンク
  { label: 'Overview', page: 'overview', icon: LayoutDashboard },
  // Verdaccio コンポーネント詳細ページへのリンク
  { label: 'Verdaccio', page: 'detail', component: 'verdaccio', icon: Package },
  // Backstage コンポーネント詳細ページへのリンク
  { label: 'Backstage', page: 'detail', component: 'backstage', icon: Building2 },
  // BaGet コンポーネント詳細ページへのリンク
  { label: 'BaGet', page: 'detail', component: 'baget', icon: PackageOpen },
  // Backstage プラグイン管理ページへのリンク
  { label: 'Plugins', page: 'plugins', icon: Puzzle },
  // 設定ページへのリンク
  { label: 'Settings', page: 'settings', icon: Settings },
];

// 現在のルートがナビアイテムと対応しているかを判定する関数
function isActive(current: Route, item: NavItemDef): boolean {
  // ページ名が一致しない場合は非アクティブ
  if (current.page !== item.page) return false;
  // detail ページはコンポーネント種別も一致する必要がある
  if (item.page === 'detail' && item.component) {
    return (current as { component?: string }).component === item.component;
  }
  // その他のページはページ名の一致のみで判定する
  return true;
}

// サイドバーコンポーネント
export function Sidebar() {
  // 現在のルートと遷移関数を取得する
  const { route, navigate } = useRouter();
  // テーマの mode と setMode を取得する
  const { mode, setMode } = useTheme();

  // テーマを次の mode にサイクルする関数（light → dark → system → light）
  const cycleTheme = () => {
    // 現在の mode に応じて次の mode に進む
    if (mode === 'light')  setMode('dark');
    else if (mode === 'dark')  setMode('system');
    else setMode('light');
  };

  // 現在の mode に対応するアイコンを返す
  const themeIcon: LucideIcon =
    mode === 'light' ? Sun :
    mode === 'dark'  ? Moon :
    Monitor;

  // 現在の mode に対応するラベルを返す（アクセシブルラベル用）
  const themeLabel =
    mode === 'light'  ? 'ダークモードに切り替え' :
    mode === 'dark'   ? 'システム設定に切り替え' :
    'ライトモードに切り替え';

  // サイドバーを描画する
  return (
    <aside className={styles.sidebar}>
      {/* ブランドロゴエリア */}
      <div className={styles.brand}>
        {/* ブランドアイコン（Boxes） */}
        <Icon icon={Boxes} size={20} color="var(--accent)" />
        {/* ブランド名 */}
        <span className={styles.brandName}>DevPortal</span>
        {/* SETUP バッジ */}
        <span className={styles.brandBadge}>Setup</span>
      </div>

      {/* ナビゲーションリスト */}
      <nav className={styles.nav}>
        {/* ナビゲーションアイテムを順番に描画する */}
        {NAV_ITEMS.map((item) => {
          // このアイテムが現在アクティブかどうかを判定する
          const active = isActive(route, item);

          // ナビゲーションボタンとして描画する
          return (
            <button
              // アイテムの page をキーに使用する（Verdaccio と Backstage が同じ page の場合は label も使う）
              key={item.label}
              // ベーススタイルとアクティブスタイルを結合する
              className={[styles.navItem, active ? styles.active : ''].join(' ')}
              // アクティブなナビアイテムにスクリーンリーダー向けのカレントページ情報を付与する
              aria-current={active ? 'page' : undefined}
              // クリックで対応するルートに遷移する
              onClick={() => {
                // detail ページはコンポーネント種別を含む Route オブジェクトで遷移する
                if (item.page === 'detail' && item.component) {
                  navigate({ page: 'detail', component: item.component });
                } else {
                  // overview / settings など component を持たないページは page のみ指定する
                  navigate({ page: item.page } as Route);
                }
              }}
            >
              {/* ナビアイテムのアイコン */}
              <Icon icon={item.icon} size={16} />
              {/* ナビアイテムのラベル */}
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* フッタエリア（テーマトグル + バージョン） */}
      <div className={styles.footer}>
        {/* テーマ切替ボタン */}
        <IconButton
          // クリックでテーマをサイクルさせる
          onClick={cycleTheme}
          // アクセシブルラベルを付与する
          aria-label={themeLabel}
          // ボタンサイズを小さくする
          size="sm"
        >
          {/* 現在の mode に対応するアイコンを表示する */}
          <Icon icon={themeIcon} size={14} />
        </IconButton>

        {/* アプリのバージョン表示 */}
        <span className={styles.version}>{APP_VERSION}</span>
      </div>
    </aside>
  );
}
