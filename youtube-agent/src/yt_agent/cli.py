"""Command-line entry point.

Examples:
    python -m yt_agent process --url https://www.youtube.com/watch?v=XXXXXXXXXXX
    python -m yt_agent process --channel UCxxxxxxxx --limit 5
    python -m yt_agent process --query "claude code tips" --limit 5
    python -m yt_agent batch --file config/watchlist.example.json

All examples above default to LLM_PROVIDER=mock / YOUTUBE_MODE=mock unless
those environment variables (or --provider / --youtube-mode) say otherwise,
so the CLI is safe to try without any API keys configured.
"""

from __future__ import annotations

import argparse
import json
import sys

from .config import AppConfig
from .llm_client import build_llm_client
from .models import ProcessResult
from .pipeline import Pipeline
from .youtube_client import MockYouTubeClient, RealYouTubeClient, YouTubeClient


def build_youtube_client(config: AppConfig) -> YouTubeClient:
    if config.youtube_mode == "api":
        return RealYouTubeClient(api_key=config.youtube_api_key or "")
    return MockYouTubeClient()  # empty mock: CLI mock mode is for wiring smoke tests only


def _print_result(result: ProcessResult) -> None:
    line = f"[{result.status.value.upper()}] {result.video_id or '?'}"
    if result.video:
        line += f" - {result.video.title}"
    if result.note_path:
        line += f" -> {result.note_path}"
    if result.error:
        line += f" ({result.error})"
    print(line)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="yt_agent", description="YouTube -> Obsidian information-gathering agent")
    parser.add_argument("--provider", choices=["claude", "codex", "mock"], help="Override LLM_PROVIDER")
    parser.add_argument("--youtube-mode", choices=["api", "mock"], help="Override YOUTUBE_MODE")
    sub = parser.add_subparsers(dest="command", required=True)

    p_process = sub.add_parser("process", help="Process a single video, channel, or search query")
    group = p_process.add_mutually_exclusive_group(required=True)
    group.add_argument("--url", help="A YouTube video URL or ID")
    group.add_argument("--channel", help="A YouTube channel ID")
    group.add_argument("--query", help="A YouTube search query")
    p_process.add_argument("--limit", type=int, default=5)

    p_batch = sub.add_parser("batch", help="Process a JSON watchlist file")
    p_batch.add_argument("--file", required=True)

    args = parser.parse_args(argv)

    config = AppConfig.from_env()
    if args.provider:
        config.llm_provider = args.provider
    if args.youtube_mode:
        config.youtube_mode = args.youtube_mode

    llm_client = build_llm_client(config.llm_provider, config)
    youtube_client = build_youtube_client(config)
    pipeline = Pipeline(youtube_client, llm_client, config.obsidian_vault_path)

    if args.command == "process":
        if args.url:
            _print_result(pipeline.process_url(args.url))
        elif args.channel:
            for result in pipeline.process_channel(args.channel, limit=args.limit):
                _print_result(result)
        elif args.query:
            for result in pipeline.process_query(args.query, limit=args.limit):
                _print_result(result)
    elif args.command == "batch":
        with open(args.file, encoding="utf-8") as f:
            entries = json.load(f)
        for result in pipeline.process_batch(entries):
            _print_result(result)

    return 0


if __name__ == "__main__":
    sys.exit(main())
