package com.devportal.config

// 警告レベルのログをプラットフォーム別に出力する内部関数。
// Desktop は標準エラー出力、Android は logcat へ書き出す。
internal expect fun logWarning(message: String, throwable: Throwable?)
