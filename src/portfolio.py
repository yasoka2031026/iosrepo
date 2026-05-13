"""
Portfolio manager: SQLite-backed CRUD for holdings.
Each holding: ticker, name, shares, purchase_price, purchase_date
"""
import sqlite3
import pandas as pd
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "portfolio.db"


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS holdings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker      TEXT    NOT NULL,
            name        TEXT    NOT NULL DEFAULT '',
            shares      REAL    NOT NULL,
            buy_price   REAL    NOT NULL,
            added_at    TEXT    NOT NULL DEFAULT (date('now'))
        )
    """)
    con.commit()
    return con


def add_holding(ticker: str, name: str, shares: float, buy_price: float) -> None:
    with _conn() as con:
        con.execute(
            "INSERT INTO holdings (ticker, name, shares, buy_price) VALUES (?,?,?,?)",
            (ticker.upper(), name, shares, buy_price),
        )


def delete_holding(holding_id: int) -> None:
    with _conn() as con:
        con.execute("DELETE FROM holdings WHERE id = ?", (holding_id,))


def get_holdings() -> pd.DataFrame:
    with _conn() as con:
        df = pd.read_sql("SELECT * FROM holdings ORDER BY added_at DESC", con)
    return df


def clear_all() -> None:
    with _conn() as con:
        con.execute("DELETE FROM holdings")
