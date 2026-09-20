# LiveYaku MVP — 実装スコープと実行方法

設計は [`docs/steam-jp-realtime-translation-blueprint.md`](../docs/steam-jp-realtime-translation-blueprint.md) を参照。
このディレクトリは、その設計に基づく**最初のコード**です。

## この環境(Linux サンドボックス)で実装したもの・できないこと

このセッションは Windows 環境でも実 Steam ゲームプロセスでもなく、Linux 上のサンドボックスです。そのため、ブループリントの MVP スコープ(§3.1・§10)のうち**実装・ビルド・実行検証ができるもの**と**できないもの**を明確に分けています。「動きます」と言えるのは、実際にビルドしてテストが通ったものだけです。

| コンポーネント | 状態 | 検証方法 |
|---|---|---|
| 翻訳パイプライン(キャッシュ・用語集・プレースホルダ保護・TR7対策・プロンプト構築) | ✅ 実装済み・テスト済み | `mvp/helper` の Vitest 単体テスト(51件) |
| Native Messaging プロトコル(stdio フレーミング) | ✅ 実装済み・テスト済み | 単体テスト + 実プロセスを spawn した E2E スモークテスト |
| ゲームプロファイル照合・アンチチート/アンチタンパー検知ロジック | ✅ 実装済み・テスト済み | Vitest 単体テスト |
| ブラウザ拡張(MV3, ダッシュボード・設定・用語集エディタ) | ✅ 実装済み・テスト済み | 実 Chromium(Playwright)で拡張機能を読み込み、popup/optionsの描画・疎通を確認 |
| Claude API 連携 | ✅ 実装済み(モック+実API両対応)、**実API呼び出しは未検証**(ネットワーク越しの実呼び出しは行っていない) | モッククライアントでのユニットテストのみ |
| **hook-injector / hook-dll(実ゲームプロセスへの読み取り専用フック)** | ❌ **未実装**。`capture/mockCaptureSource.ts` というモックに差し替えている | ブループリント §4.3, §4.3.1a, §4.3.5。Windows ネイティブ(DLL injection, Detours/MinHook)が必要で、この環境ではビルドも実行もできない |
| **overlay-renderer(デスクトップオーバーレイ描画)** | ❌ **未実装** | ブループリント §4.4。Win32 レイヤードウィンドウは Windows 専用 |
| **OCR フォールバック** | ❌ **未実装** | ブループリント §4.3.4。Windows Graphics Capture API が必要 |
| Native Messaging ホストマニフェストの実際のインストール(レジストリ登録等) | ❌ **未実施** | ブラウザ拡張は実際には未接続の状態でテストしている(意図的。§2.2「常時稼働の制約」参照) |

**つまり「翻訳が実際にゲーム画面に出る」ところまでは、まだ到達していません。** 到達しているのは、翻訳パイプライン・Native Messaging・拡張機能 UI という「hook-dll の手前・オーバーレイの手前」までの、実際に動いて検証済みの土台です。

## ディレクトリ構成

```
mvp/
  helper/       ローカルヘルパー(Node.js/TypeScript)。翻訳パイプラインの本体
  extension/    ブラウザ拡張(Manifest V3)。ダッシュボード・設定・用語集UI
```

設計書の推奨スタック(§5)は hook-injector を C++ としていますが、この PoC ではフッキング自体を実装していないため、helper 全体を Node.js/TypeScript で書いています。将来 Windows で本物の `hook-dll` を実装する際は、`src/capture/types.ts` の `CaptureSource` インターフェースを満たすネイティブモジュールに差し替える想定です(Node.js の native addon 経由、または別プロセス+IPC のいずれか)。

## helper (ローカルヘルパー)

```bash
cd mvp/helper
npm install
npm run build   # tsc + サンプルデータのコピー
npm test        # Vitest: 51 tests
npm run dev     # tsx で src/index.ts を直接起動(stdin で Native Messaging フレームを待受)
```

