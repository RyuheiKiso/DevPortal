// サンプルレスポンスのモデルを参照するため Models 名前空間を取り込む
using ${{ values.root_namespace }}.Models;

// エンドポイント定義をまとめる名前空間
namespace ${{ values.root_namespace }}.Endpoints;

// WeatherForecast 関連のエンドポイントを定義する静的クラス
public static class WeatherForecastEndpoints
{
    // 天気概況のサンプル値（ランダムに選択する）
    private static readonly string[] Summaries =
    [
        // 凍えるほど寒い
        "Freezing",
        // 涼しい
        "Cool",
        // 穏やか
        "Mild",
        // 暖かい
        "Warm",
        // 焼けつくように暑い
        "Scorching"
    ];

    // WeatherForecast エンドポイント群をルーティングへ登録する拡張メソッド
    public static IEndpointRouteBuilder MapWeatherForecastEndpoints(this IEndpointRouteBuilder app)
    {
        // GET /weatherforecast を登録する
        app.MapGet("/weatherforecast", () =>
            {
                // 5 日分の天気予報サンプルを生成する
                var forecast = Enumerable.Range(1, 5).Select(index =>
                    // 1 件分の予報データを組み立てる
                    new WeatherForecast(
                        // 当日から index 日後の日付
                        DateOnly.FromDateTime(DateTime.Now.AddDays(index)),
                        // -20〜55 度の範囲のランダムな気温
                        Random.Shared.Next(-20, 55),
                        // 概況をランダムに選択する
                        Summaries[Random.Shared.Next(Summaries.Length)]))
                    // 配列に変換する
                    .ToArray();
                // 生成した予報を返す
                return forecast;
            })
            // OpenAPI 上の操作名を設定する
            .WithName("GetWeatherForecast")
            // OpenAPI 上のタグを設定する
            .WithTags("WeatherForecast");

        // メソッドチェーンできるよう app を返す
        return app;
    }
}
