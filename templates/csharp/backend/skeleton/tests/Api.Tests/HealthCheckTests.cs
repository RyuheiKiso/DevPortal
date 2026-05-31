// HTTP ステータスコードを参照するため取り込む
using System.Net;
// アプリをインメモリで起動する WebApplicationFactory を参照するため取り込む
using Microsoft.AspNetCore.Mvc.Testing;
// xUnit の属性・アサーションを参照するため取り込む
using Xunit;

// テストをまとめる名前空間
namespace ${{ values.root_namespace }}.Tests;

// アプリ全体をインメモリで起動して検証する統合テスト
public class HealthCheckTests : IClassFixture<WebApplicationFactory<Program>>
{
    // テストサーバーを生成するファクトリ
    private readonly WebApplicationFactory<Program> _factory;

    // ファクトリを受け取るコンストラクタ
    public HealthCheckTests(WebApplicationFactory<Program> factory)
    {
        // 注入されたファクトリを保持する
        _factory = factory;
    }

    // /health が 200 OK を返すことを検証する
    [Fact]
    public async Task GetHealth_ReturnsOk()
    {
        // テスト用の HTTP クライアントを生成する
        var client = _factory.CreateClient();
        // /health へ GET リクエストを送信する
        var response = await client.GetAsync("/health");
        // ステータスコードが 200 OK であることを確認する
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // /weatherforecast が成功レスポンスを返すことを検証する
    [Fact]
    public async Task GetWeatherForecast_ReturnsSuccess()
    {
        // テスト用の HTTP クライアントを生成する
        var client = _factory.CreateClient();
        // /weatherforecast へ GET リクエストを送信する
        var response = await client.GetAsync("/weatherforecast");
        // 2xx 以外なら例外を投げてテストを失敗させる
        response.EnsureSuccessStatusCode();
    }
}
