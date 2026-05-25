"""
Stock data fetcher and screener using yfinance.
Supports both JP (.T suffix) and US tickers.
"""
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
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


def get_usd_jpy() -> tuple[float, str]:
    """Fetch live USD/JPY rate via yfinance. Returns (rate, timestamp_str)."""
    try:
        t = yf.Ticker("USDJPY=X")
        info = t.info
        rate = info.get("regularMarketPrice") or info.get("previousClose") or 155.0
        ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        return float(rate), ts
    except Exception:
        return 155.0, "取得失敗"


def _infer_payment_months(dividends: pd.Series) -> list[int]:
    """
    From historical dividend Series (DatetimeIndex), infer which calendar months
    dividends are typically paid. Uses last 2 years of data.
    """
    if dividends.empty:
        return []
    cutoff = pd.Timestamp.now() - pd.DateOffset(years=2)
    recent = dividends[dividends.index >= cutoff]
    if recent.empty:
        recent = dividends.tail(6)
    months = sorted(set(recent.index.month.tolist()))
    return months


def build_dividend_calendar(
    df_holdings: pd.DataFrame,
    usd_jpy: float = 155.0,
) -> pd.DataFrame:
    """
    Build a forward-looking 12-month dividend calendar from portfolio holdings.

    Returns DataFrame with columns:
        year_month (YYYY-MM str), ticker, name, income_jpy
    """
    today = datetime.today()
    rows = []

    for _, holding in df_holdings.iterrows():
        ticker = holding["ticker"]
        name = holding.get("name", ticker)
        shares = holding["shares"]
        currency = "JPY" if ticker.endswith(".T") else "USD"

        try:
            t = yf.Ticker(ticker)
            dividends = t.dividends
        except Exception:
            continue

        if dividends.empty:
            continue

        # Last paid dividend amount per share
        last_div_amount = float(dividends.iloc[-1])
        payment_months = _infer_payment_months(dividends)
        if not payment_months:
            continue

        # Project next 12 months
        for offset in range(13):
            target = today + timedelta(days=30 * offset)
            if target.month in payment_months:
                ym = target.strftime("%Y-%m")
                income = last_div_amount * shares
                income_jpy = income * usd_jpy if currency == "USD" else income
                rows.append({
                    "year_month": ym,
                    "ticker": ticker,
                    "name": name,
                    "income_jpy": round(income_jpy, 0),
                })

    if not rows:
        return pd.DataFrame(columns=["year_month", "ticker", "name", "income_jpy"])

    df = pd.DataFrame(rows).drop_duplicates(subset=["year_month", "ticker"])
    return df.sort_values(["year_month", "ticker"]).reset_index(drop=True)


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
