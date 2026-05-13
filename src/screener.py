"""
Stock data fetcher and screener using yfinance.
Supports both JP (.T suffix) and US tickers.
"""
import yfinance as yf
import pandas as pd
from typing import Optional

# Curated seed list of well-known high-dividend JP stocks
JP_SEED_TICKERS = [
    ("8058.T", "三菱商事"),
    ("8031.T", "三井物産"),
    ("8053.T", "住友商事"),
    ("8001.T", "伊藤忠商事"),
    ("9437.T", "NTTドコモ"),
    ("9432.T", "日本電信電話"),
    ("8316.T", "三井住友FG"),
    ("8306.T", "三菱UFJ FG"),
    ("8411.T", "みずほFG"),
    ("5020.T", "ENEOSホールディングス"),
    ("1925.T", "大和ハウス工業"),
    ("8802.T", "三菱地所"),
    ("4502.T", "武田薬品工業"),
    ("9020.T", "東日本旅客鉄道"),
    ("9984.T", "ソフトバンクグループ"),
    ("8725.T", "MS&ADインシュアランス"),
    ("8750.T", "第一生命HD"),
    ("2914.T", "日本たばこ産業"),
    ("8593.T", "三菱HCキャピタル"),
    ("9433.T", "KDDI"),
]

US_SEED_TICKERS = [
    ("T", "AT&T"),
    ("VZ", "Verizon"),
    ("MO", "Altria"),
    ("O", "Realty Income"),
    ("KO", "Coca-Cola"),
    ("JNJ", "Johnson & Johnson"),
    ("PFE", "Pfizer"),
    ("XOM", "Exxon Mobil"),
    ("CVX", "Chevron"),
    ("IBM", "IBM"),
]


def fetch_stock_info(ticker: str) -> Optional[dict]:
    try:
        t = yf.Ticker(ticker)
        info = t.info
        price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose")
        div_yield = info.get("dividendYield", 0) or 0
        annual_div = info.get("dividendRate", 0) or 0
        name = info.get("shortName") or info.get("longName") or ticker
        currency = info.get("currency", "JPY" if ticker.endswith(".T") else "USD")
        sector = info.get("sector", "不明")
        market_cap = info.get("marketCap", 0) or 0

        if not price:
            return None

        return {
            "ticker": ticker,
            "name": name,
            "price": price,
            "dividend_yield_pct": round(div_yield * 100, 2),
            "annual_dividend": annual_div,
            "currency": currency,
            "sector": sector,
            "market_cap": market_cap,
        }
    except Exception:
        return None


def screen_high_dividend(
    market: str = "JP",
    min_yield: float = 3.0,
    max_results: int = 20,
) -> pd.DataFrame:
    seeds = JP_SEED_TICKERS if market == "JP" else US_SEED_TICKERS
    rows = []
    for ticker, _name in seeds:
        info = fetch_stock_info(ticker)
        if info and info["dividend_yield_pct"] >= min_yield:
            rows.append(info)

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows).sort_values("dividend_yield_pct", ascending=False)
    return df.head(max_results).reset_index(drop=True)


def enrich_portfolio(df_holdings: pd.DataFrame) -> pd.DataFrame:
    """Add current price / yield columns to a holdings DataFrame."""
    if df_holdings.empty:
        return df_holdings

    enriched = []
    for _, row in df_holdings.iterrows():
        info = fetch_stock_info(row["ticker"])
        current_price = info["price"] if info else None
        div_yield = info["dividend_yield_pct"] if info else 0.0
        annual_div_per_share = info["annual_dividend"] if info else 0.0
        annual_income = annual_div_per_share * row["shares"] if annual_div_per_share else 0.0
        monthly_income = annual_income / 12
        currency = info["currency"] if info else ("JPY" if row["ticker"].endswith(".T") else "USD")
        gain_loss = None
        if current_price:
            gain_loss = (current_price - row["buy_price"]) / row["buy_price"] * 100

        enriched.append({
            **row.to_dict(),
            "current_price": current_price,
            "dividend_yield_pct": div_yield,
            "annual_div_per_share": annual_div_per_share,
            "annual_income": round(annual_income, 2),
            "monthly_income": round(monthly_income, 2),
            "currency": currency,
            "gain_loss_pct": round(gain_loss, 2) if gain_loss is not None else None,
        })

    return pd.DataFrame(enriched)
