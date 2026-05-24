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

// 各アプリで上書き前提のデフォルトテーマ
// あえて中立的な値にして特定プロダクトのブランドカラーを混入させない
export const defaultTheme: Theme = {
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
};
