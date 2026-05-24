// このファイルは Windows の管理者権限確認と昇格（runas）の機能を実装する
// cfg(windows) と cfg(not(windows)) で OS ごとの実装を切り替える

// 独自エラー型を参照するために使用する
use crate::error::SetupError;

// Windows 専用の実装ブロック
#[cfg(windows)]
mod windows_impl {
    // Windows API を呼び出すために必要な型と関数をインポートする
    // winapi クレートの processthreadsapi から OpenProcessToken を使用する
    use std::ptr::null_mut;
    // Windows ファイルシステムパスを UTF-16 に変換するトレイトをインポートする
    use std::os::windows::ffi::OsStrExt;

    // Windows の BOOL 型（i32）を使用する
    type Bool = i32;
    // Windows の HANDLE 型（void ポインタ）を使用する
    type Handle = *mut std::ffi::c_void;
    // Windows の DWORD 型（u32）を使用する
    type Dword = u32;

    // TOKEN_ELEVATION 構造体（TokenIsElevated フィールドを持つ）
    #[repr(C)]
    struct TokenElevation {
        // 0 以外のとき昇格済みであることを示す
        token_is_elevated: Dword,
    }

    // TOKEN_INFORMATION_CLASS の TokenElevation 値（定数として定義）
    const TOKEN_ELEVATION_CLASS: u32 = 20;

    // TOKEN_QUERY アクセス権（GetTokenInformation に必要）
    const TOKEN_QUERY: Dword = 0x0008;

    // GetCurrentProcess を外部関数として宣言する
    extern "system" {
        // 現在のプロセスの疑似ハンドルを返す関数
        fn GetCurrentProcess() -> Handle;
        // プロセスのアクセストークンを開く関数
        fn OpenProcessToken(
            // 対象プロセスのハンドル
            process_handle: Handle,
            // 要求するアクセス権
            desired_access: Dword,
            // トークンハンドルの出力先ポインタ
            token_handle: *mut Handle,
        ) -> Bool;
        // トークンの情報を取得する関数
        fn GetTokenInformation(
            // トークンハンドル
            token_handle: Handle,
            // 取得する情報のクラス
            token_information_class: u32,
            // 情報を受け取るバッファ
            token_information: *mut std::ffi::c_void,
            // バッファのサイズ（バイト）
            token_information_length: Dword,
            // 実際に書き込まれたバイト数の出力先
            return_length: *mut Dword,
        ) -> Bool;
        // ハンドルを閉じる関数
        fn CloseHandle(object: Handle) -> Bool;
    }

    // 現在のプロセスが管理者権限（Elevated）で動作しているかを返す Windows 実装
    pub fn is_elevated_impl() -> bool {
        // トークンハンドルを格納する変数（null で初期化）
        let mut token_handle: Handle = null_mut();

        // 現在のプロセスのトークンを TOKEN_QUERY 権限で開く
        let open_result = unsafe {
            // OpenProcessToken を呼び出してプロセスのトークンを取得する
            OpenProcessToken(
                // 現在のプロセスの疑似ハンドルを渡す
                GetCurrentProcess(),
                // TOKEN_QUERY アクセス権を要求する
                TOKEN_QUERY,
                // トークンハンドルの出力先を渡す
                &mut token_handle,
            )
        };

        // OpenProcessToken が失敗した場合は非昇格とみなす
        if open_result == 0 {
            // 失敗した場合は false を返す
            return false;
        }

        // TOKEN_ELEVATION 構造体をゼロ初期化する
        let mut elevation = TokenElevation {
            // 初期値は 0（非昇格）
            token_is_elevated: 0,
        };
        // GetTokenInformation が実際に書き込んだバイト数を格納する変数
        let mut return_length: Dword = 0;

        // GetTokenInformation で昇格情報を取得する
        let info_result = unsafe {
            // GetTokenInformation を呼び出して昇格状態を確認する
            GetTokenInformation(
                // 先ほど開いたトークンハンドルを渡す
                token_handle,
                // TokenElevation 情報クラスを指定する
                TOKEN_ELEVATION_CLASS,
                // elevation 構造体のポインタをキャストして渡す
                &mut elevation as *mut TokenElevation as *mut std::ffi::c_void,
                // 構造体のサイズを渡す
                std::mem::size_of::<TokenElevation>() as Dword,
                // 実際の書き込みサイズの出力先を渡す
                &mut return_length,
            )
        };

        // 使い終わったトークンハンドルを閉じてリソースを解放する
        unsafe {
            // CloseHandle でカーネルオブジェクトを解放する
            CloseHandle(token_handle);
        }

        // GetTokenInformation が成功し、かつ昇格フィールドが 0 以外なら true を返す
        info_result != 0 && elevation.token_is_elevated != 0
    }

