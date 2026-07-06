# バイラル・ショート動画生成システム 設計ブループリント

**プロダクト名(仮): ShortsForge(ショーツフォージ)**

対象: 日本のクリエイター・代理店・中小企業向け
対象プラットフォーム: YouTube Shorts / TikTok / Instagram Reels(縦型 9:16 動画)
本書の目的: 実装は行わず、プロダクト仕様・UX・AIワークフロー・技術アーキテクチャ・法的セーフガード・実装ロードマップを定義する。

> **モデル表記について**: 本書では AI 推論レイヤーを「Claude Fable 5」と表記する。実装時は Anthropic API のモデル ID(執筆時点では `claude-fable-5`。変更された場合は最新の上位モデル ID)に置き換えること。置き換え箇所は `{{MODEL_ID}}` とマークする。

---

## 目次

1. [プロダクト概要とコアコンセプト](#1-プロダクト概要とコアコンセプト)
2. [ユーザーフロー(ログイン〜書き出し)](#2-ユーザーフローログイン書き出し)
3. [機能定義: MVP / V1 / 将来バージョン](#3-機能定義-mvp--v1--将来バージョン)
4. [システムアーキテクチャ](#4-システムアーキテクチャ)
5. [推奨技術スタックとトレードオフ](#5-推奨技術スタックとトレードオフ)
6. [AIワークフロー: 各ステージでの Claude Fable 5 の使い方](#6-aiワークフロー-各ステージでの-claude-fable-5-の使い方)
7. [データスキーマ](#7-データスキーマ)
8. [法的・倫理的セーフガード](#8-法的倫理的セーフガード)
9. [プロンプト例・出力例・E2Eサンプルワークフロー](#9-プロンプト例出力例e2eサンプルワークフロー)
10. [30日ビルドロードマップ](#10-30日ビルドロードマップ)
11. [セルフチェック](#11-セルフチェック)

---

## 1. プロダクト概要とコアコンセプト

### 1.1 一文で言うと

「伸びているショート動画の**構造だけ**を学習し、ユーザーの素材(URL・企画書)と掛け合わせて、**オリジナルの縦型動画の制作パッケージ**(台本・絵コンテ・素材リスト・編集指示・キャプション)を自動生成する Web アプリ」。

### 1.2 コア原則: 「構造の抽出、表現の非複製」

本システムの法的・プロダクト的な生命線は以下の分離である。

| 抽出して良いもの(アイデア・構造) | 抽出してはいけないもの(表現・保護資産) |
|---|---|
| フックの型(疑問提起型、逆張り型、Before/After型 など) | 動画・音声・映像素材そのもの |
| 冒頭パターン(0.5秒で文字を出す、結論から言う など) | 台本のテキストの逐語コピー |
| テンポ(平均カット長、シーン数、展開速度) | 出演者の肖像・声 |
| シーンシーケンスの抽象構造(問題→実演→結果→CTA) | 楽曲・BGM |
| 感情トリガーの種類(驚き、共感、損失回避) | サムネイル画像・ロゴ |
| キャプション/テロップの様式(位置、密度、強調の使い方) | 特定の言い回し・キャッチコピーの丸写し |
| CTA の型(コメント誘導、保存誘導、プロフィール誘導) | |
| 編集リズムの抽象記述(ビート同期、ジャンプカット頻度) | |

システム内部では、この抽出結果を **「Reusable Structure(再利用可能構造)」= 完全に抽象化された JSON** として保持し、**元動画の映像・音声・全文書き起こしは長期保存しない**(§8 参照)。

### 1.3 ターゲットユーザーと主要ユースケース

| ペルソナ | ユースケース |
|---|---|
| 個人クリエイター(美容・料理・ガジェット系) | 自ジャンルの伸び構造を知り、週3本の企画・台本を時短で作る |
| 運用代理店のディレクター | クライアント商材の LP URL を入れて、月20本の企画・絵コンテを量産 |
| 中小企業のマーケ担当(EC・店舗) | 商品ページ URL から販促ショート動画の制作指示書を作り、外注に渡す |

---

## 2. ユーザーフロー(ログイン〜書き出し)

### 2.1 画面一覧

| # | 画面 | 主要要素 |
|---|---|---|
| S1 | ログイン / サインアップ | メール + Google OAuth。組織(ワークスペース)選択 |
| S2 | ダッシュボード | プロジェクト一覧、最近のトレンドレポート、動画ジョブの進行状況 |
| S3 | ニッチ設定 & トレンドリサーチ | ニッチ選択(例: 美容/節約/英語学習)、地域(JP)、期間、リサーチ実行ボタン、結果テーブル |
| S4 | トレンド分析ビュー | 動画メタデータ一覧(統計のみ)、成長率グラフ、抽出された Reusable Structure カード |
| S5 | 構造ライブラリ | 保存済み構造の検索・タグ・お気に入り。「この構造で作る」ボタン |
| S6 | プロジェクト作成(素材投入) | URL 入力(LP / 商品ページ / Google Docs / Notion / 台本)、目的・トーン・尺・ターゲット設定フォーム |
| S7 | コンセプト選択 | AI が出す 3〜5 案のコンセプトカード(フック文・構造・想定尺)。1つ選択 or 再生成 |
| S8 | 台本 & 絵コンテエディタ | 左: シーンごとの台本(セリフ/テロップ/演出指示)、右: 縦型プレビューのワイヤー絵コンテ。行単位で AI リライト |
| S9 | 制作パッケージ / 書き出し | 素材リスト、編集指示書、キャプション & ハッシュタグ、CTA。PDF / Markdown / CSV / (V1以降) 動画レンダリング |
| S10 | 動画ジョブモニタ(V1+) | 自動生成ジョブの進捗、プレビュー、再レンダリング |
| S11 | 設定 | API キー(外部動画生成)、ブランドキット(ロゴ・カラー・NGワード)、チーム管理 |

### 2.2 メインフロー(ハッピーパス)

```
[S1 ログイン]
   ↓
[S2 ダッシュボード] → 「新規リサーチ」
   ↓
[S3 ニッチ設定] ニッチ=「時短レシピ」、地域=JP、期間=直近14日 → リサーチ実行(非同期ジョブ)
   ↓ (数分後、通知)
[S4 トレンド分析] 上位動画の統計と「なぜ伸びたか」の構造仮説を確認
   ↓ 気に入った構造を [S5 構造ライブラリ] に保存
   ↓
[S6 プロジェクト作成] 商品LPのURL + Google Docs の企画書URLを貼る。目的=商品認知、尺=30秒
   ↓ (URL取り込み → 要約 → 確認画面で内容チェック)
[S7 コンセプト選択] AI提案3案から「Before/After型 × 損失回避フック」を選択
   ↓
[S8 台本&絵コンテ] 8シーン構成の台本を編集。シーン3のセリフだけAIリライト
   ↓
[S9 書き出し] 制作パッケージ(PDF+CSV)をダウンロード / (V1) 「自動生成」で動画ジョブ投入
   ↓
[S10 ジョブモニタ] レンダリング完了 → MP4 (1080x1920) をダウンロード → 各プラットフォームへ手動投稿
```

**設計上の要点**

- リサーチと動画生成は**必ず非同期ジョブ**(数十秒〜数分かかる)。UI はポーリング or WebSocket/SSE で進捗表示。
- S6 の URL 取り込み後に**必ず人間の確認ステップ**を挟む(誤取得・アクセス不可・機密混入の検知)。
- S8 は「AI 全自動」ではなく「AI 下書き + 人間編集」が基本線。行単位リライトで編集コストを下げる。
- 投稿自体は MVP ではスコープ外(手動投稿)。API 投稿はプラットフォーム審査が重いため将来版(§3)。

---

## 3. 機能定義: MVP / V1 / 将来バージョン

### 3.1 MVP(〜30日、§10 のロードマップ対象)

| 機能 | 内容 | 除外事項 |
|---|---|---|
| 認証・ワークスペース | メール + Google OAuth、1ユーザー=1ワークスペース | チーム招待なし |
| トレンドリサーチ(YouTube) | **YouTube Data API v3** で Shorts を検索・統計取得(公式APIのみ) | TikTok は手動URL入力のみ(§8参照) |
| 構造抽出 | Claude Fable 5 がメタデータ+公開字幕から Reusable Structure JSON を生成 | 映像フレーム解析なし |
| 構造ライブラリ | 保存・タグ・検索 | 共有機能なし |
| URL 取り込み | 一般 Web ページ、Google Docs(公開/OAuth)、Notion(公開ページ) | 認証必須の社内システムは非対応 |
| コンセプト生成 | 3案生成 → 選択 | A/Bスコアリングなし |
| 台本・絵コンテ生成 | シーン分割台本 + テキスト絵コンテ + 素材リスト + 編集指示 + キャプション | 画像絵コンテなし |
| 書き出し | Markdown / PDF / CSV(素材リスト) | 動画レンダリングなし |
| セーフガード | 類似度チェック(生成台本 vs 参照字幕)、NGワード、免責表示 | — |

### 3.2 V1(2〜4ヶ月目)

- **TikTok 公式連携**: TikTok Research API / Display API 申請が通り次第、統計取得を自動化。
- **画像付き絵コンテ**: 画像生成 API(例: 画像生成モデル)でシーンごとのラフ画。
- **半自動動画生成**: テンプレートベースのレンダリング(Remotion / Creatomate / Shotstack のいずれか)。TTS ナレーション(ElevenLabs / Google TTS 日本語)+ テロップ焼き込み + ストック素材差し込みで MP4 出力。
- **ブランドキット**: ロゴ・フォント・カラー・トーン&マナー・NGワードをプロジェクトに自動適用。
- **チーム機能**: ワークスペース招待、権限(閲覧/編集/管理)。
- **パフォーマンス学習(手動)**: 公開後の再生数を手入力 → 構造ごとの勝率を可視化。

### 3.3 将来バージョン(V2+)

- **完全自動パイプライン**: 企画→台本→音声→映像→字幕→サムネまでワンクリック。人間はレビューのみ。
- **アバター/AI出演者**: HeyGen 等の連携(本人同意済みアバターのみ)。
- **公式アカウント連携投稿**: YouTube Data API(upload)、TikTok Content Posting API、Instagram Graph API による予約投稿。※各社の審査・規約遵守が前提。
- **クローズドループ最適化**: 投稿後の実績データを API で自動回収し、構造ライブラリの勝率を自動更新 → コンセプト生成時に勝率の高い構造を優先提案。
- **マルチ言語展開**: 日本語→英語/韓国語などの横展開パッケージ生成。

---

## 4. システムアーキテクチャ

### 4.1 全体図

```
┌────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                       │
│   S1-S11 の画面 / SSE で進捗受信 / 絵コンテエディタ              │
└───────────────┬────────────────────────────────────────────────┘
                │ HTTPS (REST + SSE)
┌───────────────▼────────────────────────────────────────────────┐
│                     API Server (NestJS or FastAPI)              │
│  Auth / Projects / Research / Structures / Scripts / Jobs API   │
└───────┬───────────────┬───────────────┬────────────────────────┘
        │               │               │
        │          ┌────▼────┐     ┌────▼─────────┐
        │          │ Postgres │     │ Redis (Queue │
        │          │ (+pgvector)    │  + Cache)    │
        │          └────┬────┘     └────┬─────────┘
        │               │               │ BullMQ / Celery
        │        ┌──────┴───────────────▼──────────────────────┐
        │        │                Worker Pool                    │
        │        │  ┌─────────────┐ ┌──────────────┐            │
        │        │  │ Research    │ │ Ingest Worker │            │
        │        │  │ Worker      │ │ (URL取り込み)  │            │
        │        │  └──────┬──────┘ └──────┬───────┘            │
        │        │  ┌──────▼──────┐ ┌──────▼───────┐            │
        │        │  │ Analysis    │ │ Generation    │            │
        │        │  │ Worker(AI)  │ │ Worker(AI)    │            │
        │        │  └──────┬──────┘ └──────┬───────┘            │
        │        │  ┌──────▼───────────────▼───────┐            │
        │        │  │ Render Worker (V1: 動画生成)   │            │
        │        │  └───────────────────────────────┘            │
        │        └───────┬───────────────┬───────────────────────┘
        │                │               │
┌───────▼──────┐  ┌──────▼───────┐ ┌────▼──────────────────────┐
│ Object Store │  │ 外部 API 群    │ │ AI Layer                   │
│ (S3/R2)      │  │ YouTube Data  │ │ Anthropic API {{MODEL_ID}} │
│ 生成物・PDF・  │  │ TikTok API    │ │ (+ 画像生成 / TTS / 動画    │
│ 動画ファイル   │  │ Notion/GDocs  │ │  レンダリング API)          │
└──────────────┘  └───────────────┘ └───────────────────────────┘
```

### 4.2 モジュール構成

| モジュール | 責務 | 主要技術 |
|---|---|---|
| `auth` | OAuth、セッション、ワークスペース | NextAuth / Auth.js |
| `research` | プラットフォーム API 呼び出し、レート制御、統計正規化 | YouTube Data API v3、TikTok Research API(承認後) |
| `ingest` | ユーザー提供 URL の取得・本文抽出・要約 | Readability 系抽出 + Notion API / Google Docs API |
| `analysis` | トレンド動画 → Reusable Structure 抽出(AI) | Anthropic API `{{MODEL_ID}}`、structured output |
| `structure-library` | 構造の CRUD、ベクトル検索 | Postgres + pgvector |
| `generation` | コンセプト → 台本 → 絵コンテ → パッケージ生成(AI) | Anthropic API `{{MODEL_ID}}` |
| `compliance` | 類似度チェック、NGワード、権利チェックリスト | embedding 類似度 + ルールエンジン |
| `jobs` | 非同期ジョブ管理、リトライ、進捗通知 | BullMQ(Redis) |
| `render`(V1) | 動画レンダリング統合 | Remotion Lambda / Creatomate / Shotstack |
| `export` | PDF / Markdown / CSV 生成 | Puppeteer or react-pdf |
| `storage` | 生成物・一時ファイル | S3 互換(Cloudflare R2 推奨) |

### 4.3 リサーチ層の設計方針(重要)

**原則: 公式 API ファースト。規約違反スクレイピングをアーキテクチャから排除する。**

| ソース | MVP での取得方法 | 備考 |
|---|---|---|
| YouTube Shorts | YouTube Data API v3(`search.list` + `videos.list`)。統計(視聴数・高評価・コメント数)、タイトル、説明、公開日時、チャンネル情報。字幕は `captions` が使える自チャンネル以外は、**公開されている字幕/自動字幕をユーザーが確認の上で参照**する運用 | クォータ管理必須(10,000 units/日)。成長率は日次スナップショット差分で算出 |
| TikTok | MVP: ユーザーが動画 URL を貼り、**oEmbed API** でタイトル・投稿者などの公開メタデータのみ取得。V1: **TikTok Research API**(審査制)申請 | 非公式スクレイパーは採用しない(§8) |
| Instagram Reels | V1 以降: Instagram Graph API(ビジネスアカウントの oEmbed / Hashtag Search) | MVP では手動入力のみ |

- **日次スナップショット**: リサーチ済み動画は `video_snapshots` に統計を毎日記録し、`(views_today - views_yesterday) / hours` で成長速度を計算。「急成長」の定義はニッチ内の Z スコアで正規化。
- **キャッシュ**: 同一ニッチのリサーチは 6 時間キャッシュしてクォータを節約。

### 4.4 キュー設計

| キュー | ジョブ | タイムアウト | リトライ |
|---|---|---|---|
| `q:research` | ニッチリサーチ(API 呼び出し群) | 5分 | 3回 / 指数バックオフ |
| `q:ingest` | URL 取り込み・抽出・要約 | 2分 | 2回 |
| `q:analysis` | 構造抽出(AI) | 3分 | 2回 |
| `q:generation` | コンセプト/台本/パッケージ生成(AI) | 5分 | 2回 |
| `q:render`(V1) | 動画レンダリング | 20分 | 1回 |
| `q:snapshot` | 日次統計スナップショット(cron) | 10分 | 3回 |

進捗はジョブが Redis の pub/sub に発行 → API サーバが SSE でフロントへ中継。

---

## 5. 推奨技術スタックとトレードオフ

| レイヤ | 推奨 | 代替 | トレードオフ |
|---|---|---|---|
| フロントエンド | **Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui** | Remix, Nuxt | Next.js は採用実績・Vercel デプロイ・SSE 対応が楽。学習コストは中 |
| 状態管理 | TanStack Query(サーバ状態)+ Zustand(エディタ状態) | Redux | 台本エディタは局所状態が多いので軽量な Zustand が向く |
| バックエンド | **NestJS (TypeScript)** | FastAPI (Python) | チームが TS 統一ならNest。AI/データ処理を Python 資産に寄せたいなら FastAPI。**小規模チームは言語を1つに統一する価値が高い → TS 統一を推奨** |
| DB | **PostgreSQL 16 + pgvector** | MySQL + 外部ベクトルDB | 構造の類似検索・重複検知に pgvector が同居できるのが大きい。専用ベクトルDB(Pinecone等)は運用対象が増えるので MVP では不要 |
| キュー | **BullMQ + Redis** | SQS, Cloud Tasks | BullMQ は進捗イベント・リトライ・優先度が揃いセルフホストが容易。マネージド志向なら Cloud Tasks |
| ストレージ | **Cloudflare R2** | S3 | R2 は egress 無料で動画配信コストに効く。エコシステムは S3 が最強 |
| AI(推論) | **Anthropic API `{{MODEL_ID}}`**(全ステージ)。要約など軽処理は Haiku 系にフォールバック可 | — | 高精度が必要な構造抽出・台本生成は上位モデル、コスト最適化は軽量モデルの2段構え |
| URL 抽出 | Mozilla Readability + Playwright(要 JS レンダリング時のみ) | Firecrawl 等の SaaS | SaaS は楽だがコストと送信データの管理に注意 |
| 動画レンダリング(V1) | **Remotion(React ベース、セルフホスト/Lambda)** | Creatomate / Shotstack(SaaS) | Remotion はテロップ表現の自由度が高く日本語組版を制御できるがエンジニア工数がかかる。SaaS はテンプレート制約があるが2週間で動く。**V1 最速なら Creatomate、差別化狙いなら Remotion** |
| TTS(V1) | ElevenLabs(日本語品質)/ Google Cloud TTS(コスト) | Azure TTS | 日本語の自然さ vs 単価のトレードオフ |
| 認証 | Auth.js + Google OAuth | Clerk, Supabase Auth | Clerk は最速だがコスト増。小規模なら Auth.js で十分 |
| ホスティング | Vercel(FE)+ Fly.io or Railway(API/Worker) | 全部 AWS | 小規模チームの運用負荷最小を優先。スケール時に AWS へ |
| 監視 | Sentry + OpenTelemetry + Langfuse(LLM トレース) | — | LLM の入出力トレースは品質改善に必須。Langfuse はセルフホスト可で日本語データを外に出しにくい構成にできる |

---

## 6. AIワークフロー: 各ステージでの Claude Fable 5 の使い方

全ステージ共通の方針:

- **JSON Schema による structured output** を必ず使う(後続処理が機械可読前提)。
- **system プロンプトに「非複製ポリシー」を常時注入**(§8.4 のポリシーブロック)。
- **温度**: 抽出系は低め(0.2)、コンセプト/台本の発想系は高め(0.8)。
- 長い入力(字幕・LP本文)は事前に Haiku 系で要約してからメインモデルに渡し、コストを制御。

### ステージ一覧

| # | ステージ | 入力 | 出力 | モデル設定 |
|---|---|---|---|---|
| A1 | ニッチ→検索クエリ展開 | ニッチ名、地域、期間 | 検索キーワード配列、除外語 | `{{MODEL_ID}}`, temp 0.4 |
| A2 | 成長要因の仮説生成 | 動画メタデータ+統計スナップショット(複数本) | 各動画の成長仮説(定性) | temp 0.3 |
| A3 | **構造抽出(コア)** | メタデータ+公開字幕(あれば)+仮説 | Reusable Structure JSON | temp 0.2, JSON mode |
| A4 | 構造の重複統合 | 新構造 + 既存類似構造(pgvector 検索結果) | マージ判定と統合案 | temp 0.2 |
| B1 | 素材要約 | 取り込んだ URL 本文 | 商材サマリ(訴求点、ターゲット、証拠、トーン) | Haiku 系で可, temp 0.3 |
| B2 | コンセプト生成 | 商材サマリ + 選択構造(または自動推薦3構造) | コンセプト案 3〜5 件 | temp 0.8 |
| B3 | 台本・絵コンテ生成 | 選択コンセプト + 商材サマリ + ブランドキット | シーン分割台本 JSON(セリフ/テロップ/映像指示/尺) | temp 0.6 |
| B4 | 制作パッケージ化 | 台本 JSON | 素材リスト、編集指示書、キャプション、ハッシュタグ、CTA | temp 0.4 |
| C1 | コンプライアンス審査 | 生成台本 + 参照字幕(あれば) | 類似箇所指摘、リスクフラグ、修正提案 | temp 0.0 |
| C2 | 行単位リライト | 対象行 + 前後文脈 + 指示 | 置換候補 3 件 | temp 0.9 |

### 各ステージのプロンプト設計要点

- **A3(構造抽出)**: 「表現を一切引用せず、抽象化された構造のみを出力せよ。固有のフレーズ・人名・商品名を含めた場合は無効」と明記し、出力スキーマに自由記述の長文フィールドを置かない(引用混入を構造的に防ぐ)。
- **B2(コンセプト生成)**: 構造 JSON を「制約条件」として与え、「この構造に**あなたの商材を**当てはめよ。参照動画の話題・表現は入力に含まれていないので参照しようがない」という情報遮断設計にする(A3 の出力のみを渡し、元字幕は渡さない)。**これが非複製の技術的担保になる。**
- **C1(審査)**: 唯一、参照字幕と生成物を同時に見るステージ。embedding 類似度(しきい値 0.85)で機械チェック後、フラグ行のみ AI が判定する2段構成でコストを抑える。

---

## 7. データスキーマ

PostgreSQL 前提。主キーは UUID v7。`created_at` / `updated_at` は全テーブル共通のため省略。

### 7.1 `users` / `workspaces`

```sql
users(
  id uuid PK,
  email text UNIQUE NOT NULL,
  name text,
  auth_provider text,          -- 'google' | 'email'
  locale text DEFAULT 'ja'
)

workspaces(
  id uuid PK,
  name text NOT NULL,
  owner_user_id uuid FK->users,
  plan text DEFAULT 'free',    -- 'free' | 'pro' | 'agency'
  brand_kit jsonb              -- {logo_url, colors[], fonts[], tone, ng_words[]}
)

workspace_members(
  workspace_id uuid FK, user_id uuid FK,
  role text,                   -- 'admin' | 'editor' | 'viewer'
  PRIMARY KEY (workspace_id, user_id)
)
```

### 7.2 `trend_videos`(参照動画メタデータ — 統計と出典のみ)

```sql
trend_videos(
  id uuid PK,
  workspace_id uuid FK,
  platform text NOT NULL,        -- 'youtube' | 'tiktok' | 'instagram'
  external_id text NOT NULL,     -- プラットフォーム動画ID
  url text NOT NULL,
  title text,
  channel_name text,
  channel_id text,
  published_at timestamptz,
  duration_sec int,
  niche text,                    -- リサーチ時のニッチタグ
  hashtags text[],
  fetched_via text,              -- 'youtube_api' | 'oembed' | 'manual'
  transcript_ref text,           -- 一時保存先キー(TTL付き, §8.2)。長期保存しない
  UNIQUE (platform, external_id)
)

video_snapshots(
  id uuid PK,
  trend_video_id uuid FK->trend_videos,
  captured_at timestamptz NOT NULL,
  views bigint, likes bigint, comments bigint, shares bigint,
  UNIQUE (trend_video_id, captured_at::date)
)
```

### 7.3 `trend_analyses`(成長仮説)

```sql
trend_analyses(
  id uuid PK,
  workspace_id uuid FK,
  niche text NOT NULL,
  period_start date, period_end date,
  video_ids uuid[],              -- 対象 trend_videos
  growth_metrics jsonb,          -- {video_id: {views_per_hour, z_score, ...}}
  hypothesis jsonb,              -- A2の出力: [{video_id, growth_factors[], confidence}]
  model_id text,                 -- 生成に使ったモデル(監査用)
  status text                    -- 'queued'|'running'|'done'|'failed'
)
```

### 7.4 `reusable_structures`(コア資産)

```sql
reusable_structures(
  id uuid PK,
  workspace_id uuid FK,
  name text NOT NULL,                -- 例: '損失回避フック×Before/After 8シーン型'
  niche text,
  source_analysis_id uuid FK->trend_analyses,
  structure jsonb NOT NULL,          -- 下記スキーマ
  embedding vector(1536),            -- 類似検索用
  win_rate numeric,                  -- V1: 実績からの勝率
  usage_count int DEFAULT 0,
  is_favorite boolean DEFAULT false
)
```

`structure` JSONB のスキーマ(A3 の出力形式):

```json
{
  "hook": { "type": "loss_aversion", "pattern_ja": "冒頭0.5秒で『まだ◯◯してるの?』型の疑問+損失提示", "duration_sec": 1.5 },
  "opening": { "pattern": "conclusion_first", "text_overlay_density": "high" },
  "pacing": { "avg_cut_length_sec": 1.8, "total_scenes": 8, "tempo_curve": "fast-slow-fast" },
  "scene_sequence": [
    { "role": "hook", "sec": 2 },
    { "role": "problem", "sec": 4 },
    { "role": "demo_before", "sec": 5 },
    { "role": "demo_after", "sec": 6 },
    { "role": "proof", "sec": 5 },
    { "role": "objection_handling", "sec": 4 },
    { "role": "summary", "sec": 2 },
    { "role": "cta", "sec": 2 }
  ],
  "emotional_triggers": ["surprise", "loss_aversion", "relief"],
  "caption_style": { "position": "center_high", "max_chars_per_line": 13, "emphasis": "keyword_color_change", "density": "every_scene" },
  "cta_style": { "type": "save_prompt", "pattern_ja": "『あとで見返せるように保存』型" },
  "editing_rhythm": { "beat_sync": true, "jump_cut_per_10s": 4, "sfx_usage": "transition_only" },
  "evidence": { "video_count": 5, "avg_z_score": 2.3 }
}
```

### 7.5 `projects` / `source_materials`(ユーザー素材)

```sql
projects(
  id uuid PK,
  workspace_id uuid FK,
  name text NOT NULL,
  goal text,                     -- 'awareness'|'conversion'|'follower_growth'
  target_platforms text[],       -- ['youtube_shorts','tiktok','reels']
  target_duration_sec int,
  audience_note text,
  status text                    -- 'draft'|'concept'|'scripting'|'package'|'rendering'|'done'
)

source_materials(
  id uuid PK,
  project_id uuid FK->projects,
  url text NOT NULL,
  source_type text,              -- 'webpage'|'google_docs'|'notion'|'script'|'landing_page'|'product_page'
  fetch_status text,             -- 'pending'|'fetched'|'failed'|'blocked'
  title text,
  content_summary jsonb,         -- B1の出力 {value_props[], target, evidence[], tone, price, ...}
  raw_content_ref text,          -- Object Storage キー(暗号化, ワークスペース削除で消去)
  user_confirmed boolean DEFAULT false   -- S6の人間確認フラグ
)
```

### 7.6 `concepts` / `scripts`(生成物)

```sql
concepts(
  id uuid PK,
  project_id uuid FK,
  structure_id uuid FK->reusable_structures,
  title text,
  hook_line text,                -- オリジナルのフック文
  synopsis text,
  rationale text,                -- なぜこの構造×商材が合うか
  est_duration_sec int,
  is_selected boolean DEFAULT false,
  model_id text
)

scripts(
  id uuid PK,
  project_id uuid FK,
  concept_id uuid FK,
  version int NOT NULL DEFAULT 1,
  scenes jsonb NOT NULL,         -- 下記
  captions jsonb,                -- {youtube: {title, description, tags[]}, tiktok: {caption, hashtags[]}, reels: {...}}
  asset_list jsonb,              -- [{scene_no, type:'footage'|'image'|'sfx'|'bgm'|'prop', description, source_suggestion}]
  edit_instructions jsonb,       -- [{scene_no, cut_style, transition, text_animation, timing_note}]
  compliance jsonb,              -- C1の結果 {status:'pass'|'flagged', flags:[{scene_no, reason, similarity}]}
  model_id text
)
```

`scenes` の要素スキーマ:

```json
{
  "scene_no": 1,
  "role": "hook",
  "duration_sec": 2.0,
  "dialogue_ja": "え、まだ夜ごはんに30分かけてるの?",
  "text_overlay_ja": "まだ30分かけてるの?",
  "visual_direction": "手元アップ。時計とため息のカットを0.5秒ずつ",
  "camera": "handheld_closeup",
  "sfx": "whoosh_in"
}
```

### 7.7 `video_jobs`(非同期ジョブ / レンダリング)

```sql
video_jobs(
  id uuid PK,
  workspace_id uuid FK,
  project_id uuid FK NULL,
  job_type text,                 -- 'research'|'ingest'|'analysis'|'generation'|'render'|'snapshot'
  payload jsonb,
  status text,                   -- 'queued'|'running'|'done'|'failed'|'canceled'
  progress int DEFAULT 0,        -- 0-100
  error text,
  output_ref text,               -- Object Storage キー(MP4, PDF等)
  cost_usd numeric,              -- AI/レンダリングの原価記録
  started_at timestamptz, finished_at timestamptz
)
```

---

## 8. 法的・倫理的セーフガード

### 8.1 著作権(日本法を基準に)

| リスク | 対策 |
|---|---|
| 台本が参照動画の表現を複製する | ① 生成ステージ(B2/B3)に元の字幕・台本を**入力しない**情報遮断設計(§6)。② C1 で embedding 類似度チェック(生成文 vs 参照字幕、しきい値超えはフラグ→再生成)。③ 構造 JSON に自由記述長文フィールドを持たせない |
| 「構造」自体の権利主張 | アイデア・作風・ありふれた構成は著作権保護の対象外(アイデア/表現二分論)だが、**特定1本の完全トレースを防ぐ**ため、構造は原則複数本(3本以上)からの統計的抽出とし、`evidence.video_count >= 3` を推奨要件とする |
| 映像・音声素材の流用 | 参照動画のダウンロード・フレーム抽出・音声抽出機能を**実装しない**。素材リストは「ユーザー自身が撮影/購入する素材の指示書」として生成 |
| BGM・楽曲 | 素材リストでは「◯◯風の雰囲気」ではなく「テンポ120前後のアップビート、権利クリアな音源(Artlist等)から選定」という**調達指示**形式にする |

### 8.2 プラットフォーム規約

- **スクレイピング禁止の遵守**: YouTube は Data API のみ、TikTok は oEmbed / Research API のみ。ヘッドレスブラウザでのプラットフォーム巡回は実装しない。
- **字幕・書き起こしの扱い**: 公開字幕を参照した場合も、**構造抽出(A3)と審査(C1)完了後にオブジェクトストレージから TTL(72時間)で自動削除**。DB には保存しない(`transcript_ref` は一時キー)。
- **API 利用規約**: YouTube API Services の Developer Policies(データ保持 30 日制限等)に準拠したデータ更新/削除ジョブを cron 化。
- **投稿自動化**: 各プラットフォームの公式 Posting API 審査を通すまで実装しない(非公式自動投稿はアカウント BAN リスクをユーザーに転嫁するため)。

### 8.3 プライバシー(APPI/個人情報保護法)

- Google Docs / Notion の OAuth 取り込みは**最小スコープ**(読み取り専用、指定ドキュメントのみ)。
- 取り込んだ素材本文は暗号化保存(SSE-KMS)、ワークスペース削除で即時消去。AI プロバイダへの送信は「学習に使用されない」API プラン(Anthropic API はデフォルトで学習不使用)であることを利用規約に明記。
- 取り込み時に個人情報らしきパターン(メール・電話・住所)を検知したら S6 の確認画面で警告表示。
- ログ(Langfuse)にはユーザー素材の生データを残さない設定(マスキング)。

### 8.4 プロンプトに常時注入する非複製ポリシーブロック

```
<policy>
あなたは構造分析の専門家である。以下を厳守せよ:
1. 参照コンテンツから特定のフレーズ、セリフ、キャッチコピー、固有名詞、
   数値表現を引用・転記してはならない。
2. 出力は抽象化されたパターン(型、テンポ、構成、感情設計)のみとする。
3. 特定の1本の動画を再現可能なレベルの詳細を出力してはならない。
4. 出演者の話し方・声・外見の模倣指示を生成してはならない。
5. 誇大広告・薬機法/景表法に抵触しうる表現(効果の断定等)を避け、
   検出した場合は代替表現を提案せよ。
</policy>
```

### 8.5 UI 上のセーフガード

- 書き出し PDF の末尾に「本資料は構造参考に基づくオリジナル企画です。参照動画一覧: (URL のみ)」の出典セクションを自動挿入(トレーサビリティ)。
- C1 でフラグが立った台本は書き出しボタンを警告付きにし、修正 or ユーザーの明示的承認を要求。
- 薬機法・景表法 NG ワード辞書(美容・健康・金融ニッチ向け)を `compliance` モジュールに同梱。

---

## 9. プロンプト例・出力例・E2Eサンプルワークフロー

### 9.1 プロンプト例 A3: 構造抽出

**system**(抜粋):

```
あなたはショート動画の構造分析の専門家です。{{§8.4 のポリシーブロック}}
出力は必ず指定の JSON Schema に従うこと。
```

**user**:

```
以下は「時短レシピ」ニッチで直近14日に急成長した5本の動画のメタデータと
成長仮説です。共通する再利用可能な構造を1つ抽出してください。

[動画1] 時間: 34秒 / 公開48時間で views 82万 (z=2.9) / タイトル傾向: 疑問形
成長仮説: 冒頭1秒でテロップ提示、結論先出し、Before/After構成
[動画2] ...(以下同様、統計と仮説のみ。字幕全文は渡さない)

出力スキーマ: {{reusable_structures.structure の JSON Schema}}
```

**出力例**: §7.4 の `structure` JSON(あの例そのもの)。

### 9.2 プロンプト例 B2: コンセプト生成

**user**:

```
## 商材サマリ(ユーザー提供URLの要約)
- 商品: 電気圧力鍋「QuickPot Mini」(公式LPより)
- 主訴求: 材料を入れてボタン1つ、平均調理時間8分
- ターゲット: 共働き30代、夕食準備の時間がない
- 証拠: 購入者レビュー4.6、時短実測データあり
- トーン: 親しみやすい、押し売りしない

## 使用する構造
{{選択された reusable_structures.structure の JSON}}

## 制約
- 尺: 30秒 / プラットフォーム: TikTok + YouTube Shorts
- ブランドNGワード: 「絶対」「最安」
- 構造の各シーン役割に商材を当てはめた、完全オリジナルのコンセプトを3案。

出力スキーマ: [{title, hook_line, synopsis, rationale, est_duration_sec}]
```

**出力例(1案目)**:

```json
{
  "title": "『夕食まだ30分かけてるの?』損失回避×Before/After",
  "hook_line": "え、夕食づくりにまだ30分溶かしてるの?",
  "synopsis": "帰宅後の慌ただしいキッチン(Before)→QuickPotに材料を入れてボタンを押し、その間に子どもと遊ぶ(After)→8分後に完成カット→レビュー実績→『保存して今夜試してみて』のCTA。",
  "rationale": "構造の損失回避フックは『時間の損失』を訴求軸に持つ本商材と一致。demo_before/afterシーンが調理時間の対比に直訳できる。",
  "est_duration_sec": 30
}
```

### 9.3 E2E サンプルワークフロー(代理店ディレクターの1日)

1. **10:00** S3 でニッチ「時短家電」/ JP / 14日間 を設定しリサーチ実行 → `q:research` に投入。YouTube API で 120 本取得、スナップショット差分で上位 15 本を抽出(所要 3 分)。
2. **10:05** `q:analysis` が A2→A3 を実行。5本クラスタ×3 から 3 つの Reusable Structure が生成され、S4 に表示。ディレクターは「損失回避×Before/After 8シーン型」を構造ライブラリに保存。
3. **10:15** S6 で新規プロジェクト「QuickPot 秋キャンペーン」を作成。LP URL と Notion の企画書 URL を貼付 → `q:ingest` が本文抽出・B1 要約 → 確認画面でサマリを承認(`user_confirmed = true`)。
4. **10:25** S7 でコンセプト 3 案が生成され(B2)、1案目を選択。
5. **10:30** B3 が 8 シーン台本 + 絵コンテ + B4 の制作パッケージを生成。C1 審査は pass(参照字幕は今回未使用のため類似チェックは NG ワードのみ)。
6. **10:40** S8 でシーン 5 のセリフを C2 で 3 候補からリライト。ブランドキットの NG ワード「絶対」が自動置換されていることを確認。
7. **10:45** S9 から PDF(絵コンテ+編集指示書)と CSV(素材リスト)を書き出し、撮影チームの Slack に共有。**リサーチ開始から 45 分で撮影可能な制作パッケージが完成。**
8. (V1 なら)ストック素材+TTS で `q:render` に投入し、20 分後にレビュー用 MP4 を取得。

---

## 10. 30日ビルドロードマップ

前提: エンジニア 2 名(フルスタック 1、バックエンド寄り 1)+ 兼任 PM/デザイン 1。

| 週 | 日 | 実装内容 | 完了条件(DoD) |
|---|---|---|---|
| **W1: 基盤** | 1-2 | リポジトリ・CI・環境構築。Next.js + NestJS + Postgres + Redis の Docker Compose。Auth.js で Google ログイン | ログイン→ダッシュボード表示 |
| | 3-4 | スキーマ実装(§7 全テーブル)+ マイグレーション。BullMQ ジョブ基盤 + SSE 進捗通知 | ダミージョブの進捗が UI に流れる |
| | 5 | YouTube Data API 連携(`research` モジュール)。クォータ管理・キャッシュ | ニッチ検索で動画メタデータが DB に入る |
| **W2: リサーチ→構造抽出** | 6-7 | スナップショット cron + 成長率算出(Zスコア)。S3/S4 画面 | 「急成長」ソートが機能する |
| | 8-9 | Anthropic API 統合(`{{MODEL_ID}}`)。A1/A2/A3 プロンプト実装 + structured output + Langfuse | 実データから Reusable Structure JSON が生成される |
| | 10 | 構造ライブラリ(S5)+ pgvector 類似検索 + A4 重複統合 | 構造の保存・検索・タグが動く |
| **W3: 素材取り込み→生成** | 11-12 | `ingest` モジュール(Readability + Google Docs/Notion API)+ B1 要約 + S6 確認画面 | LP URL からサマリ承認まで通る |
| | 13-14 | B2 コンセプト生成 + S7 画面(3案カード、再生成) | 構造×商材でコンセプト3案が出る |
| | 15-16 | B3 台本生成 + S8 エディタ(シーンテーブル + 縦型ワイヤープレビュー) | 8シーン台本の編集・保存 |
| | 17 | C2 行単位リライト + ブランドキット NG ワード適用 | 行選択→3候補置換が動く |
| **W4: 審査→書き出し→仕上げ** | 18-19 | C1 コンプライアンス審査(embedding 類似度 + NGワード辞書 + AI 判定)| フラグが S8/S9 に表示される |
| | 20-21 | B4 制作パッケージ生成 + S9 書き出し(PDF/Markdown/CSV、出典セクション自動挿入) | PDF ダウンロードまで E2E で通る |
| | 22-23 | TikTok oEmbed 手動 URL 追加フロー。データ保持ポリシー(字幕 TTL 削除、YouTube 30日ルール)の cron | 規約準拠ジョブがテスト付きで動く |
| | 24-25 | E2E テスト(§9.3 のフロー)、コスト計測(`cost_usd`)、レート制限、エラーハンドリング | ハッピーパスが無人で通る |
| | 26-27 | クローズドβ向けデプロイ(Vercel + Fly.io + R2)、Sentry、利用規約/プライバシーポリシー文面 | 本番 URL で 5 ユーザーが触れる |
| | 28-30 | βユーザー 3〜5 社オンボーディング、フィードバック収集、プロンプト調整(温度・few-shot) | 各社 1 本以上の制作パッケージ書き出し実績 |

**30日時点で除外したもの(意図的)**: 動画レンダリング(V1)、TikTok Research API(審査待ち)、チーム機能、投稿連携。

---

## 11. セルフチェック

| 観点 | カバー箇所 | 判定 |
|---|---|---|
| プロダクト定義(誰に・何を) | §1, §3 | ✅ ペルソナ 3 種、MVP/V1/V2 の線引きあり |
| UX(画面・フロー) | §2 | ✅ 11 画面 + ハッピーパス + 非同期/人間確認の設計方針 |
| AI ワークフロー | §6, §9 | ✅ 10 ステージ、モデル設定、情報遮断設計、プロンプト実例 |
| 技術アーキテクチャ | §4, §5 | ✅ モジュール・キュー・外部API・スタック比較表 |
| データ設計 | §7 | ✅ 要求された 7 スキーマ(videos/analyses/structures/projects/URLs/scripts/jobs)すべて DDL レベルで定義 |
| 法的セーフガード | §8 | ✅ 著作権(情報遮断+類似度検査+複数本抽出)、規約(公式APIのみ+TTL削除)、APPI、薬機法/景表法 |
| 実装ステップ | §10 | ✅ 日単位 30 日ロードマップ + DoD |
| 現実性(小規模チーム) | §5, §10 | ✅ TS 統一・マネージド優先・レンダリングは V1 送り |

**既知のリスクと逃げ道**: ① TikTok Research API の審査が通らない場合 → oEmbed + 手動 URL 運用を恒久化し、YouTube 中心にピボット。② YouTube API クォータ逼迫 → キャッシュ延長 + クォータ増申請。③ 生成品質が不安定 → Langfuse のトレースを使い W4 でプロンプトの few-shot を各ニッチ 3 例ずつ整備。
