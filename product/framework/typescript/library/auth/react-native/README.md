# @k1s0-ts-auth/react-native

`@k1s0-ts-auth/core` の React Native 連携パッケージです。

React Native 向けの `AuthProvider`、hooks、表示ガードに加えて、SecureStore / AsyncStorage / Keychain などへ接続できる `createNativeTokenStore()` を提供します。

フロント側の権限判定は表示制御用です。API の最終認可はバックエンドで実施してください。
