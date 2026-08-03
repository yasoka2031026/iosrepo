# YouTube情報収集エージェント — デプロイ提案(未実行)

このドキュメントは提案のみです。本セッションではYouTube Data API /
Anthropic (Claude) / OpenAI (Codex) のAPIキーが提供されておらず、Obsidian
Vaultの実配置(同期方法)も未確定のため、実際のデプロイ・実API検証は
**実行していません**。コード自体は `youtube-agent/docs` 配下のテスト・
検証ループを20/20 PASSで通過しており、鍵と配置先が決まり次第デプロイ可能
な状態です。

## 前提: このツールの性質

`yt-agent` は常時稼働のWebサービスではなく、**ローカルのObsidian Vaultに
書き込むバッチ/CLIツール**です。したがって「デプロイ」とは、これを
定期的に実行してVaultに新しいノートを反映させる仕組みを指します。

## 選択肢

### 案A: ローカルcron / launchd (推奨・最短)

Obsidian Vaultがある端末(個人PC/Mac)で直接、定期実行タスクとして
`yt-agent batch` を回す。

- 必要なもの: ANTHROPIC_API_KEY または OPENAI_API_KEY、YOUTUBE_API_KEY、
  Vaultの絶対パス
- 手順: `.venv` を作成 → `config/.env` を実値で作成 → cron
  (`0 */6 * * * cd /path/to/youtube-agent && .venv/bin/python -m yt_agent batch --file config/watchlist.json`)
  または macOS launchd plist を登録
- 長所: Vaultへの書き込みが最短経路(同期ラグなし)、追加インフラ不要、
  APIキーが外部に出ない
- 短所: 端末がスリープ/オフラインだと実行されない

### 案B: GitHub Actions定期実行 (Vaultがgit管理の場合)

ObsidianVaultをGit管理している場合、GitHub Actionsのscheduled workflowで
`yt-agent batch` を実行し、生成ノートをVaultリポジトリにコミット&プッシュ
する。

- 必要なもの: 上記APIキーをGitHub Secretsに登録、Vaultリポジトリへの
  書き込み権限
- 長所: 端末の起動状態に依存しない、実行ログが残る
- 短所: Vault側の同期(Obsidian Sync/Git plugin等)が別途必要、AIプロバイダの
  APIキーをCI環境に置く運用リスクを許容する必要がある

### 案C: 常時稼働コンテナ (Docker, 将来の拡張向け)

複数チャンネル・大量ウォッチリストを継続監視したい場合、Docker化して
サーバー/NASで常駐実行し、Vaultをボリュームマウントする。

- 必要なもの: コンテナホスト、Vaultへのネットワーク/ファイルシステム
  アクセス(Syncthing等)
- 長所: スケール・スケジューリングの柔軟性が高い
- 短所: 運用コストが最も高く、MVPの規模には過剰

## 推奨

個人利用・MVP検証目的であれば **案A(ローカルcron)** を推奨します。
Obsidian Vaultとの親和性が最も高く、追加のインフラやシークレット管理が
不要です。チーム利用や継続的な大量監視が必要になった段階で案B/Cへの
移行を検討してください。

## デプロイ実行前のチェックリスト

- [ ] YouTube Data API キー取得済み(YouTube Data API v3を有効化)
- [ ] Anthropic (Claude) または OpenAI (Codex) のAPIキー取得済み
- [ ] Obsidian Vaultの絶対パス、またはVault同期先を確定
- [ ] `config/watchlist.json` に実際に監視したいチャンネル/検索クエリを記入
- [ ] 実キーで少数動画に対して `yt_agent process --url ...` を試し、
      モックでは検証できないAPI仕様差分(字幕言語、クォータ挙動など)を
      実地確認
- [ ] 実行頻度・YouTube Data APIの1日あたりクォータ(デフォルト10,000ユニット)
      を watchlist のサイズと突き合わせて確認

上記が揃った時点で、案Aの cron 登録をもって「デプロイ完了」とすることを
提案します。
