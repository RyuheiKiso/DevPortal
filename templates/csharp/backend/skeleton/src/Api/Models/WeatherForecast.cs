// モデルをまとめる名前空間
namespace ${{ values.root_namespace }}.Models;

// 天気予報 1 件分を表す不変レコード
public record WeatherForecast(DateOnly Date, int TemperatureC, string? Summary)
{
    // 摂氏から華氏へ変換した気温（計算プロパティ）
    public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
}
