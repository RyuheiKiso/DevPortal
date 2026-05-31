// SerialDescriptor の走査に Experimental API を使うためファイル単位でオプトインする
@file:OptIn(ExperimentalSerializationApi::class)

package com.devportal.config.ui

// レイアウト関連
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
// Material3 コンポーネント
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
// Compose ランタイム
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
// UI 基本
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
// core への依存
import com.devportal.config.ConfigStore
import com.devportal.config.WritableScope
// コルーチン
import kotlinx.coroutines.launch
// シリアライズ（スキーマ走査）
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialInfo
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
// JSON 値の取り扱い
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.serializer

// 自動生成フォームのラベルを指定するアノテーション。
// 利用者がスキーマのプロパティに付けると、画面のラベルに使われる（無ければプロパティ名）。
@SerialInfo
@Target(AnnotationTarget.PROPERTY)
annotation class ConfigLabel(val text: String)

// 利用者の型 T からドロップイン設定画面を生成する公開エントリ。
// 1行置くだけで、ゲームのコンフィグ画面のように設定を編集・保存できる。
@Composable
inline fun <reified T> ConfigScreen(
    // 表示する値と保存先を司る core のストア
    store: ConfigStore<T>,
    // 編集して保存する層（既定はユーザー層）
    scope: WritableScope = WritableScope.USER,
    // レイアウト調整用の Modifier
    modifier: Modifier = Modifier,
) {
    // reified で serializer を取得し、型に依存しない実体へ委譲する
    ConfigScreenContent(store, serializer<T>(), scope, modifier)
}

// 設定画面の本体。スキーマを走査してフォームを描画し、差分を該当層へ保存する。
@Composable
fun <T> ConfigScreenContent(
    // core のストア
    store: ConfigStore<T>,
    // T のシリアライザ（構造情報と JSON 変換に使う）
    serializer: KSerializer<T>,
    // 保存先の層
    scope: WritableScope,
    // レイアウト調整用の Modifier
    modifier: Modifier = Modifier,
) {
    // 保存処理を起動するコルーチンスコープ
    val coroutineScope = rememberCoroutineScope()
    // T と JsonObject を相互変換する JSON 設定
    val json = remember { Json { ignoreUnknownKeys = true; encodeDefaults = true } }
    // 現在のマージ済み設定を購読する
    val current by store.config.collectAsState()
    // 現在値を JsonObject 化する（フォームの基準値）
    val currentJson = remember(current) { json.encodeToJsonElement(serializer, current).asJsonObject() }
    // 編集中のドラフトを保持する状態（基準値が変わったらリセットする）
    var draft by remember(currentJson) { mutableStateOf(currentJson) }

    // 縦スクロール可能な列にフォームと操作ボタンを並べる
    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
        // スキーマを走査してフォームを生成する
        ConfigFields(serializer.descriptor, draft) { updated -> draft = updated }
        // 操作ボタン群
        Row(Modifier.padding(top = 16.dp)) {
            // 「適用」: ドラフトと基準値の差分だけを該当層に保存する
            Button(onClick = {
                // 変更されたキーだけを抽出する
                val patch = jsonDiff(currentJson, draft)
                // 該当層の現在値に差分を重ねて保存する
                coroutineScope.launch { store.update(scope) { layer -> mergeJson(layer, patch) } }
            }) { Text("適用") }
            // 「取消」: ドラフトを基準値に戻す
            OutlinedButton(
                onClick = { draft = currentJson },
                modifier = Modifier.padding(start = 8.dp),
            ) { Text("取消") }
            // 「デフォルトに戻す」: 該当層を空にして下位層/既定の値へ戻す
            TextButton(
                onClick = { coroutineScope.launch { store.update(scope) { JsonObject(emptyMap()) } } },
                modifier = Modifier.padding(start = 8.dp),
            ) { Text("デフォルトに戻す") }
        }
    }
}

