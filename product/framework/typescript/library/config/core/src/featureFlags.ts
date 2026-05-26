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
//
// overrides で明示的に undefined が指定されたキーは無視する。
// （Record<F, boolean> 型を保つため。spread だと undefined で base を上書きしてしまう）
export function withOverrides<F extends string>(
  // ベースとなるフラグマップ
  base: Record<F, boolean>,
  // 上書きしたいフラグの部分集合
  overrides: Partial<Record<F, boolean>>,
): Record<F, boolean> {
  // undefined 値を持つキーを除いた filtered オブジェクトを構築
  const filtered = Object.fromEntries(
    // overrides のエントリから値が undefined のものを除外する
    Object.entries(overrides).filter(([, v]) => v !== undefined),
  ) as Partial<Record<F, boolean>>;
  // 浅いマージで新しいオブジェクトを返却（undefined 上書きを起こさない）
  return { ...base, ...filtered } as Record<F, boolean>;
}
