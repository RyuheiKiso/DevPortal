// shared クレートの greeting 関数を取り込む
use shared::greeting;

// バイナリのエントリポイント
fn main() {
    // greeting() の戻り値を標準出力に表示する
    println!("{}", greeting());
}
