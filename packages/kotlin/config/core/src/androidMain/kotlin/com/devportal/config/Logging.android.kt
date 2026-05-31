package com.devportal.config

// Android のログ出力 API
import android.util.Log

// Android では警告ログを logcat（タグ "config"）に書き出す。
internal actual fun logWarning(message: String, throwable: Throwable?) {
    // 警告レベルでメッセージと例外を logcat に出す
    Log.w("config", message, throwable)
}
