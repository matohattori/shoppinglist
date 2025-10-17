# スワイプ削除機能 (Swipe to Delete Feature)

## 概要 (Overview)

リストアイテムと保存ボックス内のリストを、右方向へのスワイプ操作で削除できるようになりました。

List items and saved lists in storage box can now be deleted by swiping right.

## 操作方法 (How to Use)

### リストアイテム削除 (List Item Deletion)

1. **非編集モード**でリストアイテムを表示
2. アイテムを**右方向にスワイプ**
3. 左側に🗑️マーク付きの**赤いバー**が出現
4. スワイプ距離がタイル幅の**約35%**を超えると削除が確定
5. タイルが右方向にスライドアウトしながらフェードアウト

### 保存ボックス内リスト削除 (Storage Box List Deletion)

1. 保存ボックスを開く
2. 削除したいリストを**右方向にスワイプ**
3. 左側に🗑️マーク付きの**赤いバー**が出現
4. スワイプ距離がタイル幅の**約35%**を超えると削除が確定
5. タイルが右方向にスライドアウトしながらフェードアウト

## 技術仕様 (Technical Specifications)

### 削除しきい値 (Deletion Threshold)
- タイル幅の**35%**

### アニメーション (Animations)
- スライドアウト: **0.2秒** (ease-out)
- フェードアウト: **0.15秒** (ease-out)

### ジェスチャー検出 (Gesture Detection)
- Pointer Events (マウス/タッチパッド対応)
- Touch Events (タッチスクリーン対応)
- 横方向の動きが支配的な場合のみスワイプとして認識
- 縦方向スクロールを妨げない

### ハプティックフィードバック (Haptic Feedback)
- 削除確定時に50msの振動フィードバック（対応デバイスのみ）

## 変更点 (Changes)

### 削除されたもの (Removed)
- 編集モードの削除ボタン（✖）は引き続き利用可能
- 保存ボックスの二段階削除ボタン（DELETE確認）

### 追加されたもの (Added)
- Row コンポーネントにスワイプジェスチャー検出
- StorageBoxItem コンポーネント（新規作成）
- 赤いゴミ箱バー背景
- スライド＆フェードアウトアニメーション

## デバッグ (Debugging)

### ブラウザの開発者コンソールでテスト
```javascript
// リストアイテムの数を確認
document.querySelectorAll('.row-wrapper').length

// スワイプ状態を確認（Reactの内部状態はアクセス不可）
// 実際のスワイプ操作で動作確認してください
```

## 互換性 (Compatibility)

- モダンブラウザ（Chrome, Firefox, Safari, Edge）
- タッチスクリーン対応デバイス
- マウス/タッチパッド
