// DevPortal Setup GUI のハッシュベース極小ルーター
// react-router を使用せず、location.hash と useReducer で 5 ルートを管理する
// Tauri のファイル URL でも動作するよう hash (#) ベースのルーティングを採用している

// React の各種フックと型をインポートする
import React, { createContext, useContext, useEffect, useReducer, useRef } from 'react';
// コンポーネント種別の型をインポートする
import { ComponentKind } from '../api/types';

/* ============================================================
   ルート型定義
   ============================================================ */

// Overview 画面（コンポーネント一覧ダッシュボード）のルート型
type OverviewRoute  = { page: 'overview' };
// Install 画面のルート型（対象コンポーネント種別を含む）
type InstallRoute   = { page: 'install';   component: ComponentKind };
// Uninstall 画面のルート型（対象コンポーネント種別を含む）
type UninstallRoute = { page: 'uninstall'; component: ComponentKind };
// Settings 画面のルート型
type SettingsRoute  = { page: 'settings' };
// コンポーネント詳細画面のルート型（将来の拡張用）
type DetailRoute    = { page: 'detail';    component: ComponentKind };
// Backstage プラグイン管理画面のルート型
type PluginsRoute   = { page: 'plugins' };

// アプリ内に存在する全ルートを表す判別ユニオン型
export type Route =
  | OverviewRoute
  | InstallRoute
  | UninstallRoute
  | SettingsRoute
  | DetailRoute
  | PluginsRoute;

/* ============================================================
   ハッシュ文字列 ⇔ Route の変換関数
   ============================================================ */

function isComponentKind(value: string | undefined): value is ComponentKind {
  return (
    value === 'verdaccio' ||
    value === 'backstage' ||
    value === 'baget' ||
    value === 'postgres' ||
    value === 'sqlserver'
  );
}

