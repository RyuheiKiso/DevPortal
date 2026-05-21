// Tauri のビルドスクリプトのエントリポイント
fn main() {
    // Windows 向けビルド時に UAC 昇格要求マニフェストを埋め込む
    // tauri_build::WindowsAttributes::app_manifest() を使って
    // tauri のデフォルトマニフェスト（Common Controls v6）と UAC 設定を統合する
    let attributes = {
        #[cfg(target_os = "windows")]
        {
            // requireAdministrator: 起動時に UAC 確認を求めて管理者として動作する
            // Common Controls v6: tauri-plugin-dialog の動作に必要
            // DPI 対応とOS互換性宣言も含める
            let manifest = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" processorArchitecture="*" name="com.devportal.gui" type="win32"/>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0" processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/PM</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
    </application>
  </compatibility>
</assembly>"#;
            // WindowsAttributes にマニフェストを設定して Attributes を構築する
            tauri_build::Attributes::new().windows_attributes(
                tauri_build::WindowsAttributes::new().app_manifest(manifest),
            )
        }
        #[cfg(not(target_os = "windows"))]
        {
            // Windows 以外ではデフォルト属性を使用する
            tauri_build::Attributes::new()
        }
    };
    // tauri-build の try_build() を呼び出して各種コード生成を行う
    tauri_build::try_build(attributes).expect("tauri-build に失敗しました");
}
