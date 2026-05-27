// ============================================================================
// iOSApp.swift
// iOS アプリのエントリポイント (SwiftUI @main)
// 起動時に ContentView を表示し、その内部に Compose Multiplatform の UI を載せる
// ============================================================================

// SwiftUI フレームワーク (App / Scene / WindowGroup を提供)
import SwiftUI

// @main は iOS アプリのエントリ宣言 (Info.plist の UIApplicationMain と等価)
@main
struct iOSApp: App {
    // App プロトコル要件: アプリのシーン階層を定義する
    var body: some Scene {
        // 単一ウィンドウグループ (iPhone は事実上 1 ウィンドウ)
        WindowGroup {
            // ルートビューとして ContentView を配置
            ContentView()
        }
    }
}
