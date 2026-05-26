// ============================================================================
// K1s0Camera.cpp
// react-native-windows NativeModule の実装。Windows.Media.Capture をラップし
// JS 側に静止画・動画・権限・デバイス列挙の 7 つの非同期メソッドを公開する。
//
// 本ファイルは @k1s0-ts-camera/react-native パッケージが配布する Windows
// ネイティブモジュールサンプルです。利用者プロジェクトの
//   windows/<AppName>/
// 直下にコピーして、.vcxproj に
//   <ClCompile Include="K1s0Camera.cpp" />
// として登録してください。
//
// 必要な権限（Package.appxmanifest）:
//   <DeviceCapability Name="webcam" />
//   <DeviceCapability Name="microphone" />  (動画録画でマイクを使う場合)
// ============================================================================

// プリコンパイル済みヘッダ（react-native-windows プロジェクトの慣例）
#include "pch.h"
// 同一階層のヘッダ
#include "K1s0Camera.h"
// CoCreateGuid / StringFromGUID2 のため
#include <winrt/Windows.Foundation.h>
#include <combaseapi.h>

// 名前空間のエイリアス（記述量を減らす目的）
using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Foundation::Collections;
using namespace Windows::Media::Capture;
using namespace Windows::Media::MediaProperties;
using namespace Windows::Storage;
using namespace Windows::Storage::Streams;
using namespace Windows::Devices::Enumeration;
using namespace Microsoft::ReactNative;

namespace winrt::K1s0CameraNative::implementation
{
    // ---- 内部ユーティリティ ----

    // GUID 文字列の生成（session ID / recording ID 用）
    // Windows 標準の CoCreateGuid → StringFromGUID2 を使い、中括弧 {} を取り除く
    static std::wstring NewGuidString()
    {
        // GUID 構造体を確保
        GUID guid;
        // GUID を生成（失敗時は HRESULT を例外化する余地もあるが、本サンプルでは省略）
        ::CoCreateGuid(&guid);
        // 文字列化バッファ（38 文字 + NUL 終端 + 余裕で 40）
        wchar_t buf[40] = {};
        // GUID → 文字列に変換（中括弧つき "{xxxxx-xxxx-...}" 形式で返る）
        ::StringFromGUID2(guid, buf, ARRAYSIZE(buf));
        // 先頭 '{' を捨てるため +1 で受け、末尾 '}' を pop_back で除去
        std::wstring s(buf + 1);
        s.pop_back();
        // 中括弧を取り除いた純粋な UUID 文字列を返す
        return s;
    }

    // ---- 公開メソッドの実装 ----

    // listDevices: VideoCapture 種別のデバイスを列挙して JSValueArray に整形
    IAsyncOperation<JSValueArray> K1s0Camera::ListDevices() noexcept
    {
        // JS 側に返す配列
        JSValueArray result;
        try {
            // DeviceClass::VideoCapture でカメラデバイスのみ列挙
            auto devices = co_await DeviceInformation::FindAllAsync(DeviceClass::VideoCapture);
            // 各デバイスを { id, label } に整形して配列に push
            for (auto const& d : devices) {
                JSValueObject entry;
                // DeviceInformation.Id は OS が一意に振る不透明 ID
                entry["id"] = winrt::to_string(d.Id());
                // DeviceInformation.Name は人間可読の表示名（UI 列挙で使う）
                entry["label"] = winrt::to_string(d.Name());
                result.push_back(std::move(entry));
            }
        } catch (...) {
            // 列挙失敗時は空配列を返す（JS 側に例外を投げない設計）
        }
        co_return result;
    }