    fn quote_arg(arg: &str) -> String {
        if !arg.is_empty()
            && !arg
                .chars()
                .any(|ch| matches!(ch, ' ' | '\t' | '\n' | '\r' | '"'))
        {
            return arg.to_string();
        }

        let mut quoted = String::from("\"");
        let mut backslashes = 0usize;

        for ch in arg.chars() {
            match ch {
                '\\' => {
                    backslashes += 1;
                }
                '"' => {
                    quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
                    quoted.push('"');
                    backslashes = 0;
                }
                _ => {
                    quoted.push_str(&"\\".repeat(backslashes));
                    backslashes = 0;
                    quoted.push(ch);
                }
            }
        }

        quoted.push_str(&"\\".repeat(backslashes * 2));
        quoted.push('"');
        quoted
    }

    fn join_args(args: &[&str]) -> String {
        args.iter()
            .map(|arg| quote_arg(arg))
            .collect::<Vec<_>>()
            .join(" ")
    }

    // 自身のプロセスを runas（管理者権限）で再起動する Windows 実装
    pub fn run_self_elevated_impl(args: &[&str]) -> Result<(), crate::error::SetupError> {
        // ShellExecuteW を使うために必要な型を定義する
        type Hwnd = *mut std::ffi::c_void;
        // HINSTANCE は void ポインタとして扱う
        type Hinstance = *mut std::ffi::c_void;
        // SW_SHOWDEFAULT ウィンドウ表示フラグの定数値
        const SW_SHOWDEFAULT: i32 = 10;

        // ShellExecuteW を外部関数として宣言する
        extern "system" {
            // ShellExecuteW: 指定した動詞でファイルを実行する関数
            fn ShellExecuteW(
                // 親ウィンドウハンドル（NULL で可）
                hwnd: Hwnd,
                // 操作動詞の Unicode 文字列ポインタ
                lp_operation: *const u16,
                // 実行ファイルの Unicode 文字列ポインタ
                lp_file: *const u16,
                // パラメータの Unicode 文字列ポインタ
                lp_parameters: *const u16,
                // 作業ディレクトリの Unicode 文字列ポインタ（NULL 可）
                lp_directory: *const u16,
                // ウィンドウ表示フラグ
                n_show_cmd: i32,
            ) -> Hinstance;
        }

        // 現在の実行ファイルのパスを取得する
        let exe_path = std::env::current_exe()
            // 実行ファイルパス取得失敗を SetupError::Other にラップする
            .map_err(|e| {
                crate::error::SetupError::Other(format!("実行ファイルパス取得失敗: {e}"))
            })?;

        // exe_path を UTF-16 の null 終端文字列に変換する
        let exe_wide: Vec<u16> = exe_path
            // OsStr に変換してから UTF-16 にエンコードする
            .as_os_str()
            // Windows のワイド文字列にエンコードする
            .encode_wide()
            // null 終端文字を追加する
            .chain(std::iter::once(0))
            // ベクタに収集する
            .collect();

        // 追加引数を Windows のコマンドライン規則に従って結合する
        let params_str = join_args(args);
        // params_str を UTF-16 の null 終端文字列に変換する
        let params_wide: Vec<u16> = params_str
            // OsStr 経由でエンコードする
            .encode_utf16()
            // null 終端文字を追加する
            .chain(std::iter::once(0))
            // ベクタに収集する
            .collect();

        // "runas" 動詞を UTF-16 の null 終端文字列に変換する
        let verb: Vec<u16> = "runas"
            // UTF-16 にエンコードする
            .encode_utf16()
            // null 終端文字（U+0000）を末尾に追加する
            .chain(std::iter::once(0u16))
            // ベクタに収集する
            .collect();

        // ShellExecuteW で管理者権限（runas）として自身を再起動する
        let result = unsafe {
            // ShellExecuteW を呼び出して昇格プロセスを起動する
            ShellExecuteW(
                // 親ウィンドウなし
                null_mut(),
                // "runas" 動詞で管理者として実行する
                verb.as_ptr(),
                // 現在の実行ファイルのパス
                exe_wide.as_ptr(),
                // 追加引数（空の場合は空文字列）
                if params_str.is_empty() {
                    // 引数なしの場合は null ポインタを渡す
                    null_mut()
                } else {
                    // 引数ありの場合はパラメータ文字列のポインタを渡す
                    params_wide.as_ptr()
                },
                // 作業ディレクトリは指定しない
                null_mut(),
                // デフォルトのウィンドウ表示モード
                SW_SHOWDEFAULT,
            )
        };

        // ShellExecuteW の戻り値が 32 以下の場合はエラーとみなす（32 超 = 成功）
        if (result as usize) <= 32 {
            // 昇格起動に失敗した場合はエラーを返す
            return Err(crate::error::SetupError::Other(
                // エラーコードを含むメッセージを構築する
                format!("ShellExecuteW 失敗: コード {}", result as usize),
            ));
        }

        // 昇格プロセスの起動に成功した場合は Ok(()) を返す
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::join_args;

        #[test]
        fn join_args_quotes_paths_with_spaces() {
            let args = ["--config", r"C:\ProgramData\Dev Portal\setup.toml"];
            assert_eq!(
                join_args(&args),
                r#"--config "C:\ProgramData\Dev Portal\setup.toml""#
            );
        }

        #[test]
        fn join_args_escapes_quotes_and_trailing_slashes() {
            let args = [r#"C:\Temp\quoted "name"\"#];
            assert_eq!(join_args(&args), r#""C:\Temp\quoted \"name\"\\""#);
        }
    }
}

// 現在のプロセスが管理者権限（Elevated）で動作しているかを返す公開関数
// Windows: OpenProcessToken + GetTokenInformation(TokenElevation) を使用
// 非 Windows（テスト環境等）: 常に false を返す
pub fn is_elevated() -> bool {
    // Windows 環境では実際の権限確認を行う
    #[cfg(windows)]
    {
        // Windows 専用実装を呼び出す
        windows_impl::is_elevated_impl()
    }
    // 非 Windows 環境ではスタブとして常に false を返す
    #[cfg(not(windows))]
    {
        // テスト・CI 環境では管理者権限なしとして扱う
        false
    }
}

// 自身のプロセスを runas（管理者権限）で再起動する公開関数
// args: 再起動時に渡す追加引数（通常 "--no-elevate" を含める）
// Windows: ShellExecuteW で lpVerb="runas" を使用
// 非 Windows: スタブとして Ok(()) を返す
pub fn run_self_elevated(args: &[&str]) -> Result<(), SetupError> {
    // Windows 環境では実際の昇格再起動を行う
    #[cfg(windows)]
    {
        // Windows 専用実装を呼び出す
        windows_impl::run_self_elevated_impl(args)
    }
    // 非 Windows 環境ではスタブとして常に Ok(()) を返す
    #[cfg(not(windows))]
    {
        // args は使用しないが未使用警告を抑制する
        let _ = args;
        // テスト・CI 環境では成功として扱う
        Ok(())
    }
}