- `ANTHROPIC_API_KEY` 環境変数を設定すると実際の Claude API を呼びます(§4.6: 本番では Windows DPAPI 経由で保存する想定。この PoC では `EnvCredentialStore` が代替)。未設定時は `MockTranslationClient` が決定的なダミー翻訳を返します。
- `LIVEYAKU_DB_PATH` でSQLiteファイルパスを指定できます(未指定時は `:memory:`)。キャッシュ・用語集は [Node.js 22 の組み込み `node:sqlite`](https://nodejs.org/api/sqlite.html)(実験的機能)を使用しており、ネイティブアドオンのビルドを避けています。

### 実装したリスク対策(ブループリント §7 対応)

- **TR1(プレースホルダ破損)**: `translation/placeholder.ts` が `%s` `{0}` `<color=red>` 等をトークン化し、`outputValidator.ts` が復元前に整合性を検証。破損時は原文へフォールバック。
- **TR7(プロンプトインジェクション)**: `translation/promptBuilder.ts` は原文をJSON文字列値として渡し、指示として解釈させない。出力側も長さ・制御文字・マークアップパターンを検査。
- **OP1/OP3(未検証プロファイルの自動適用禁止)**: `profiles/gameProfiles.ts` の `matchProfile()` は `moderation_status: "verified"` 以外を `requires_manual_approval` として返し、自動適用しない。
- **T9(アンチタンパー検知の限界)**: `profiles/protectionRegistry.ts` は `detection_confidence: "heuristic_low"` のエントリを明示的に区別し、プロセス名一致だけでは検知したことにしない設計になっている。

## extension (ブラウザ拡張)

```bash
cd mvp/extension
npm install
npm run build     # tsc + manifest/html のコピー
npm test          # Vitest: BackgroundController の単体テスト(7 tests)
npm run test:e2e  # Playwright: 実 Chromium で拡張機能を読み込みE2E検証(3 tests)
```

`dist/` を Chrome の「パッケージ化されていない拡張機能を読み込む」で指定すれば、実ブラウザにインストールできます(ただし Native Messaging ホストは未登録のため「未接続」表示になります — これが正しい挙動です)。

### 未接続状態での動作確認

Native Messaging ホストマニフェストをインストールしていないため、`chrome.runtime.connectNative()` は失敗します。UI 側(`popup.ts` / `options.ts`)はこれを例外として捕捉し、「ローカルヘルパー未接続」を表示して落ちないことを Playwright テストで確認済みです。これは §2.2 の「常時稼働の制約」を踏まえた、意図した縮退動作です。

### ヘルパーと実際に繋ぐには(この環境では未実施)

1. `mvp/helper` を `npm run build` してバイナリ相当の起動コマンドを用意する。
2. Chrome の Native Messaging ホストマニフェスト(`com.liveyaku.helper.json`)を作成し、OS のレジストリ/ディレクトリに登録する(Windows/macOS/Linux でパスが異なる。[Chrome公式ドキュメント](https://developer.chrome.com/docs/apps/nativeMessaging)参照)。
3. 拡張機能をインストールした状態でブラウザを起動すると、`background.ts` が `chrome.runtime.connectNative("com.liveyaku.helper")` で接続する。

この手順はこのサンドボックスでは実施していません(ブラウザの拡張機能ストレージ・OS 側のホストマニフェスト登録が必要なため)。

## 既知の未検証事項

- 実 Claude API を使った翻訳品質・レイテンシは未検証(モッククライアントのみでテスト)。
- `npm audit` が dev 依存(vitest/playwright 関連)にいくつか警告を出している。配布物には含まれないビルドツールチェーンの依存であり、本番相当のセキュリティレビュー(§9.4 人間承認)の対象は `hook-dll` 等の高リスク領域を優先する。
- Native Messaging ホストマニフェストの実登録・実ブラウザでの疎通は未実施(上記参照)。

## 次のステップ(実装フェーズの続き)

ブループリント §12(オープンクエスチョン)および §10(ロードマップ)の F1(読み取り専用フック PoC)以降は、Windows 実機環境が必要です。このリポジトリの続きとしては:

1. Windows 環境で `hook-dll`(Unity Mono/IL2CPP 向け、§4.3.1a)を実装し、`CaptureSource` インターフェースに準拠させる。
2. `overlay-renderer`(Win32 レイヤードウィンドウ)を実装する。
3. Native Messaging ホストマニフェストを実際にインストールし、この `extension`/`helper` と実際に疎通させる。
4. §9.4 に従い、フック関連コードは人間の最終承認をマージ条件とする。
