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

現在の価格データは、実市場フィード（TrendForce / DRAMeXchange のスポット・
コントラクト価格等）を模した **決定論的ジェネレータ**（`src/providers/priceSource.js`）で
生成しています。これらの商用フィードは本環境から直接取得できないためです。
実フィードに差し替える場合は `fetchSeries()` を非同期実装に置き換えるだけで、
集計・API・UI はそのまま利用できます。
