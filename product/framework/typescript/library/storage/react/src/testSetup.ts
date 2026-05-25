// fake-indexeddb を globalThis.indexedDB に自動注入する
// jsdom には IndexedDB 実装が無いため、テスト環境では fake-indexeddb で代替する
import "fake-indexeddb/auto";
