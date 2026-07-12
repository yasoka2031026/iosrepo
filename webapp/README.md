# メモリ / SSD 平均価格トラッカー

韓国・中国・アメリカ・台湾・日本の主要なメモリ / SSD メーカー（製造・販売企業）の
販売価格動向から、**等間隔で平均価格**を取得できるウェブアプリです。

## 対象メーカー

| 国 | メーカー | 製品 |
|----|----------|------|
| 韓国 | Samsung, SK hynix | DRAM / NAND |
| 中国 | YMTC, CXMT | NAND / DRAM |
| アメリカ | Micron | DRAM / NAND |
| 台湾 | Nanya, Winbond | DRAM / NAND |
| 日本 | Kioxia | NAND |

## 機能

- 製品カテゴリ（DRAM / NAND）・国・取得間隔・期間を選択
- **等間隔（毎日 / 毎週 / 隔週 / 毎月 / 四半期、または任意の日数）** で平均価格を集計
- 平均価格の推移グラフ（最小〜最大レンジ付き）、サマリー、明細テーブル
- REST API（`/api/prices/average`）

## セットアップ

```bash
cd webapp
npm install
npm start          # http://localhost:3000
```

## 検証

```bash
npm test           # ユニットテスト
npm run loop       # サーバを起動し全エンドポイントをループで検証
```

## API

`GET /api/prices/average`

| パラメータ | 例 | 説明 |
|-----------|-----|------|
| `category` | `DRAM` / `NAND` | 製品カテゴリ |
| `country` | `KR`/`CN`/`US`/`TW`/`JP` | 国フィルタ（省略=全て） |
| `interval` | `weekly` / `30` | 等間隔（名称または日数） |
| `days` | `180` | 期間（`from`/`to` 未指定時） |
| `from`,`to` | `2026-01-01` | 明示的な期間指定 |
| `manufacturers` | `samsung,micron` | メーカー絞り込み |

## データソースについて

本アプリは **2種類** のデータソースを持ちます。

### 1. 実売価格（無料公開ソース）— `src/providers/livePriceSource.js`

- **PricePerGig 無料 JSON API**（`https://api.pricepergig.com/drives`、認証不要・約30req/分）から
  現在の SSD / メモリの実売リストを取得し、メーカー別の平均価格（USD/GB）に正規化します。
- エンドポイント:
  - `GET /api/prices/live?category=NAND` … 現在の実売価格（メーカー別）
  - `POST /api/prices/refresh?category=NAND` … 現在価格をスナップショットとして記録
- 公開ソースは **現在価格のみ** を提供するため、`POST /api/prices/refresh` を等間隔
  （cron 等）で呼ぶと、`data/snapshots.jsonl` に実データの履歴が蓄積され、等間隔の
  実データ推移を集計できるようになります（`src/store.js`）。

> 注: 実行環境の**送信ネットワークが制限されている場合**（今回の開発サンドボックス等）、
> 公開ソースへ到達できず `/api/prices/live` は `{ available:false, reason }` を返します。
> オープンなネットワークでデプロイすると自動的に実売価格が有効になります。

### 2. モデル系列（オフライン・フォールバック）— `src/providers/priceSource.js`

- メモリ市況の周期性・季節性を反映した **決定論的ジェネレータ**。ネットワーク不要で
  再現性があるため、履歴チャートの初期表示・テスト・オフライン動作に使用します。
- 実データのスナップショットが十分に蓄積されるまでの過去区間を埋める役割も担います。

### 参考にした無料公開ソース

- PricePerGig（無料 JSON API・実装済み）: https://api.pricepergig.com/drives
- Stanford DAM Memory Prices（DRAM/HBM/NAND の履歴データセット）: https://dam.stanford.edu/memory-prices.html
- TrendForce / DRAMeXchange（スポット・コントラクト価格の参照・商用）