// ハッシュ文字列（例: "#/install/verdaccio"）から Route オブジェクトへ変換する
function parseHash(hash: string): Route {
  // 先頭の '#' および '/' を除去してパス文字列を取り出す
  const path = hash.replace(/^#\/?/, '') || '';
  // パスを '/' で分割して各セグメントに分ける
  const [seg0, seg1] = path.split('/');

  // "#/install/:component" にマッチする場合
  if (seg0 === 'install' && isComponentKind(seg1)) {
    return { page: 'install', component: seg1 };
  }
  // "#/uninstall/:component" にマッチする場合
  if (seg0 === 'uninstall' && isComponentKind(seg1)) {
    return { page: 'uninstall', component: seg1 };
  }
  // "#/settings" にマッチする場合
  if (seg0 === 'settings') {
    return { page: 'settings' };
  }
  // "#/component/:component" にマッチする場合（将来の詳細画面用）
  if (seg0 === 'component' && isComponentKind(seg1)) {
    return { page: 'detail', component: seg1 };
  }
  // "#/plugins" にマッチする場合（Backstage プラグイン管理画面）
  if (seg0 === 'plugins') {
    return { page: 'plugins' };
  }
  // 上記いずれにもマッチしない場合は Overview にフォールバックする
  return { page: 'overview' };
}

// Route オブジェクトをハッシュ文字列（例: "#/install/verdaccio"）に変換する
export function routeToHash(route: Route): string {
  // ルート種別ごとにハッシュ文字列を生成して返す
  switch (route.page) {
    // Overview はルートパスとする
    case 'overview':
      return '#/';
    // Install・Uninstall・Detail にはコンポーネント名をパスに含める
    case 'install':
      return `#/install/${route.component}`;
    case 'uninstall':
      return `#/uninstall/${route.component}`;
    case 'settings':
      return '#/settings';
    case 'detail':
      return `#/component/${route.component}`;
    // plugins ページはルートパスに "plugins" を付ける
    case 'plugins':
      return '#/plugins';
  }
}

/* ============================================================
   ルーターの状態管理（useReducer）
   ============================================================ */

// ルーター状態を変化させる唯一のアクション型
type RouterAction = { type: 'navigate'; route: Route };

// ルーター状態を更新する純粋なリデューサー関数
function routerReducer(_state: Route, action: RouterAction): Route {
  // navigate アクションを受け取ったとき新しいルートに置き換える
  if (action.type === 'navigate') return action.route;
  // 未知のアクションは現在の状態をそのまま返す
  return _state;
}

/* ============================================================
   RouterContext: ルーター情報を子コンポーネントに伝達するコンテキスト
   ============================================================ */

// RouterContext が提供する値の型定義
interface RouterContextValue {
  // 現在アクティブなルート
  route: Route;
  // 指定したルートに遷移する関数（hash を更新して hashchange を発火させる）
  navigate: (route: Route) => void;
  // ナビゲーション前に呼ばれるガード関数への ref（false を返すと遷移をキャンセルする）
  // null の場合はガードなし（ガード不要ページはデフォルト）
  guardRef: React.MutableRefObject<(() => boolean) | null>;
}

// ルーター情報を子コンポーネントに伝達するためのコンテキストオブジェクト
const RouterContext = createContext<RouterContextValue | null>(null);

/* ============================================================
   RouterProvider: アプリ全体を包むルータープロバイダーコンポーネント
   ============================================================ */

// アプリ全体にルーティング機能を提供するプロバイダーコンポーネント
export function RouterProvider({ children }: { children: React.ReactNode }) {
  // 初期ルートを現在の location.hash から解析して設定する
  const [route, dispatch] = useReducer(
    routerReducer,
    // 初期値: ページロード時の location.hash を解析する
    parseHash(location.hash)
  );

  // ナビゲーションガード関数を格納する ref（null = ガードなし）
  // useNavigationGuard フックがマウント時に設定し、アンマウント時に null に戻す
  const guardRef = useRef<(() => boolean) | null>(null);

  // ブラウザの戻る/進むボタン対応のため hashchange を監視する副作用
  // （navigate 関数からの hash 更新ではなく、ユーザーの外部操作のみを対象にする）
  useEffect(() => {
    // ハッシュが変わったときルートを再解析して状態を更新するハンドラ
    const handler = () => {
      dispatch({ type: 'navigate', route: parseHash(location.hash) });
    };
    // window に hashchange イベントリスナーを登録する
    window.addEventListener('hashchange', handler);
    // アンマウント時にリスナーを解除してメモリリークを防ぐ
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // 指定した Route に遷移する関数
  // Tauri の WebView では location.hash への代入が hashchange を発火させない場合があるため
  // dispatch を直接呼び出してルーター状態を即座に更新する
  const navigate = (next: Route) => {
    // ナビゲーションガードが登録されており false を返した場合は遷移をキャンセルする
    if (guardRef.current && !guardRef.current()) return;
    // React の状態を即座に更新してページを切り替える（hashchange 経由に依存しない）
    dispatch({ type: 'navigate', route: next });
    // URL の hash も同期させてブラウザの戻る/進むに対応する
    location.hash = routeToHash(next);
  };

  // ルーター情報をコンテキスト経由で子コンポーネントに提供する
  return (
    <RouterContext.Provider value={{ route, navigate, guardRef }}>
      {children}
    </RouterContext.Provider>
  );
}

/* ============================================================
   useRouter: RouterContext を取得するカスタムフック
   ============================================================ */

// 現在のルートと navigate 関数を取得するカスタムフック
export function useRouter(): RouterContextValue {
  // コンテキストから値を取得する
  const ctx = useContext(RouterContext);
  // RouterProvider の外で呼ばれた場合は明確なエラーを投げる
  if (!ctx) throw new Error('useRouter は RouterProvider の内部でのみ使用できます');
  // ルーター情報を返す
  return ctx;
}

/* ============================================================
   useNavigationGuard: ナビゲーション離脱ガードフック
   ============================================================ */

// ナビゲーション離脱を条件付きで阻止するカスタムフック
// when=true の間、navigate() が呼ばれる前に guard() を実行し、
// guard() が false を返した場合は遷移をキャンセルする
export function useNavigationGuard(when: boolean, guard: () => boolean): void {
  // RouterContext の guardRef を取得する
  const { guardRef } = useRouter();
  // guard 関数を ref で保持して、useEffect の依存配列に含めなくても最新を参照できるようにする
  const guardFnRef = useRef(guard);
  // guard 関数が変わるたびに ref を更新する
  useEffect(() => {
    guardFnRef.current = guard;
  });
  // when フラグに応じて guardRef にガード関数を設定・解除する
  useEffect(() => {
    if (when) {
      // when=true の間、guardRef に最新の guard 関数を委譲するラッパーを設定する
      guardRef.current = () => guardFnRef.current();
    } else {
      // when=false のとき、またはアンマウント時は guardRef を null に戻す
      guardRef.current = null;
    }
    // アンマウント時には必ず null に戻してガード残存を防ぐ
    return () => { guardRef.current = null; };
  }, [when, guardRef]);
}
