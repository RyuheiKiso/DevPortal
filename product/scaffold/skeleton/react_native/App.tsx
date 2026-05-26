/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

// 新規アプリ用のウェルカム画面コンポーネントをインポート
import { NewAppScreen } from '@react-native/new-app-screen';
// 画面表示に使う React Native の基本 API
import { StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
// セーフエリア（ノッチや下部バーを避ける領域）を扱うユーティリティ
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

// アプリのルートコンポーネント
function App() {
  // OS のカラースキーム（ライト／ダーク）を取得
  const isDarkMode = useColorScheme() === 'dark';

  return (
    // セーフエリア情報を子コンポーネントに供給するプロバイダ
    <SafeAreaProvider>
      {/* ダーク／ライトに応じてステータスバーの文字色を切り替え */}
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      {/* 実コンテンツを描画する子コンポーネント */}
      <AppContent />
    </SafeAreaProvider>
  );
}

// セーフエリア情報を受け取って実コンテンツを描画する内側コンポーネント
function AppContent() {
  // セーフエリアの上下左右の余白量を取得
  const safeAreaInsets = useSafeAreaInsets();

  return (
    // 画面全体を埋めるコンテナ
    <View style={styles.container}>
      {/* React Native 標準のウェルカム画面を描画 */}
      <NewAppScreen
        templateFileName="App.tsx"
        safeAreaInsets={safeAreaInsets}
      />
    </View>
  );
}

// コンテナのスタイル定義
const styles = StyleSheet.create({
  container: {
    // 親の領域を全部使う
    flex: 1,
  },
});

// App コンポーネントを既定エクスポート
export default App;
