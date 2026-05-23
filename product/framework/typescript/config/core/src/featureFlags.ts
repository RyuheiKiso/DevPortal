// 指定フラグが有効かを判定する
// flags が undefined のキーを引かれた場合は false 扱い
export function isFeatureEnabled<F extends string>(
  // フラグ全体のマップ
  flags: Record<F, boolean>,
  // 判定対象のフラグ名
  name: F,
): boolean {
  // 値が真であれば有効、それ以外は無効
  return flags[name] === true;
}

// ベースのフラグセットに上書きを適用したコピーを返す
// 元のオブジェクトは変更しない（イミュータブル）
export function withOverrides<F extends string>(
  // ベースとなるフラグマップ
  base: Record<F, boolean>,
  // 上書きしたいフラグの部分集合
  overrides: Partial<Record<F, boolean>>,
): Record<F, boolean> {
  // 浅いマージで新しいオブジェクトを返却
  return { ...base, ...overrides } as Record<F, boolean>;
}
