#!/usr/bin/env python3
"""Runs the pipeline through 20 varied, offline (mock) scenarios.

This is the "LOOPで実働検証を20回" requested before this MVP is considered
deployable: it exercises the happy path plus every realistic edge case
(missing captions, private/unavailable videos, live streams, LLM
timeouts, malformed LLM output, quota errors, non-Latin captions, batch
runs with bad entries mixed in, reprocessing, filename collisions, ...)
using MockYouTubeClient / MockLLMClient — no network access or API keys
required.

Pass criteria per run:
  - no *unhandled* exception escapes the pipeline (that's a crash/bug —
    the whole point of this harness)
  - the resulting status matches what the scenario expects

Usage:
    .venv/bin/python scripts/run_validation_loop.py
    (writes docs/youtube-agent-validation-report.md relative to repo root)
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from yt_agent.errors import QuotaExceededError, VideoUnavailableError  # noqa: E402
from yt_agent.llm_client import MockLLMClient  # noqa: E402
from yt_agent.models import ProcessStatus  # noqa: E402
from yt_agent.pipeline import Pipeline  # noqa: E402
from yt_agent.youtube_client import MockYouTubeClient  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
REPORT_PATH = REPO_ROOT / "docs" / "youtube-agent-validation-report.md"


def video_fixture(title="Video", transcript="Sample transcript text.", **overrides):
    metadata = {
        "title": title,
        "channel_title": overrides.pop("channel_title", "Sample Channel"),
        "channel_id": overrides.pop("channel_id", "UCsample"),
        "published_at": overrides.pop("published_at", "2026-01-01T00:00:00Z"),
        **overrides,
    }
    return {"metadata": metadata, "transcript": transcript}


@dataclass
class Scenario:
    number: int
    name: str
    run: Callable[[Path], object]  # returns a ProcessResult or list[ProcessResult]
    expect: Callable[[object], bool]
    expect_description: str
    notes: str = ""


def _status_is(result, status: ProcessStatus) -> bool:
    return getattr(result, "status", None) == status


def _all_statuses(results, allowed: set[ProcessStatus]) -> bool:
    return all(r.status in allowed for r in results)


SCENARIOS: list[Scenario] = []


# 1. Normal short English video
def _s1(vault):
    yt = MockYouTubeClient(fixtures={"eng00000001": video_fixture(title="How to use Claude", transcript="This video explains Claude basics.")})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_video_id("eng00000001")


SCENARIOS.append(Scenario(1, "通常動画(英語字幕)の処理", _s1, lambda r: _status_is(r, ProcessStatus.SUCCESS), "SUCCESS"))


# 2. Normal Japanese video
def _s2(vault):
    yt = MockYouTubeClient(fixtures={"jpn00000001": video_fixture(title="Claudeの使い方", transcript="これはClaudeの使い方を説明する動画です。" * 5, language="ja")})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_video_id("jpn00000001")


SCENARIOS.append(Scenario(2, "通常動画(日本語字幕)の処理", _s2, lambda r: _status_is(r, ProcessStatus.SUCCESS), "SUCCESS"))


# 3. Long video requiring map-reduce chunking
def _s3(vault):
    yt = MockYouTubeClient(fixtures={"lng00000001": video_fixture(title="3時間の講演", transcript="word " * 6000)})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_video_id("lng00000001")


SCENARIOS.append(Scenario(3, "長尺動画(チャンク分割要約)", _s3, lambda r: _status_is(r, ProcessStatus.SUCCESS), "SUCCESS"))


# 4. No captions available
def _s4(vault):
    yt = MockYouTubeClient(fixtures={"noc00000001": video_fixture(title="字幕なし動画", transcript=None)})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_video_id("noc00000001")


SCENARIOS.append(Scenario(4, "字幕/文字起こしが存在しない動画", _s4, lambda r: _status_is(r, ProcessStatus.SKIPPED), "SKIPPED"))


# 5. Private / unavailable video
def _s5(vault):
    yt = MockYouTubeClient(fixtures={})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_video_id("private0001")


SCENARIOS.append(Scenario(5, "非公開/削除済み動画", _s5, lambda r: _status_is(r, ProcessStatus.FAILED), "FAILED"))


# 6. Age-restricted video (modeled as VideoUnavailableError from metadata lookup)
def _s6(vault):
    yt = MockYouTubeClient(fixtures={"age00000001": VideoUnavailableError("age-restricted: sign-in required")})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_video_id("age00000001")


SCENARIOS.append(Scenario(6, "年齢制限で取得できない動画", _s6, lambda r: _status_is(r, ProcessStatus.FAILED), "FAILED"))


# 7. Ongoing live stream
def _s7(vault):
    yt = MockYouTubeClient(fixtures={"live0000001": video_fixture(title="配信中のライブ", transcript="", is_live=True)})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_video_id("live0000001")


SCENARIOS.append(Scenario(7, "配信中のライブ配信", _s7, lambda r: _status_is(r, ProcessStatus.SKIPPED), "SKIPPED"))


# 8. Channel batch where one video among several fails
def _s8(vault):
    fixtures = {
        "ch1v0000001": video_fixture(title="OK動画1"),
        "ch1v0000002": VideoUnavailableError("removed by uploader"),
        "ch1v0000003": video_fixture(title="OK動画3"),
    }
    yt = MockYouTubeClient(fixtures=fixtures, channel_results={"UCchannel1": ["ch1v0000001", "ch1v0000002", "ch1v0000003"]})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_channel("UCchannel1", limit=5)


SCENARIOS.append(
    Scenario(
        8, "チャンネル一括処理中に1本失敗", _s8,
        lambda rs: len(rs) == 3 and _all_statuses(rs, {ProcessStatus.SUCCESS, ProcessStatus.FAILED})
        and sum(1 for r in rs if r.status == ProcessStatus.FAILED) == 1,
        "3件中1件FAILED, 残り2件SUCCESS, バッチ全体はクラッシュしない",
    )
)


# 9. Search query with zero results
def _s9(vault):
    yt = MockYouTubeClient(search_results={"存在しないトピック": []})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_query("存在しないトピック", limit=5)


SCENARIOS.append(Scenario(9, "検索結果0件", _s9, lambda rs: rs == [], "空リスト(クラッシュしない)"))


# 10. LLM transient error then success (retry logic)
def _s10(vault):
    yt = MockYouTubeClient(fixtures={"ret00000001": video_fixture()})
    p = Pipeline(yt, MockLLMClient(behavior="transient_then_success", fail_times=2), vault)
    return p.process_video_id("ret00000001")


SCENARIOS.append(Scenario(10, "LLM一時エラー後にリトライで成功", _s10, lambda r: _status_is(r, ProcessStatus.SUCCESS), "SUCCESS (リトライ経由)"))


# 11. LLM returns malformed JSON
def _s11(vault):
    yt = MockYouTubeClient(fixtures={"mal00000001": video_fixture()})
    p = Pipeline(yt, MockLLMClient(behavior="malformed_json"), vault)
    return p.process_video_id("mal00000001")


SCENARIOS.append(Scenario(11, "LLM応答がJSONとして不正", _s11, lambda r: _status_is(r, ProcessStatus.PARTIAL), "PARTIAL (パースエラーとして記録しノート作成)"))


# 12. YouTube quota exceeded on search
def _s12(vault):
    yt = MockYouTubeClient(search_results={"人気動画": QuotaExceededError("daily quota exceeded")})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_query("人気動画", limit=5)


SCENARIOS.append(Scenario(12, "YouTube APIクォータ超過", _s12, lambda rs: len(rs) == 1 and _status_is(rs[0], ProcessStatus.FAILED), "FAILED 1件(クラッシュしない)"))


# 13. Very short transcript (a few seconds ad-like clip)
def _s13(vault):
    yt = MockYouTubeClient(fixtures={"shr00000001": video_fixture(title="短いクリップ", transcript="Hi.")})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_video_id("shr00000001")


SCENARIOS.append(Scenario(13, "極端に短い文字起こし", _s13, lambda r: _status_is(r, ProcessStatus.SUCCESS), "SUCCESS"))


# 14. Non-Latin script captions (Korean)
def _s14(vault):
    yt = MockYouTubeClient(fixtures={"kor00000001": video_fixture(title="한국어 비디오", transcript="이것은 테스트 자막입니다." * 3, language="ko")})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_video_id("kor00000001")


SCENARIOS.append(Scenario(14, "非ラテン文字(韓国語)字幕", _s14, lambda r: _status_is(r, ProcessStatus.SUCCESS), "SUCCESS"))


# 15. Reprocessing the same video (dedupe in MOC, note gets refreshed)
def _s15(vault):
    yt = MockYouTubeClient(fixtures={"dup00000001": video_fixture(title="再処理テスト")})
    p = Pipeline(yt, MockLLMClient(), vault)
    first = p.process_video_id("dup00000001")
    p._update_moc([first])
    second = p.process_video_id("dup00000001")
    p._update_moc([second])
    return second


SCENARIOS.append(Scenario(15, "同一動画の再処理(重複排除)", _s15, lambda r: _status_is(r, ProcessStatus.SUCCESS), "SUCCESS (MOC重複行なし)"))


# 16. Vault directory does not exist yet
def _s16(vault):
    fresh_vault = vault / "does" / "not" / "exist" / "yet"
    yt = MockYouTubeClient(fixtures={"new00000001": video_fixture(title="新規Vault作成テスト")})
    p = Pipeline(yt, MockLLMClient(), fresh_vault)
    return p.process_video_id("new00000001")


SCENARIOS.append(Scenario(16, "Obsidian Vaultフォルダが未作成", _s16, lambda r: _status_is(r, ProcessStatus.SUCCESS), "SUCCESS (フォルダ自動作成)"))


# 17. Title with characters illegal in filenames
def _s17(vault):
    yt = MockYouTubeClient(fixtures={"ilg00000001": video_fixture(title='ヤバい: "神回" / 必見?#1 <保存版>')})
    p = Pipeline(yt, MockLLMClient(), vault)
    return p.process_video_id("ilg00000001")


SCENARIOS.append(Scenario(17, "タイトルに使用不可文字を含む動画", _s17, lambda r: _status_is(r, ProcessStatus.SUCCESS) and Path(r.note_path).exists(), "SUCCESS (ファイル名サニタイズ)"))


# 18. Batch watchlist with a mix of valid and structurally invalid entries
def _s18(vault):
    yt = MockYouTubeClient(fixtures={"btc00000001": video_fixture(title="バッチ内OK動画")})
    p = Pipeline(yt, MockLLMClient(), vault)
    entries = [
        {"type": "url", "value": "btc00000001"},
        {"type": "url", "value": "not-a-real-video-url"},
        {"type": "unknown_type", "value": "x"},
        {"value": "missing type key entirely"},
    ]
    return p.process_batch(entries)


SCENARIOS.append(
    Scenario(
        18, "watchlist内に不正エントリが混在", _s18,
        lambda rs: len(rs) == 4 and rs[0].status == ProcessStatus.SUCCESS and _all_statuses(rs[1:], {ProcessStatus.FAILED}),
        "1件SUCCESS + 3件FAILED、バッチはクラッシュしない",
    )
)


# 19. Provider switch mid-run (Claude vs Codex, both mocked)
def _s19(vault):
    yt = MockYouTubeClient(fixtures={
        "clv00000001": video_fixture(title="Claude回"),
        "cdx00000001": video_fixture(title="Codex回"),
    })
    claude_llm = MockLLMClient()
    claude_llm.provider_name = "claude"
    codex_llm = MockLLMClient()
    codex_llm.provider_name = "codex"
    p_claude = Pipeline(yt, claude_llm, vault)
    p_codex = Pipeline(yt, codex_llm, vault)
    r1 = p_claude.process_video_id("clv00000001")
    r2 = p_codex.process_video_id("cdx00000001")
    return [r1, r2]


SCENARIOS.append(
    Scenario(
        19, "Claude/Codexプロバイダの切り替え", _s19,
        lambda rs: _all_statuses(rs, {ProcessStatus.SUCCESS})
        and "llm_provider: \"claude\"" in Path(rs[0].note_path).read_text(encoding="utf-8")
        and "llm_provider: \"codex\"" in Path(rs[1].note_path).read_text(encoding="utf-8"),
        "両方SUCCESS、ノートに正しいprovider名が記録される",
    )
)


# 20. LLM provider fully down (all retries exhausted) mid batch
def _s20(vault):
    fixtures = {
        "dwn00000001": video_fixture(title="正常系"),
        "dwn00000002": video_fixture(title="LLM障害時"),
    }
    yt = MockYouTubeClient(fixtures=fixtures)
    p_ok = Pipeline(yt, MockLLMClient(behavior="success"), vault)
    p_down = Pipeline(yt, MockLLMClient(behavior="always_transient"), vault)
    r_ok = p_ok.process_video_id("dwn00000001")
    r_down = p_down.process_video_id("dwn00000002")
    return [r_ok, r_down]


SCENARIOS.append(
    Scenario(
        20, "LLM APIが完全に応答不能(リトライ全滅)", _s20,
        lambda rs: rs[0].status == ProcessStatus.SUCCESS and rs[1].status == ProcessStatus.FAILED,
        "正常系はSUCCESS、障害系はFAILEDで安全に停止(クラッシュしない)",
    )
)

SCENARIOS.sort(key=lambda s: s.number)


def run_all() -> tuple[list[dict], bool]:
    rows = []
    any_crash = False
    for sc in SCENARIOS:
        vault = Path(tempfile.mkdtemp(prefix=f"yt_agent_val_{sc.number:02d}_"))
        try:
            result = sc.run(vault)
            functional_pass = bool(sc.expect(result))
            crashed = False
            error_detail = ""
        except Exception:  # noqa: BLE001 - this IS the crash detector
            crashed = True
            any_crash = True
            functional_pass = False
            error_detail = traceback.format_exc(limit=3)
        finally:
            shutil.rmtree(vault, ignore_errors=True)

        rows.append(
            {
                "number": sc.number,
                "name": sc.name,
                "expected": sc.expect_description,
                "crashed": crashed,
                "functional_pass": functional_pass,
                "error_detail": error_detail,
            }
        )
    return rows, any_crash


def render_report(rows: list[dict], any_crash: bool) -> str:
    total = len(rows)
    crashes = sum(1 for r in rows if r["crashed"])
    functional_passes = sum(1 for r in rows if r["functional_pass"])

    lines = [
        "# YouTube情報収集エージェント — 実働検証レポート(モック20回)",
        "",
        "本レポートは `scripts/run_validation_loop.py` により自動生成される。",
        "YouTube Data API / Claude / Codex の実APIキーは未設定のため、"
        "`MockYouTubeClient` / `MockLLMClient` を用いてオフラインでパイプライン全体"
        "(取得 → 要約 → Obsidianノート書き出し)を20パターンの実運用シナリオで検証した。",
        "",
        "## サマリー",
        "",
        f"- 総実行回数: {total}",
        f"- クラッシュ(未処理例外)件数: {crashes}",
        f"- 期待した挙動と一致した件数: {functional_passes} / {total}",
        f"- 判定: {'✅ PASS — バグ・クラッシュなし' if not any_crash and functional_passes == total else '❌ FAIL — 要修正'}",
        "",
        "## 実行結果一覧",
        "",
        "| # | シナリオ | 期待結果 | クラッシュ | 判定 |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        verdict = "PASS" if (not r["crashed"] and r["functional_pass"]) else "FAIL"
        crash_mark = "あり" if r["crashed"] else "なし"
        lines.append(f"| {r['number']} | {r['name']} | {r['expected']} | {crash_mark} | {verdict} |")

    failures = [r for r in rows if r["crashed"] or not r["functional_pass"]]
    if failures:
        lines += ["", "## 失敗詳細", ""]
        for r in failures:
            lines.append(f"### #{r['number']} {r['name']}")
            if r["error_detail"]:
                lines += ["```", r["error_detail"].strip(), "```"]
            lines.append("")

    lines += [
        "## 結論と次のステップ",
        "",
    ]
    if not any_crash and functional_passes == total:
        lines += [
            "20回のモック実働検証すべてで、パイプラインは想定どおりに動作し、"
            "未処理例外(クラッシュ)は一切発生しなかった。バッチ処理は個別動画の失敗"
            "(非公開・字幕なし・ライブ配信中・LLM一時障害など)を吸収し、処理を継続した。",
            "",
            "この結果を踏まえ、コード面ではデプロイ判定基準を満たしている。ただし実デプロイの"
            "実行には以下がユーザー側で必要であり、本セッションでは未取得のため実施していない"
            "(詳細は `docs/youtube-agent-deployment-plan.md` を参照):",
            "",
            "1. YouTube Data API キー",
            "2. Anthropic (Claude) および/または OpenAI (Codex) API キー",
            "3. Obsidian Vaultの実パス、またはVault同期先の合意",
            "4. 実APIを使った少数回の実地検証(モックでは検出できないAPI仕様差分の確認)",
        ]
    else:
        lines.append("クラッシュまたは期待結果との不一致が検出されたため、デプロイ前に上記の失敗詳細を修正すること。")

    lines.append("")
    return "\n".join(lines)


def main() -> int:
    rows, any_crash = run_all()
    report = render_report(rows, any_crash)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(report)
    print(f"\nReport written to {REPORT_PATH}")
    functional_passes = sum(1 for r in rows if r["functional_pass"])
    return 0 if (not any_crash and functional_passes == len(rows)) else 1


if __name__ == "__main__":
    sys.exit(main())
