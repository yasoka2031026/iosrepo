# YouTube情報収集エージェント (yt-agent)

ユーザーの代わりにYouTube動画を「視聴」し、文字起こし(トランスクリプト)を
フロンティアLLM(Claude または Codex)で要約・情報抽出して、Obsidian Vaultに
そのままノートとして書き出すCLIエージェントです。

> 実際に動画を「見る」のではなく、YouTube Data APIで取得したメタデータと
> 字幕/自動生成トランスクリプトをLLMに読ませて要約する方式です。音声・映像
> そのものの解析は現バージョンのスコープ外です(将来拡張として
> `docs/youtube-agent-deployment-plan.md` に記載)。

## できること

- 動画URL / チャンネルID / 検索クエリを指定して処理
- 字幕取得 → (長尺動画はチャンク分割して) LLMで要約・キーポイント・引用・
  アクションアイテム・タグを構造化抽出
- Obsidianの `Vault/YouTube/` 配下にYAML frontmatter付きMarkdownノートを生成
- 全処理動画を一覧できる「YouTube Information Gathering MOC」インデックス
  ノートを自動更新(重複追加なし)
- 非公開動画・字幕なし・ライブ配信中・API障害などをすべて個別に検知し、
  バッチ処理やチャンネル一括処理が1件の失敗で全体停止しないよう設計

## セットアップ

```bash
cd youtube-agent
python3 -m venv .venv
.venv/bin/pip install -e .
# 実API(Claude/Codex/YouTube)を使う場合のみ:
.venv/bin/pip install -e ".[real]"
```

環境変数は `config/.env.example` を参照してください。APIキー未設定でも
`LLM_PROVIDER=mock` / `YOUTUBE_MODE=mock`(デフォルト)ならそのまま動作します
(実データではなくモックデータで動作確認用)。

## 使い方

```bash
export OBSIDIAN_VAULT_PATH=/path/to/your/vault
export LLM_PROVIDER=claude          # or codex
export ANTHROPIC_API_KEY=sk-ant-...
export YOUTUBE_MODE=api
export YOUTUBE_API_KEY=...

# 1本の動画を処理
.venv/bin/python -m yt_agent process --url "https://www.youtube.com/watch?v=XXXXXXXXXXX"

# チャンネルの最新5本
.venv/bin/python -m yt_agent process --channel UCxxxxxxxxxxxxxxxxxxxxxx --limit 5

# 検索クエリで上位5本
.venv/bin/python -m yt_agent process --query "Claude Code tips" --limit 5

# ウォッチリスト一括処理 (config/watchlist.example.json 参照)
.venv/bin/python -m yt_agent batch --file config/watchlist.example.json
```

グローバルオプション (`--provider`, `--youtube-mode`) はサブコマンドの前に
指定してください: `python -m yt_agent --provider mock process --url ...`

## アーキテクチャ

```
src/yt_agent/
  models.py          VideoMetadata / Transcript / StructuredNote / ProcessResult
  youtube_client.py  YouTubeClient抽象 + RealYouTubeClient(YouTube Data API +
                     youtube-transcript-api, 遅延import) + MockYouTubeClient
  llm_client.py      LLMClient抽象(map-reduceチャンク要約 + リトライ) +
                     AnthropicClaudeClient / OpenAICodexClient / MockLLMClient
  note_writer.py     Obsidian Markdownノート生成 + MOCインデックス更新
  pipeline.py        取得→要約→書き出しのオーケストレーション
                     (個々の失敗はProcessResultに変換し、絶対に例外を漏らさない)
  cli.py             argparse CLI
```

設計原則: **1件の動画の失敗がバッチ全体をクラッシュさせない。**
`pipeline.py` の全メソッドは例外を握りつぶして `ProcessResult(status=FAILED/SKIPPED, ...)`
を返します。想定外の例外だけが `run_validation_loop.py` の「クラッシュ」として
検出されます。

## テストと実働検証

```bash
# 単体テスト (標準ライブラリのunittestのみ、追加依存なし)
.venv/bin/python -m unittest discover -s tests -v

# 20パターンのモック実働検証ループ (LOOP検証) + レポート生成
.venv/bin/python scripts/run_validation_loop.py
```

検証結果は [`docs/youtube-agent-validation-report.md`](../docs/youtube-agent-validation-report.md) に自動生成されます。

## デプロイについて

本セッションではYouTube/Claude/CodexのAPIキーが未提供のため、実サービスへの
デプロイは実行していません。提案は
[`docs/youtube-agent-deployment-plan.md`](../docs/youtube-agent-deployment-plan.md)
を参照してください。
