package com.devportal.config

// Desktop(JVM) では警告ログを標準エラー出力に書き出す。
internal actual fun logWarning(message: String, throwable: Throwable?) {
    // 警告メッセージを標準エラーへ出力する
    System.err.println("[WARN] config: $message")
    // 例外があればスタックトレースも出力する
    throwable?.printStackTrace()
}
