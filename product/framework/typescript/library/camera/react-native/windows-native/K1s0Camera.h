// ============================================================================
// K1s0Camera.h
// react-native-windows NativeModule のヘッダ。REACT_MODULE / REACT_METHOD
// アトリビュートで JS 側に公開するメソッドを宣言する。
//
// 本ファイルは @k1s0-ts-camera/react-native パッケージが配布する Windows
// ネイティブモジュールサンプルです。利用者プロジェクトの
//   windows/<AppName>/
// 直下にコピーして、同階層の .vcxproj に
//   <ClInclude Include="K1s0Camera.h" />
//   <ClCompile Include="K1s0Camera.cpp" />
// として登録してください。
//
// 公開メソッド（JS 側からは Promise として呼び出せる）:
//   - listDevices()                              -> Array<{ id, label }>
//   - requestPermission(needMicrophone)          -> "granted" | "denied" | "blocked" | "unavailable"
//   - startPreview(deviceId, needAudio)          -> sessionId (空文字 = 失敗)
//   - stopPreview(sessionId)                     -> void
//   - takePicture(sessionId)                     -> { path, width, height }
//   - startRecording(sessionId)                  -> recordingId (空文字 = 失敗)
//   - stopRecording(recordingId)                 -> { path, sizeBytes }
// ============================================================================

#pragma once

// React Native Windows の Native Module 用ヘッダ（REACT_MODULE / REACT_METHOD を提供）
#include "NativeModules.h"
// Microsoft.ReactNative 名前空間（JSValueArray / JSValueObject の解決を明示化）
// NativeModules.h 経由でも取り込まれることが多いが、ビルド可搬性のため明示 include する
#include <winrt/Microsoft.ReactNative.h>
// Windows.Media.Capture WinRT 名前空間（カメラ本体 API）
#include <winrt/Windows.Media.Capture.h>
// MediaEncodingProfile / ImageEncodingProperties など（録画・撮影の MIME 設定）
#include <winrt/Windows.Media.MediaProperties.h>
// StorageFile / ApplicationData など（成果物の一時保存先）
#include <winrt/Windows.Storage.h>
// IInputStream / IRandomAccessStream（録画ストリーム周辺で必要になる場合のため取り込み）
#include <winrt/Windows.Storage.Streams.h>
// DeviceInformation（カメラデバイスの列挙に使用）
#include <winrt/Windows.Devices.Enumeration.h>
// IVector / IMap（WinRT コレクション）
#include <winrt/Windows.Foundation.Collections.h>
// 標準 STL（session/recording の管理マップと排他制御）
#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <string>

// 本サンプルの WinRT 名前空間（K1s0CameraNative.idl と一致させる）
namespace winrt::K1s0CameraNative::implementation
{
    // REACT_MODULE: JS 側に公開するモジュール名を "K1s0Camera" として登録
    // ReactPackageProvider.cpp の CreatePackage で AddAttributedModules 経由で取り込まれる
    //
    // 設計意図（noexcept + co_await について）:
    //   以下の各メソッドは IAsyncOperation/IAsyncAction を返す async メソッドだが、
    //   REACT_METHOD の慣習として noexcept を付与している。
    //   C++20 spec では noexcept 指定下で co_await が throw すると未定義挙動になるが、
    //   各実装は内部で try/catch して全例外を握り、失敗を空文字や空オブジェクトで
    //   返す設計のため、例外が外に漏れることは無い（K1s0Camera.cpp 参照）。
    REACT_MODULE(K1s0Camera);
    struct K1s0Camera
    {
        // ---- 公開メソッド宣言 ----
        // 利用可能カメラデバイスの列挙
        // 戻り値: [{ id: string, label: string }, ...]
        REACT_METHOD(ListDevices, L"listDevices");
        winrt::Windows::Foundation::IAsyncOperation<winrt::Microsoft::ReactNative::JSValueArray>
            ListDevices() noexcept;

