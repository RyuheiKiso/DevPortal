# ビルドステージ: .NET 10 SDK イメージを使用する
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
# 作業ディレクトリを設定する
WORKDIR /src
# ソースをすべてコピーする
COPY . .
# 依存パッケージを復元する
RUN dotnet restore "src/Api/Api.csproj"
# Release 構成で発行する（apphost は不要なので生成しない）
RUN dotnet publish "src/Api/Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

# 実行ステージ: 軽量な ASP.NET Core ランタイムイメージを使用する
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
# 作業ディレクトリを設定する
WORKDIR /app
# 発行された成果物をコピーする
COPY --from=build /app/publish .
# Kestrel が待ち受ける HTTP ポートを指定する
ENV ASPNETCORE_HTTP_PORTS=${{ values.http_port }}
# コンテナが公開するポートを宣言する
EXPOSE ${{ values.http_port }}
# アプリケーションの起動コマンドを設定する
ENTRYPOINT ["dotnet", "${{ values.root_namespace }}.dll"]
