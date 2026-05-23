/**
 * @format
 */

// React Native のアプリケーション登録 API
import { AppRegistry } from 'react-native';
// ルートコンポーネント
import App from './App';
// app.json からアプリ名を取得（ネイティブ側との対応キー）
import { name as appName } from './app.json';

// アプリ名をキーにして React Native ランタイムへ App コンポーネントを登録
AppRegistry.registerComponent(appName, () => App);
