"""
不労所得ダッシュボード
毎月 ¥60,000 の配当・分配金収入を目指すためのポートフォリオ管理 & 高配当株スクリーナー
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

import streamlit as st
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px

from portfolio import add_holding, delete_holding, get_holdings, clear_all
from screener import enrich_portfolio, screen_high_dividend, get_usd_jpy, build_dividend_calendar

GOAL_MONTHLY_JPY = 60_000
_FALLBACK_USD_JPY = 155.0

st.set_page_config(
    page_title="不労所得ダッシュボード",
    page_icon="💴",
    layout="wide",
)

# ── CSS ──────────────────────────────────────────────────────────────────────
st.markdown("""
<style>
.metric-card {
    background: #1e1e2e;
    border-radius: 12px;
    padding: 1.2rem 1.5rem;
    margin-bottom: 0.5rem;
}
.goal-bar-label { font-size: 0.85rem; color: #aaa; margin-bottom: 4px; }
</style>
""", unsafe_allow_html=True)

# ── USD/JPY 為替レート（キャッシュ付き自動取得）────────────────────────────
@st.cache_data(ttl=3600, show_spinner=False)
def _fetch_rate() -> tuple[float, str]:
    return get_usd_jpy()


# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("💴 不労所得ダッシュボード")
    st.caption("毎月 ¥60,000 の配当収入を目指す")
    st.divider()
    page = st.radio(
        "ページ",
        ["📊 ポートフォリオ", "🔍 高配当株スクリーナー", "📅 配当カレンダー"],
        label_visibility="collapsed",
    )
    st.divider()
    st.caption(f"目標: ¥{GOAL_MONTHLY_JPY:,} / 月")

    # 為替レート自動取得
    auto_rate, rate_ts = _fetch_rate()
    st.caption(f"USD/JPY 自動取得: {auto_rate:.2f}  ({rate_ts})")
    if st.button("為替レートを今すぐ更新", use_container_width=True):
        st.cache_data.clear()
        st.rerun()
    usd_jpy = st.number_input(
        "手動で上書き（空欄なら自動値を使用）",
        min_value=50.0, max_value=300.0,
        value=float(auto_rate), step=0.5,
        key="usd_jpy_input",
    )


USD_JPY = usd_jpy


# ─────────────────────────────────────────────────────────────────────────────
# Helper: monthly income in JPY for enriched portfolio
# ─────────────────────────────────────────────────────────────────────────────
def monthly_jpy(row: pd.Series) -> float:
    if row["currency"] == "USD":
        return row["monthly_income"] * USD_JPY
    return row["monthly_income"]


# ─────────────────────────────────────────────────────────────────────────────
# PAGE 1: ポートフォリオ
# ─────────────────────────────────────────────────────────────────────────────
if page == "📊 ポートフォリオ":
    st.header("📊 ポートフォリオ管理")

    # ── 銘柄追加フォーム ──────────────────────────────────────────────────────
    with st.expander("＋ 銘柄を追加する", expanded=False):
        col1, col2, col3, col4, col5 = st.columns([2, 2, 1.5, 1.5, 1])
        with col1:
            ticker_input = st.text_input("ティッカー (例: 8316.T / KO)", key="add_ticker")
        with col2:
            name_input = st.text_input("銘柄名", key="add_name")
        with col3:
            shares_input = st.number_input("保有株数", min_value=0.1, value=100.0, step=1.0, key="add_shares")
        with col4:
            price_input = st.number_input("取得単価", min_value=0.01, value=1000.0, step=1.0, key="add_price")
        with col5:
            st.write("")
            st.write("")
            if st.button("追加", use_container_width=True):
                if ticker_input.strip():
                    add_holding(
                        ticker_input.strip(),
                        name_input.strip() or ticker_input.strip(),
                        shares_input,
                        price_input,
                    )
                    st.success(f"{ticker_input.upper()} を追加しました")
                    st.rerun()
                else:
                    st.error("ティッカーを入力してください")

    # ── データ取得 ────────────────────────────────────────────────────────────
    holdings_raw = get_holdings()

    if holdings_raw.empty:
        st.info("まだ銘柄が登録されていません。上の「＋ 銘柄を追加する」から追加してください。")
        st.stop()

    with st.spinner("最新の株価・配当データを取得中..."):
        df = enrich_portfolio(holdings_raw)

    df["monthly_income_jpy"] = df.apply(monthly_jpy, axis=1)
    total_monthly_jpy = df["monthly_income_jpy"].sum()
    total_annual_jpy = total_monthly_jpy * 12
    goal_pct = min(total_monthly_jpy / GOAL_MONTHLY_JPY * 100, 100)

    # ── KPI カード ─────────────────────────────────────────────────────────
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("月間配当収入 (円換算)", f"¥{total_monthly_jpy:,.0f}",
              delta=f"目標まで ¥{max(GOAL_MONTHLY_JPY - total_monthly_jpy, 0):,.0f}")
    c2.metric("年間配当収入 (円換算)", f"¥{total_annual_jpy:,.0f}")
    c3.metric("保有銘柄数", f"{len(df)} 銘柄")
    c4.metric("目標達成率", f"{goal_pct:.1f}%")

    # ── 目標進捗バー ──────────────────────────────────────────────────────
    st.markdown(f"<div class='goal-bar-label'>月間 ¥{GOAL_MONTHLY_JPY:,} 達成率</div>", unsafe_allow_html=True)
    st.progress(int(goal_pct))

    # ── 目標達成シミュレーター ─────────────────────────────────────────────
    if total_monthly_jpy < GOAL_MONTHLY_JPY:
        shortfall = GOAL_MONTHLY_JPY - total_monthly_jpy
        avg_yield = df["dividend_yield_pct"].mean() or 3.5
        needed_investment_jpy = (shortfall * 12) / (avg_yield / 100)
        st.info(
            f"目標達成まで月 **¥{shortfall:,.0f}** 不足。"
            f"平均利回り {avg_yield:.1f}% で試算すると、"
            f"追加投資額 **¥{needed_investment_jpy:,.0f}** が必要です。"
        )

    st.divider()

    # ── チャート ──────────────────────────────────────────────────────────
    col_chart1, col_chart2 = st.columns(2)

    with col_chart1:
        st.subheader("月間配当収入の内訳")
        fig_pie = px.pie(
            df,
            names="name",
            values="monthly_income_jpy",
            hole=0.45,
            color_discrete_sequence=px.colors.sequential.Greens_r,
        )
        fig_pie.update_traces(textposition="inside", textinfo="percent+label")
        fig_pie.update_layout(margin=dict(t=10, b=10, l=10, r=10), showlegend=False)
        st.plotly_chart(fig_pie, use_container_width=True)

    with col_chart2:
        st.subheader("月次配当 vs 目標 ¥60,000")
        fig_bar = go.Figure()
        fig_bar.add_trace(go.Bar(
            x=df["name"],
            y=df["monthly_income_jpy"],
            marker_color="#2ecc71",
            name="月間配当(円)",
        ))
        fig_bar.add_hline(
            y=GOAL_MONTHLY_JPY,
            line_dash="dash",
            line_color="#e74c3c",
            annotation_text="目標 ¥60,000",
            annotation_position="top right",
        )
        fig_bar.update_layout(
            xaxis_title="",
            yaxis_title="円",
            margin=dict(t=10, b=10, l=10, r=10),
            showlegend=False,
        )
        st.plotly_chart(fig_bar, use_container_width=True)

    # ── 複利シミュレーション ───────────────────────────────────────────────
    st.subheader("複利シミュレーション：¥60,000/月達成までの道筋")
    sim_col1, sim_col2 = st.columns([1, 2])
    with sim_col1:
        monthly_add = st.number_input("毎月の追加投資額 (円)", value=50_000, step=5_000)
        sim_yield = st.number_input("想定年利回り (%)", value=4.0, step=0.1, min_value=0.5, max_value=20.0)
        sim_years = st.slider("シミュレーション年数", 1, 40, 20)

    with sim_col2:
        months = sim_years * 12
        r = sim_yield / 100 / 12
        balance = total_annual_jpy / (sim_yield / 100) if sim_yield else 0
        sim_records = []
        reached_month = None
        for m in range(1, months + 1):
            balance = balance * (1 + r) + monthly_add
            monthly_div = balance * r
            sim_records.append({"月": m, "資産残高": balance, "月間配当": monthly_div})
            if reached_month is None and monthly_div >= GOAL_MONTHLY_JPY:
                reached_month = m

        sim_df = pd.DataFrame(sim_records)
        fig_sim = go.Figure()
        fig_sim.add_trace(go.Scatter(
            x=sim_df["月"] / 12,
            y=sim_df["月間配当"],
            mode="lines",
            line=dict(color="#3498db", width=2),
            name="月間配当収入",
            fill="tozeroy",
            fillcolor="rgba(52,152,219,0.15)",
        ))
        fig_sim.add_hline(
            y=GOAL_MONTHLY_JPY,
            line_dash="dash",
            line_color="#e74c3c",
            annotation_text="目標 ¥60,000",
            annotation_position="top right",
        )
        fig_sim.update_layout(
            xaxis_title="経過年数",
            yaxis_title="月間配当収入 (円)",
            margin=dict(t=10, b=10),
        )
        st.plotly_chart(fig_sim, use_container_width=True)
        if reached_month:
            y, mo = divmod(reached_month, 12)
            st.success(f"目標 ¥{GOAL_MONTHLY_JPY:,}/月 達成まで約 **{y}年{mo}ヶ月**")
        else:
            st.warning(f"{sim_years}年間では目標未達。追加投資額か利回りを見直してください。")

    st.divider()

    # ── 保有銘柄テーブル ──────────────────────────────────────────────────
    st.subheader("保有銘柄一覧")
    display_cols = {
        "id": "ID",
        "ticker": "ティッカー",
        "name": "銘柄名",
        "shares": "保有株数",
        "buy_price": "取得単価",
        "current_price": "現在値",
        "gain_loss_pct": "損益率(%)",
        "dividend_yield_pct": "配当利回り(%)",
        "monthly_income_jpy": "月間配当(円)",
    }
    show_df = df[[c for c in display_cols if c in df.columns]].rename(columns=display_cols)
    st.dataframe(show_df, use_container_width=True, hide_index=True)

    with st.expander("銘柄を削除する"):
        del_id = st.number_input("削除するID", min_value=1, step=1, key="del_id")
        if st.button("削除実行", type="primary"):
            delete_holding(int(del_id))
            st.success(f"ID {del_id} を削除しました")
            st.rerun()
        if st.button("全件削除", type="secondary"):
            clear_all()
            st.warning("全件削除しました")
            st.rerun()


# ─────────────────────────────────────────────────────────────────────────────
# PAGE 2: 高配当株スクリーナー
# ─────────────────────────────────────────────────────────────────────────────
elif page == "🔍 高配当株スクリーナー":
    st.header("🔍 高配当株スクリーナー")
    st.caption("配当利回りの高い銘柄を検索し、ポートフォリオへ追加できます")

    sc1, sc2, sc3 = st.columns(3)
    with sc1:
        market = st.selectbox("市場", ["JP (東証)", "US (米国)"])
    with sc2:
        min_yield = st.number_input("最低配当利回り (%)", min_value=0.5, max_value=20.0, value=3.0, step=0.5)
    with sc3:
        st.write("")
        st.write("")
        run_screen = st.button("スクリーニング実行", use_container_width=True, type="primary")

    if run_screen:
        mkt_code = "JP" if "JP" in market else "US"
        with st.spinner("データを取得中...（10〜30秒かかる場合があります）"):
            result = screen_high_dividend(market=mkt_code, min_yield=min_yield)

        if result.empty:
            st.warning(f"利回り {min_yield}% 以上の銘柄が見つかりませんでした。条件を緩めてください。")
        else:
            st.success(f"{len(result)} 銘柄が見つかりました")

            # Gauge-style bar chart
            fig = px.bar(
                result,
                x="name",
                y="dividend_yield_pct",
                color="dividend_yield_pct",
                color_continuous_scale="Greens",
                labels={"dividend_yield_pct": "配当利回り(%)", "name": ""},
                title="高配当銘柄ランキング",
            )
            fig.add_hline(y=3.5, line_dash="dot", line_color="orange",
                          annotation_text="3.5% ライン")
            fig.update_layout(coloraxis_showscale=False, margin=dict(t=40, b=10))
            st.plotly_chart(fig, use_container_width=True)

            # Table with quick-add
            st.subheader("スクリーニング結果")
            show_cols = {
                "ticker": "ティッカー",
                "name": "銘柄名",
                "price": "現在値",
                "currency": "通貨",
                "dividend_yield_pct": "配当利回り(%)",
                "annual_dividend": "年間配当(1株)",
                "sector": "セクター",
            }
            st.dataframe(
                result[[c for c in show_cols if c in result.columns]].rename(columns=show_cols),
                use_container_width=True,
                hide_index=True,
            )

            st.divider()
            st.subheader("ポートフォリオへ追加")
            qa1, qa2, qa3, qa4 = st.columns([2, 1.5, 1.5, 1])
            with qa1:
                sel_ticker = st.selectbox("銘柄を選択", result["ticker"].tolist(),
                                          format_func=lambda t: f"{t} ({result.loc[result['ticker']==t,'name'].values[0]})")
            with qa2:
                qa_shares = st.number_input("保有株数", min_value=0.1, value=100.0, step=1.0, key="qa_shares")
            with qa3:
                sel_price = float(result.loc[result["ticker"] == sel_ticker, "price"].values[0])
                qa_price = st.number_input("取得単価", min_value=0.01, value=sel_price, step=1.0, key="qa_price")
            with qa4:
                st.write("")
                st.write("")
                if st.button("追加", use_container_width=True, key="qa_add"):
                    sel_name = result.loc[result["ticker"] == sel_ticker, "name"].values[0]
                    add_holding(sel_ticker, sel_name, qa_shares, qa_price)
                    st.success(f"{sel_ticker} をポートフォリオに追加しました")
    else:
        st.info("条件を設定して「スクリーニング実行」ボタンを押してください。")


# ─────────────────────────────────────────────────────────────────────────────
# PAGE 3: 配当カレンダー
# ─────────────────────────────────────────────────────────────────────────────
elif page == "📅 配当カレンダー":
    st.header("📅 配当カレンダー")
    st.caption("保有銘柄の過去実績から今後12ヶ月の配当入金予定を予測します")

    holdings_raw = get_holdings()
    if holdings_raw.empty:
        st.info("ポートフォリオに銘柄が登録されていません。「📊 ポートフォリオ」から追加してください。")
        st.stop()

    with st.spinner("配当履歴を取得して入金スケジュールを組み立て中..."):
        cal_df = build_dividend_calendar(holdings_raw, usd_jpy=USD_JPY)

    if cal_df.empty:
        st.warning("配当履歴データを取得できませんでした。銘柄によっては yfinance が未対応の場合があります。")
        st.stop()

    # ── 月別合計サマリー ──────────────────────────────────────────────────
    monthly_totals = (
        cal_df.groupby("year_month")["income_jpy"]
        .sum()
        .reset_index()
        .rename(columns={"year_month": "月", "income_jpy": "合計配当収入(円)"})
    )

    st.subheader("月別予想配当収入")
    fig_monthly = go.Figure()
    fig_monthly.add_trace(go.Bar(
        x=monthly_totals["月"],
        y=monthly_totals["合計配当収入(円)"],
        marker_color=[
            "#2ecc71" if v >= GOAL_MONTHLY_JPY else "#3498db"
            for v in monthly_totals["合計配当収入(円)"]
        ],
        text=[f"¥{v:,.0f}" for v in monthly_totals["合計配当収入(円)"]],
        textposition="outside",
    ))
    fig_monthly.add_hline(
        y=GOAL_MONTHLY_JPY,
        line_dash="dash",
        line_color="#e74c3c",
        annotation_text="月次目標 ¥60,000",
        annotation_position="top right",
    )
    fig_monthly.update_layout(
        xaxis_title="",
        yaxis_title="配当収入 (円)",
        margin=dict(t=30, b=10),
        xaxis=dict(tickangle=-30),
    )
    st.plotly_chart(fig_monthly, use_container_width=True)

    # ── ヒートマップ（銘柄 × 月） ─────────────────────────────────────────
    st.subheader("銘柄別・月別配当ヒートマップ")

    pivot = cal_df.pivot_table(
        index="name",
        columns="year_month",
        values="income_jpy",
        aggfunc="sum",
        fill_value=0,
    )

    # 列を時系列順にソート
    pivot = pivot[sorted(pivot.columns)]

    fig_heat = go.Figure(go.Heatmap(
        z=pivot.values,
        x=pivot.columns.tolist(),
        y=pivot.index.tolist(),
        colorscale="Greens",
        text=[[f"¥{v:,.0f}" if v > 0 else "" for v in row] for row in pivot.values],
        texttemplate="%{text}",
        hovertemplate="銘柄: %{y}<br>月: %{x}<br>配当: ¥%{z:,.0f}<extra></extra>",
        colorbar=dict(title="円"),
    ))
    fig_heat.update_layout(
        xaxis_title="",
        yaxis_title="",
        margin=dict(t=10, b=10),
        xaxis=dict(tickangle=-30),
        height=max(300, 60 * len(pivot)),
    )
    st.plotly_chart(fig_heat, use_container_width=True)

    # ── 直近の入金予定リスト ───────────────────────────────────────────────
    st.subheader("入金予定一覧")
    import datetime as dt
    current_ym = dt.datetime.today().strftime("%Y-%m")
    upcoming = cal_df[cal_df["year_month"] >= current_ym].copy()
    upcoming = upcoming.rename(columns={
        "year_month": "入金予定月",
        "ticker": "ティッカー",
        "name": "銘柄名",
        "income_jpy": "予想配当収入(円)",
    })
    st.dataframe(upcoming, use_container_width=True, hide_index=True)

    st.info(
        "予測は過去の配当実績の支払い月パターンと直近の配当額から算出しています。"
        "実際の入金日・金額は企業の発表により変わります。"
    )
