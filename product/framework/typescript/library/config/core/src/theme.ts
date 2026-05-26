// アプリ全体で共有する UI テーマの型定義
// 拡張プロパティを許容するため colors / spacing / typography 内部は緩めに定義
export interface Theme {
  // 色定義のマップ（primary/background/text を必須、その他は任意）
  colors: {
    // 主要なアクションに使う色
    primary: string;
    // 画面背景色
    background: string;
    // テキスト色
    text: string;
    // 任意の追加色（accent, error 等）
    [key: string]: string;
  };
  // 余白サイズのスケール
  spacing: {
    // 極小（4px 想定）
    xs: number;
    // 小（8px 想定）
    sm: number;
    // 中（16px 想定）
    md: number;
    // 大（24px 想定）
    lg: number;
    // 特大（32px 想定）
    xl: number;
  };
  // フォント関連の設定
  typography: {
    // 既定のフォントファミリ
    fontFamily: string;
    // 本文の基準フォントサイズ
    baseSize: number;
  };
}

// オブジェクトとそのネストをすべて再帰的に Object.freeze する小ヘルパ
// defaultTheme の不可変性を保証するため（利用側からの mutate を防ぐ）
function deepFreeze<T>(value: T): T {
  // オブジェクトまたは配列のときだけ再帰
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    // 値側を先に freeze（参照されている子オブジェクトもまとめて凍結する）
    Object.values(value as Record<string, unknown>).forEach((child) => {
      // 子要素が object/array なら再帰的に freeze
      deepFreeze(child);
    });
    // 自身を freeze
    Object.freeze(value);
  }
  // freeze 済みの値をそのまま返す
  return value;
}

// 各アプリで上書き前提のデフォルトテーマ
// あえて中立的な値にして特定プロダクトのブランドカラーを混入させない
//
// 不変性保証: deepFreeze によりネスト含めて全プロパティが Object.frozen 状態。
// strict mode 下で `defaultTheme.colors.primary = "x"` のような書き換えは TypeError になる。
export const defaultTheme: Theme = deepFreeze({
  // 中立的なグレースケール基調の色
  colors: {
    // 主要色（青系）
    primary: "#3366ff",
    // 背景色（白）
    background: "#ffffff",
    // テキスト色（濃いグレー）
    text: "#1a1a1a",
  },
  // 4 の倍数を基本としたスペーシング
  spacing: {
    // 極小
    xs: 4,
    // 小
    sm: 8,
    // 中
    md: 16,
    // 大
    lg: 24,
    // 特大
    xl: 32,
  },
  // システム標準フォントを既定とする
  typography: {
    // OS 既定のサンセリフ
    fontFamily: "system-ui, sans-serif",
    // 一般的な本文サイズ
    baseSize: 14,
  },
});
