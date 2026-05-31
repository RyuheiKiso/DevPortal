// エンドポイント拡張メソッドを使うため Endpoints 名前空間を取り込む
using ${{ values.root_namespace }}.Endpoints;

// Web アプリケーションのビルダーを生成する（コマンドライン引数を取り込む）
var builder = WebApplication.CreateBuilder(args);

// OpenAPI ドキュメント生成サービスを登録する（/openapi/v1.json を提供）
builder.Services.AddOpenApi();
// 例外発生時に RFC 9457 準拠の ProblemDetails を返すサービスを登録する
builder.Services.AddProblemDetails();
// ヘルスチェック機能を登録する
builder.Services.AddHealthChecks();

// 設定済みのサービスからアプリケーションを構築する
var app = builder.Build();

// 未処理例外を ProblemDetails 形式のレスポンスに変換するミドルウェアを差し込む
app.UseExceptionHandler();
// 4xx/5xx のステータスコードに本文を付与するミドルウェアを差し込む
app.UseStatusCodePages();

// 開発環境のときだけ OpenAPI ドキュメントのエンドポイントを公開する
if (app.Environment.IsDevelopment())
{
    // /openapi/v1.json で OpenAPI ドキュメントを配信する
    app.MapOpenApi();
}
{%- if values.use_https_redirection %}
// HTTP リクエストを HTTPS にリダイレクトする（リバースプロキシ配下では無効化を検討）
app.UseHttpsRedirection();
{%- endif %}
// ヘルスチェック用のエンドポイント /health をマッピングする
app.MapHealthChecks("/health");
// サンプルの WeatherForecast エンドポイント群をマッピングする
app.MapWeatherForecastEndpoints();

// アプリケーションを起動して受信待ち状態にする
app.Run();

// 統合テスト（WebApplicationFactory<Program>）から参照できるよう Program クラスを公開する
public partial class Program { }