    // requestPermission: MediaCapture を初期化試行し結果を権限文字列にマップ
    // Windows の Permissions API は無いので、初期化試行が事実上の権限確認となる
    // 結果は m_cachedPermission に保存され、以降の GetCurrentPermission で副作用なしに参照可能
    IAsyncOperation<hstring> K1s0Camera::RequestPermission(bool needMicrophone) noexcept
    {
        // 結果の権限文字列（早期 return パスでも一貫してキャッシュ更新するためローカル変数化）
        std::wstring result;
        try {
            // 一時 MediaCapture を作って初期化テスト
            MediaCapture testCapture;
            // 初期化設定（カメラのみ or カメラ+マイク）
            MediaCaptureInitializationSettings settings;
            settings.StreamingCaptureMode(
                needMicrophone ? StreamingCaptureMode::AudioAndVideo
                               : StreamingCaptureMode::Video);
            // 初期化（権限ダイアログが OS から自動表示されることがある）
            co_await testCapture.InitializeAsync(settings);
            // 成功なら granted（テスト用 capture を即解放）
            testCapture.Close();
            result = L"granted";
        } catch (winrt::hresult_error const& ex) {
            // E_ACCESSDENIED はユーザー拒否
            if (ex.code() == E_ACCESSDENIED) {
                // Windows ではユーザーが「プライバシ設定」で OFF にしている可能性が高い → blocked 扱い
                // （iOS/Android のような prompt/denied 区別は WinRT には無い）
                result = L"blocked";
            } else {
                // それ以外（HW 不在、ドライバ問題等）は unavailable
                result = L"unavailable";
            }
        } catch (...) {
            // 未知の例外も unavailable に集約
            result = L"unavailable";
        }
        // 結果をキャッシュに保存（次回 GetCurrentPermission で副作用なく取り出せる）
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_cachedPermission = result;
        }
        co_return hstring(result);
    }

    // getCurrentPermission: キャッシュから現在の権限状態を非破壊で返す
    // 設計意図: core 契約「getPermission は副作用なし」を満たすため、ここでは MediaCapture を
    //          一切初期化しない。RequestPermission の結果をキャッシュから読むだけ。
    //          初回（一度も RequestPermission が呼ばれていない）は "prompt" を返し、
    //          利用者の useCameraPermission フックで request 必要と判定させる。
    hstring K1s0Camera::GetCurrentPermission() noexcept
    {
        // ロック取得してキャッシュを読む
        std::lock_guard<std::mutex> lock(m_mutex);
        // キャッシュ未設定なら prompt（初回判定）
        if (!m_cachedPermission.has_value()) {
            return L"prompt";
        }
        // キャッシュ値を返す（granted / blocked / unavailable）
        return hstring(m_cachedPermission.value());
    }

    // startPreview: MediaCapture を初期化し session ID を発行
    IAsyncOperation<hstring> K1s0Camera::StartPreview(hstring deviceId, bool needAudio) noexcept
    {
        try {
            // MediaCapture を生成
            MediaCapture capture;
            // 初期化設定
            MediaCaptureInitializationSettings settings;
            // 音声含むかどうかをモードで切り替え
            settings.StreamingCaptureMode(
                needAudio ? StreamingCaptureMode::AudioAndVideo
                          : StreamingCaptureMode::Video);
            // deviceId 指定があれば VideoDeviceId に渡す（未指定なら既定カメラ）
            if (!deviceId.empty()) {
                settings.VideoDeviceId(deviceId);
            }
            // 非同期初期化（権限拒否時は hresult_error が飛ぶ）
            co_await capture.InitializeAsync(settings);

            // session ID を発行してマップに登録
            std::wstring sessionId = NewGuidString();
            {
                // ロックして map を編集
                std::lock_guard<std::mutex> lock(m_mutex);
                m_sessions.emplace(sessionId, std::move(capture));
            }
            // JS に session ID を返す
            co_return hstring(sessionId);
        } catch (...) {
            // 失敗時は空文字を返す（JS 側で「session ID が空ならエラー」と判定）
            co_return L"";
        }
    }

    // stopPreview: 該当 session の MediaCapture を解放してマップから除去
    // 設計意図: noexcept 指定下で IAsyncAction を返すが内部に co_await は無く、
    //          MediaCapture.Close() は同期メソッドのため例外が外に漏れることは無い
    IAsyncAction K1s0Camera::StopPreview(hstring sessionId) noexcept
    {
        // wstring に正規化
        std::wstring key(sessionId);
        // ロック取得
        std::lock_guard<std::mutex> lock(m_mutex);
        // 該当 session を検索
        auto it = m_sessions.find(key);
        if (it != m_sessions.end()) {
            try {
                // MediaCapture を Close（HW センサーの即時解放を意図）
                // refcount RAII でも最終的には解放されるが、明示 Close で OS への通知を早める
                it->second.Close();
            } catch (...) {
                // Close 失敗は無視（多くの場合は既に解放済み）
            }
            // マップから除去（Close 後なら例外が出ても map は触らず安全）
            m_sessions.erase(it);
        }
        // 一致しない sessionId が来た場合は no-op（冪等性）
        co_return;
    }

    // takePicture: 静止画を JPEG ファイルに保存
    // 設計意図: noexcept 指定下で co_await を行うが、try/catch で全例外を握って
    //          失敗時は path 空文字を返す（JS 側で空判定可能、HRESULT は JS に漏れない）
    IAsyncOperation<JSValueObject> K1s0Camera::TakePicture(hstring sessionId) noexcept
    {
        // 結果オブジェクト
        JSValueObject result;
        try {
            // session 検索（ロック越しに参照コピー取得し、ロック解放後に await）
            // 注: ここで取得する capture は map 内インスタンスへの refcount コピー。
            //     ローカル変数の寿命終了時に refcount は decrement されるが、
            //     map 側の参照は残り続けるので、ローカルでは明示 Close しない。
            //     Close は StopPreview の責務として一元化している。
            MediaCapture capture{ nullptr };
            {
                std::lock_guard<std::mutex> lock(m_mutex);
                auto it = m_sessions.find(std::wstring(sessionId));
                if (it == m_sessions.end()) {
                    // 不一致なら path 空文字で返す
                    result["path"] = "";
                    co_return result;
                }
                // MediaCapture は参照型なので軽量コピー（refcount +1）
                capture = it->second;
            }
            // 一時フォルダを取得
            auto tempFolder = ApplicationData::Current().TemporaryFolder();
            // GUID 入りファイル名（衝突回避）
            std::wstring fileName = L"photo-" + NewGuidString() + L".jpg";
            // 一時ファイル作成
            auto file = co_await tempFolder.CreateFileAsync(
                fileName, CreationCollisionOption::ReplaceExisting);
            // JPEG エンコーディングプロファイル
            auto profile = ImageEncodingProperties::CreateJpeg();
            // 撮影実行（同期的に「カメラ → ファイル」を行う）
            co_await capture.CapturePhotoToStorageFileAsync(profile, file);
            // パスを返す
            result["path"] = winrt::to_string(file.Path());
            // 解像度（より厳密に取りたい場合は VideoController.GetMediaStreamProperties() を使う）
            // 本サンプルでは固定値で返し、JS 側で厳密値が必要なら別途 API を追加してください
            result["width"] = 1920;
            result["height"] = 1080;
        } catch (...) {
            // 撮影失敗時は path 空文字で返す
            result["path"] = "";
        }
        co_return result;
    }

    // startRecording: 動画録画を開始（MP4 / HD720p）
    // 設計意図:
    //   1. TakePicture と同様に noexcept + try/catch でエラーを空文字に集約
    //   2. StartRecordToStorageFileAsync が失敗した場合、CreateFileAsync で作った
    //      空ファイルを明示的に削除してゴミファイルを残さない
    IAsyncOperation<hstring> K1s0Camera::StartRecording(hstring sessionId) noexcept
    {
        // file 変数を try の外に出すことで、catch ブロックから削除可能にする
        StorageFile file{ nullptr };
        try {
            // session 検索（map 内の MediaCapture への refcount コピーを取得）
            // ローカル変数は明示 Close しない（StopPreview が一元的に解放）
            MediaCapture capture{ nullptr };
            {
                std::lock_guard<std::mutex> lock(m_mutex);
                auto it = m_sessions.find(std::wstring(sessionId));
                if (it == m_sessions.end()) {
                    co_return L"";
                }
                capture = it->second;
            }
            // 一時フォルダを取得
            auto tempFolder = ApplicationData::Current().TemporaryFolder();
            // 録画先 mp4 ファイル名（GUID 込み）
            std::wstring fileName = L"video-" + NewGuidString() + L".mp4";
            // ファイル作成
            file = co_await tempFolder.CreateFileAsync(
                fileName, CreationCollisionOption::ReplaceExisting);
            // HD720p MP4 プロファイル（必要なら HD1080p / Auto などに変更可）
            auto profile = MediaEncodingProfile::CreateMp4(VideoEncodingQuality::HD720p);
            // 録画開始（非同期、Start 完了後すぐ return する）
            // 失敗時は catch ブロックでファイル削除される
            co_await capture.StartRecordToStorageFileAsync(profile, file);
            // recording ID を発行
            std::wstring recordingId = NewGuidString();
            {
                std::lock_guard<std::mutex> lock(m_mutex);
                m_recordings.emplace(recordingId, file);
                m_recordingToSession.emplace(recordingId, std::wstring(sessionId));
            }
            // JS に recording ID を返す
            co_return hstring(recordingId);
        } catch (...) {
            // 失敗時は空文字 + 中途半端な temp ファイルを削除
            if (file != nullptr) {
                try {
                    co_await file.DeleteAsync();
                } catch (...) {
                    // 削除失敗は無視（temp フォルダは OS が定期掃除する）
                }
            }
            co_return L"";
        }
    }

    // stopRecording: 録画停止と成果物パス取得
    // 設計意図:
    //   1. 「成功後に erase」パターンを採用。StopRecordAsync() / GetBasicPropertiesAsync() が
    //      throw した場合、map から削除されず利用者は同じ recordingId で再試行可能。
    //   2. 並行呼び出し race 防御: m_stopInProgress に recordingId を登録することで、
    //      同じ recordingId に対する重複 StopRecordAsync（WinRT で未定義動作）を防ぐ。
    //   3. noexcept + co_await の組み合わせは try/catch で全例外を握ることで担保。
    //      失敗時は path 空文字を返す（JS 側で .length === 0 で判定）。
    IAsyncOperation<JSValueObject> K1s0Camera::StopRecording(hstring recordingId) noexcept
    {
        // 結果オブジェクト
        JSValueObject result;
        // recording ID を wstring に正規化（後段でロック内検索に再利用）
        std::wstring recKey(recordingId);
        // 並行防御フラグの所有状態（catch ブロックで cleanup するか判定するため）
        bool ownsStopGuard = false;
        try {
            // フェーズ 1: ロック内で検索とコピー取得、並行 stop 防御フラグの登録
            MediaCapture capture{ nullptr };
            StorageFile file{ nullptr };
            {
                std::lock_guard<std::mutex> lock(m_mutex);
                // 同じ recordingId で別スレッドが既に StopRecording 中なら早期 return
                // WinRT の StopRecordAsync は同一 MediaCapture への重複呼び出しを許容しない
                if (m_stopInProgress.find(recKey) != m_stopInProgress.end()) {
                    result["path"] = "";
                    co_return result;
                }
                // recording 検索
                auto recIt = m_recordings.find(recKey);
                auto sesIt = m_recordingToSession.find(recKey);
                if (recIt == m_recordings.end() || sesIt == m_recordingToSession.end()) {
                    // 不一致は早期 return（map は触らない）
                    result["path"] = "";
                    co_return result;
                }
                file = recIt->second;
                // session 検索（recording → session のマップ経由）
                auto capIt = m_sessions.find(sesIt->second);
                if (capIt == m_sessions.end()) {
                    // session が消滅していたらエラー（map は触らない）
                    result["path"] = "";
                    co_return result;
                }
                capture = capIt->second;
                // 並行 stop 防御フラグを立てる（このスコープを抜けてもロックは外れない、
                // ロックは } で解放されるが m_stopInProgress への insert は永続）
                m_stopInProgress.insert(recKey);
                ownsStopGuard = true;
                // ⚠ erase はここで行わない。StopRecordAsync 失敗時の再試行可能性を担保するため。
            }

            // フェーズ 2: ロック解放後に非同期 API 呼び出し（時間がかかる）
            // 録画停止（成果物がファイルに flush される）
            co_await capture.StopRecordAsync();
            // ファイルサイズを取得
            auto props = co_await file.GetBasicPropertiesAsync();

            // フェーズ 3: 成功確定後にロックを再取得して map と防御フラグを削除
            {
                std::lock_guard<std::mutex> lock(m_mutex);
                // erase は冪等。並行 StopRecording で既に消えていても害なし
                m_recordings.erase(recKey);
                m_recordingToSession.erase(recKey);
                // 並行防御フラグもここで erase（フェーズ 3 到達 = 成功確定）
                m_stopInProgress.erase(recKey);
                ownsStopGuard = false;
            }

            // 結果を整形
            result["path"] = winrt::to_string(file.Path());
            // JSValueObject は double 用の専用変換のみ持つので明示キャスト
            result["sizeBytes"] = static_cast<double>(props.Size());
        } catch (...) {
            // 失敗時は path 空文字（map には触らないので、利用者は再試行可能）
            // ただし並行防御フラグだけは必ず外す（フラグ漏れで以降 stop が永久に弾かれるのを防ぐ）
            if (ownsStopGuard) {
                std::lock_guard<std::mutex> lock(m_mutex);
                m_stopInProgress.erase(recKey);
            }
            result["path"] = "";
        }
        co_return result;
    }
}
