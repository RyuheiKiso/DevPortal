// ============================================================================
// ContentView.swift
// SwiftUI 側のルートビュー
// Kotlin の Compose UIViewController を UIViewControllerRepresentable でラップする
// ============================================================================

// SwiftUI フレームワーク
import SwiftUI
// UIKit (UIViewController を扱う基盤)
import UIKit
// KMP ビルドで生成される Kotlin 製フレームワーク
//   - build.gradle.kts の `iosTarget.binaries.framework { baseName = "ComposeApp" }` に一致
import ComposeApp

/// Kotlin で実装した Compose UI を SwiftUI に橋渡しするラッパー。
///
/// `MainViewControllerKt.MainViewController()` は Kotlin の top-level 関数
/// `fun MainViewController()` を Swift から呼び出すための自動生成シンボル。
struct ComposeView: UIViewControllerRepresentable {
    // SwiftUI が UIViewController を生成するタイミングで呼び出される
    func makeUIViewController(context: Context) -> UIViewController {
        // Kotlin 側で構築した UIViewController を返す
        MainViewControllerKt.MainViewController()
    }

    // 状態変化に応じて UIViewController を更新するタイミング (今回は何もしない)
    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

/// アプリのルート SwiftUI View
struct ContentView: View {
    var body: some View {
        // Compose UI を画面いっぱいに広げる
        ComposeView()
            // セーフエリアを無視して画面全体を Compose UI に渡す
            .ignoresSafeArea(.all)
    }
}