        // 権限要求（MediaCapture の初期化を試行し、結果を権限文字列にマップして返す）
        // 引数 needMicrophone: true なら AudioAndVideo モードで初期化テスト
        // 戻り値: "granted" | "denied" | "blocked" | "unavailable"
        // 副作用: 初回呼び出し時に OS の権限ダイアログを表示する可能性あり
        // 結果は m_cachedPermission にキャッシュされ、以降の GetCurrentPermission で参照される
        REACT_METHOD(RequestPermission, L"requestPermission");
        winrt::Windows::Foundation::IAsyncOperation<winrt::hstring>
            RequestPermission(bool needMicrophone) noexcept;

        // 現在の権限状態を非破壊で取得（OS ダイアログを表示しない）
        // Windows には Permissions API が無いため、RequestPermission のキャッシュを参照する
        // 戻り値:
        //   - 一度も RequestPermission が呼ばれていない: "prompt"
        //   - 過去に成功した:                            "granted"
        //   - 過去に拒否された:                          "blocked"
        //   - 過去にハードウェア問題:                    "unavailable"
        // この実装は core 契約「getPermission は副作用なし」を満たすために存在する
        REACT_METHOD(GetCurrentPermission, L"getCurrentPermission");
        winrt::hstring GetCurrentPermission() noexcept;

        // プレビュー開始（MediaCapture を生成し session ID を発行）
        // 引数 deviceId: 空文字なら既定カメラ、それ以外なら指定 ID を選択
        // 引数 needAudio: true ならマイクも有効化（録画用前提）
        // 戻り値: session ID（UUID 文字列、以後の操作で使う / 空文字 = 失敗）
        REACT_METHOD(StartPreview, L"startPreview");
        winrt::Windows::Foundation::IAsyncOperation<winrt::hstring>
            StartPreview(winrt::hstring deviceId, bool needAudio) noexcept;

        // プレビュー停止（MediaCapture を解放）
        // session ID 不一致時は何もしない（冪等性確保）
        REACT_METHOD(StopPreview, L"stopPreview");
        winrt::Windows::Foundation::IAsyncAction
            StopPreview(winrt::hstring sessionId) noexcept;

        // 静止画キャプチャ（JPEG として一時フォルダに保存）
        // 戻り値: { path: string, width: number, height: number }
        // path が空文字なら撮影失敗
        REACT_METHOD(TakePicture, L"takePicture");
        winrt::Windows::Foundation::IAsyncOperation<winrt::Microsoft::ReactNative::JSValueObject>
            TakePicture(winrt::hstring sessionId) noexcept;

        // 動画録画開始（MP4 + HD720p で一時フォルダに保存開始）
        // 戻り値: recording ID（空文字 = 失敗）
        REACT_METHOD(StartRecording, L"startRecording");
        winrt::Windows::Foundation::IAsyncOperation<winrt::hstring>
            StartRecording(winrt::hstring sessionId) noexcept;

        // 動画録画停止（成果物パスとサイズを返す）
        // 戻り値: { path: string, sizeBytes: number }
        REACT_METHOD(StopRecording, L"stopRecording");
        winrt::Windows::Foundation::IAsyncOperation<winrt::Microsoft::ReactNative::JSValueObject>
            StopRecording(winrt::hstring recordingId) noexcept;

    private:
        // ---- 内部状態 ----
        // session ID → MediaCapture インスタンスのマップ（複数同時 preview を許可）
        std::map<std::wstring, winrt::Windows::Media::Capture::MediaCapture> m_sessions;
        // recording ID → 録画先ファイル参照
        std::map<std::wstring, winrt::Windows::Storage::StorageFile> m_recordings;
        // recording ID → 紐づく session ID（stopRecording 時に MediaCapture を引き当てるため）
        std::map<std::wstring, std::wstring> m_recordingToSession;
        // 進行中の StopRecording を追跡（並行呼び出し race 防御）
        // フェーズ 1 で insert、フェーズ 3 と catch で erase
        std::set<std::wstring> m_stopInProgress;
        // 権限状態のキャッシュ（RequestPermission で更新、GetCurrentPermission で参照）
        // std::nullopt = まだ一度も RequestPermission が呼ばれていない（= "prompt"）
        std::optional<std::wstring> m_cachedPermission;
        // 排他制御用（NativeModule の各メソッドは別スレッドで実行され得るため必須）
        std::mutex m_mutex;
    };
}
