{%- if values.include_serialization -%}
// このファイルのパッケージ
package ${{ values.package_name }}

// シリアライズ対象であることを示すアノテーション
import kotlinx.serialization.Serializable
// JSON 文字列とオブジェクトを相互変換する Json
import kotlinx.serialization.json.Json

// アプリの設定スキーマ（サンプル）。全フィールドに既定値を持たせ、欠損 JSON でも復元できるようにする
@Serializable
data class AppSettings(
    // 接続先のベース URL
    val baseUrl: String = "https://localhost",
    // 通信タイムアウト（秒）
    val timeoutSec: Int = 30,
    // ダークテーマを使うか
    val darkTheme: Boolean = false,
)

// JSON 文字列から AppSettings を読み込むサンプル関数
fun parseAppSettings(json: String): AppSettings =
    // 未知のキーを無視して堅牢に復元する
    Json { ignoreUnknownKeys = true }.decodeFromString(json)
{%- endif -%}
