# YouTube情報収集エージェント — 実働検証レポート(モック20回)

本レポートは `scripts/run_validation_loop.py` により自動生成される。
YouTube Data API / Claude / Codex の実APIキーは未設定のため、`MockYouTubeClient` / `MockLLMClient` を用いてオフラインでパイプライン全体(取得 → 要約 → Obsidianノート書き出し)を20パターンの実運用シナリオで検証した。

## サマリー

- 総実行回数: 20
- クラッシュ(未処理例外)件数: 0
- 期待した挙動と一致した件数: 20 / 20
- 判定: ✅ PASS — バグ・クラッシュなし

## 実行結果一覧

| # | シナリオ | 期待結果 | クラッシュ | 判定 |
|---|---|---|---|---|
| 1 | 通常動画(英語字幕)の処理 | SUCCESS | なし | PASS |
| 2 | 通常動画(日本語字幕)の処理 | SUCCESS | なし | PASS |
| 3 | 長尺動画(チャンク分割要約) | SUCCESS | なし | PASS |
| 4 | 字幕/文字起こしが存在しない動画 | SKIPPED | なし | PASS |
| 5 | 非公開/削除済み動画 | FAILED | なし | PASS |
| 6 | 年齢制限で取得できない動画 | FAILED | なし | PASS |
| 7 | 配信中のライブ配信 | SKIPPED | なし | PASS |
| 8 | チャンネル一括処理中に1本失敗 | 3件中1件FAILED, 残り2件SUCCESS, バッチ全体はクラッシュしない | なし | PASS |
| 9 | 検索結果0件 | 空リスト(クラッシュしない) | なし | PASS |
| 10 | LLM一時エラー後にリトライで成功 | SUCCESS (リトライ経由) | なし | PASS |
| 11 | LLM応答がJSONとして不正 | PARTIAL (パースエラーとして記録しノート作成) | なし | PASS |
| 12 | YouTube APIクォータ超過 | FAILED 1件(クラッシュしない) | なし | PASS |
| 13 | 極端に短い文字起こし | SUCCESS | なし | PASS |
| 14 | 非ラテン文字(韓国語)字幕 | SUCCESS | なし | PASS |
| 15 | 同一動画の再処理(重複排除) | SUCCESS (MOC重複行なし) | なし | PASS |
| 16 | Obsidian Vaultフォルダが未作成 | SUCCESS (フォルダ自動作成) | なし | PASS |
| 17 | タイトルに使用不可文字を含む動画 | SUCCESS (ファイル名サニタイズ) | なし | PASS |
| 18 | watchlist内に不正エントリが混在 | 1件SUCCESS + 3件FAILED、バッチはクラッシュしない | なし | PASS |
| 19 | Claude/Codexプロバイダの切り替え | 両方SUCCESS、ノートに正しいprovider名が記録される | なし | PASS |
| 20 | LLM APIが完全に応答不能(リトライ全滅) | 正常系はSUCCESS、障害系はFAILEDで安全に停止(クラッシュしない) | なし | PASS |
## 結論と次のステップ

20回のモック実働検証すべてで、パイプラインは想定どおりに動作し、未処理例外(クラッシュ)は一切発生しなかった。バッチ処理は個別動画の失敗(非公開・字幕なし・ライブ配信中・LLM一時障害など)を吸収し、処理を継続した。

この結果を踏まえ、コード面ではデプロイ判定基準を満たしている。ただし実デプロイの実行には以下がユーザー側で必要であり、本セッションでは未取得のため実施していない(詳細は `docs/youtube-agent-deployment-plan.md` を参照):

1. YouTube Data API キー
2. Anthropic (Claude) および/または OpenAI (Codex) API キー
3. Obsidian Vaultの実パス、またはVault同期先の合意
4. 実APIを使った少数回の実地検証(モックでは検出できないAPI仕様差分の確認)
