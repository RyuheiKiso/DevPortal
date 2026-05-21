// Hello World 文字列を返す共通関数（cli と gui-backend の両方から利用される）
pub fn greeting() -> &'static str {
    // 固定文字列 "Hello World" を返す
    "Hello World"
}

// このモジュールの単体テストを定義するブロック
#[cfg(test)]
mod tests {
    // 親モジュールのアイテム（greeting）を取り込む
    use super::*;

    // greeting() が "Hello World" を返すことを確認するテスト
    #[test]
    fn greeting_returns_hello_world() {
        // 期待値と実際の戻り値を比較
        assert_eq!(greeting(), "Hello World");
    }
}