// スキーマのフィールドを走査し、型ごとの編集UIを描画する（ネストは再帰）。
@Composable
fun ConfigFields(
    // 描画対象スキーマの構造情報
    descriptor: SerialDescriptor,
    // 現在の値（JsonObject）
    value: JsonObject,
    // 編集結果を親へ通知するコールバック
    onChange: (JsonObject) -> Unit,
) {
    // フィールドを順に走査する
    for (i in 0 until descriptor.elementsCount) {
        // フィールド名（JSONキー）
        val name = descriptor.getElementName(i)
        // フィールドの型情報
        val field = descriptor.getElementDescriptor(i)
        // 表示ラベル（@ConfigLabel があればそれ、無ければフィールド名）
        val label = elementLabel(descriptor, i) ?: name
        // このフィールドの現在値
        val element = value[name]
        // 型の種類で編集UIを出し分ける
        when (field.kind) {
            // 真偽値 → スイッチ
            PrimitiveKind.BOOLEAN -> BooleanRow(label, element?.asBooleanOrNull() ?: false) { v ->
                onChange(value.put(name, JsonPrimitive(v)))
            }
            // 整数系 → 数値入力（整数のみ反映）
            PrimitiveKind.INT, PrimitiveKind.LONG, PrimitiveKind.SHORT, PrimitiveKind.BYTE ->
                TextRow(label, element?.asStringOrNull() ?: "") { v ->
                    // 整数として解釈できる場合のみ反映する
                    v.toLongOrNull()?.let { onChange(value.put(name, JsonPrimitive(it))) }
                }
            // 小数系 → 数値入力（小数のみ反映）
            PrimitiveKind.FLOAT, PrimitiveKind.DOUBLE ->
                TextRow(label, element?.asStringOrNull() ?: "") { v ->
                    // 小数として解釈できる場合のみ反映する
                    v.toDoubleOrNull()?.let { onChange(value.put(name, JsonPrimitive(it))) }
                }
            // 文字列・文字 → テキスト入力
            PrimitiveKind.STRING, PrimitiveKind.CHAR ->
                TextRow(label, element?.asStringOrNull() ?: "") { v ->
                    onChange(value.put(name, JsonPrimitive(v)))
                }
            // 列挙型 → ドロップダウン
            SerialKind.ENUM -> {
                // 取りうる値の一覧をスキーマから取得する
                val options = (0 until field.elementsCount).map { field.getElementName(it) }
                EnumRow(label, element?.asStringOrNull(), options) { v ->
                    onChange(value.put(name, JsonPrimitive(v)))
                }
            }
            // ネストしたデータクラス → セクション化して再帰描画
            StructureKind.CLASS, StructureKind.OBJECT -> {
                // ネストした現在値（無ければ空オブジェクト）
                val nested = element?.asObjectOrNull() ?: JsonObject(emptyMap())
                // セクション見出しの下に再帰フォームを置く
                Section(label) {
                    ConfigFields(field, nested) { updatedNested ->
                        onChange(value.put(name, updatedNested))
                    }
                }
            }
            // それ以外（List/Map など）→ 現状は読み取り表示にフォールバック
            else -> RawRow(label, element?.toString() ?: "—")
        }
    }
}

// 真偽値を編集する行（ラベル＋スイッチ）。
@Composable
private fun BooleanRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    // ラベルとスイッチを横並びにする
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 項目ラベル（余白を埋めて右にスイッチを寄せる）
        Text(label, Modifier.weight(1f))
        // 真偽値スイッチ
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

// 文字列・数値を編集する行（テキスト入力）。
@Composable
private fun TextRow(label: String, value: String, onValueChange: (String) -> Unit) {
    // ラベル付きの単一行テキスト入力
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        singleLine = true,
    )
}

