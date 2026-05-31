package com.devportal.config

// 設定の層。優先度の低い順（DEFAULT < SYSTEM < USER）に並べる。
enum class Layer {
    // アプリ同梱の出荷時設定（読取専用）
    DEFAULT,

    // 組織・管理者が配布する設定
    SYSTEM,

    // ユーザーごとの個人設定
    USER,
}

// 書き込み可能な層。既定(bundle)は同梱リソースのため対象外。
enum class WritableScope {
    // システム層
    SYSTEM,

    // ユーザー層
    USER,
}

// WritableScope を対応する Layer に変換する内部ヘルパ。
internal fun WritableScope.toLayer(): Layer = when (this) {
    // システム書込はシステム層へ
    WritableScope.SYSTEM -> Layer.SYSTEM
    // ユーザー書込はユーザー層へ
    WritableScope.USER -> Layer.USER
}