// 列挙値を選択する行（ドロップダウン）。
@Composable
private fun EnumRow(label: String, selected: String?, options: List<String>, onSelect: (String) -> Unit) {
    // ドロップダウンの開閉状態
    var expanded by remember { mutableStateOf(false) }
    // ラベルと選択ボタンを横並びにする
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 項目ラベル
        Text(label, Modifier.weight(1f))
        // 選択値ボタンとメニューをまとめる箱
        Box {
            // 現在の選択値を表示するボタン
            TextButton(onClick = { expanded = true }) { Text(selected ?: "選択") }
            // 選択肢のドロップダウンメニュー
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                // 各選択肢を項目として並べる
                options.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option) },
                        onClick = {
                            // 選択値を反映してメニューを閉じる
                            onSelect(option)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

// ネスト設定をまとめるセクション（見出し＋中身）。
@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    // 見出しと中身を縦に並べる
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        // セクションの見出し
        Text(title, style = MaterialTheme.typography.titleMedium)
        // セクションの中身（再帰フォーム）
        content()
    }
}

// 未対応の型を読み取り表示する行（ラベル＋生の文字列）。
@Composable
private fun RawRow(label: String, text: String) {
    // ラベルと値を横並びで表示するだけ（編集不可）
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        // 項目ラベル
        Text(label, Modifier.weight(1f))
        // 値（読み取り専用）
        Text(text)
    }
}

// プロパティに付いた @ConfigLabel の文字列を取り出す（無ければ null）。
private fun elementLabel(descriptor: SerialDescriptor, index: Int): String? =
    // 指定要素のアノテーションから ConfigLabel を探す
    descriptor.getElementAnnotations(index).filterIsInstance<ConfigLabel>().firstOrNull()?.text

// JsonElement をオブジェクトとして取り出す（オブジェクトでなければ null）。
private fun JsonElement.asObjectOrNull(): JsonObject? = this as? JsonObject

// JsonElement を真偽値として取り出す（不可なら null）。
private fun JsonElement.asBooleanOrNull(): Boolean? = (this as? JsonPrimitive)?.booleanOrNull

// JsonElement を文字列として取り出す（null リテラルや非プリミティブは null）。
private fun JsonElement.asStringOrNull(): String? =
    (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

// JsonElement を JsonObject として扱う（オブジェクトでなければ空オブジェクト）。
private fun JsonElement.asJsonObject(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())

// JsonObject の1キーを更新した新しい JsonObject を返す（イミュータブル更新）。
private fun JsonObject.put(key: String, value: JsonElement): JsonObject =
    JsonObject(toMutableMap().apply { this[key] = value })

// 2つの JsonObject をディープマージする（patch を base に重ねる）。core と同じ規則。
private fun mergeJson(base: JsonObject, patch: JsonObject): JsonObject {
    // base をコピーして変更可能にする
    val merged = base.toMutableMap()
    // patch の各エントリを適用する
    for ((key, patchValue) in patch) {
        // base 側の現在値
        val baseValue = merged[key]
        // 双方オブジェクトなら再帰、それ以外は置換
        merged[key] = if (baseValue is JsonObject && patchValue is JsonObject) {
            mergeJson(baseValue, patchValue)
        } else {
            patchValue
        }
    }
    // 不変の JsonObject にして返す
    return JsonObject(merged)
}

// 基準値 base に対して draft で変化したキーだけを抽出した差分 JsonObject を返す。
private fun jsonDiff(base: JsonObject, draft: JsonObject): JsonObject {
    // 差分を格納するマップ
    val diff = mutableMapOf<String, JsonElement>()
    // draft の各エントリを基準値と比較する
    for ((key, draftValue) in draft) {
        // 基準値側の同じキーの値
        val baseValue = base[key]
        when {
            // 値が同じなら差分なし（スキップ）
            baseValue == draftValue -> Unit
            // 双方オブジェクトならネストの差分を取り、空でなければ採用する
            baseValue is JsonObject && draftValue is JsonObject -> {
                val nested = jsonDiff(baseValue, draftValue)
                if (nested.isNotEmpty()) diff[key] = nested
            }
            // それ以外は変更ありとして draft の値を採用する
            else -> diff[key] = draftValue
        }
    }
    // 差分の JsonObject を返す
    return JsonObject(diff)
}
