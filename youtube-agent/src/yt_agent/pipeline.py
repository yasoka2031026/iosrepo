"""Orchestrates fetch -> summarize -> write-to-Obsidian for one or many videos.

The core design rule: **a single bad video must never crash a batch run**.
Every expected failure mode (private video, no captions, quota exceeded,
LLM outage, malformed LLM output, ...) is caught here and converted into a
``ProcessResult`` with a status and an error message. Only a genuinely
unexpected bug should raise past this module — and even then, batch
methods keep going and report per-item results.
"""

from __future__ import annotations

import logging
from pathlib import Path

from .errors import LLMError, QuotaExceededError, TranscriptUnavailableError, VideoUnavailableError
from .llm_client import LLMClient
from .models import ProcessResult, ProcessStatus
from .note_writer import update_moc, write_note
from .youtube_client import YouTubeClient, extract_video_id

logger = logging.getLogger("yt_agent.pipeline")


class Pipeline:
    def __init__(self, youtube_client: YouTubeClient, llm_client: LLMClient, vault_path: Path):
        self.youtube_client = youtube_client
        self.llm_client = llm_client
        self.vault_path = Path(vault_path)

    def process_video_id(self, video_id: str) -> ProcessResult:
        try:
            video = self.youtube_client.get_video_metadata(video_id)
        except VideoUnavailableError as exc:
            return ProcessResult(status=ProcessStatus.FAILED, video_id=video_id, error=str(exc))
        except QuotaExceededError as exc:
            return ProcessResult(status=ProcessStatus.FAILED, video_id=video_id, error=f"quota exceeded: {exc}")

        try:
            transcript = self.youtube_client.get_transcript(video_id)
        except TranscriptUnavailableError as exc:
            return ProcessResult(
                status=ProcessStatus.SKIPPED, video_id=video_id, video=video,
                error=f"no transcript available: {exc}",
            )

        if video.is_live:
            return ProcessResult(
                status=ProcessStatus.SKIPPED, video_id=video_id, video=video,
                error="video is an ongoing live stream; retry once it has ended",
            )

        try:
            note = self.llm_client.summarize(video, transcript.full_text)
        except LLMError as exc:
            return ProcessResult(
                status=ProcessStatus.FAILED, video_id=video_id, video=video,
                error=f"LLM summarization failed: {exc}",
            )

        status = ProcessStatus.PARTIAL if note.parse_error else ProcessStatus.SUCCESS

        try:
            note_path = write_note(self.vault_path, video, note, self.llm_client.provider_name, status.value)
        except OSError as exc:
            return ProcessResult(
                status=ProcessStatus.FAILED, video_id=video_id, video=video, note=note,
                error=f"failed to write Obsidian note: {exc}",
            )

        return ProcessResult(
            status=status, video_id=video_id, video=video, note=note, note_path=str(note_path),
        )

    def process_url(self, url: str) -> ProcessResult:
        try:
            video_id = extract_video_id(url)
        except VideoUnavailableError as exc:
            return ProcessResult(status=ProcessStatus.FAILED, error=str(exc))
        result = self.process_video_id(video_id)
        self._update_moc([result])
        return result

    def process_query(self, query: str, limit: int = 5) -> list[ProcessResult]:
        try:
            video_ids = self.youtube_client.search_videos(query, limit=limit)
        except QuotaExceededError as exc:
            return [ProcessResult(status=ProcessStatus.FAILED, error=f"quota exceeded: {exc}")]
        results = [self.process_video_id(vid) for vid in video_ids]
        self._update_moc(results)
        return results

    def process_channel(self, channel_id: str, limit: int = 5) -> list[ProcessResult]:
        try:
            video_ids = self.youtube_client.get_channel_recent_videos(channel_id, limit=limit)
        except QuotaExceededError as exc:
            return [ProcessResult(status=ProcessStatus.FAILED, error=f"quota exceeded: {exc}")]
        results = [self.process_video_id(vid) for vid in video_ids]
        self._update_moc(results)
        return results

    def process_batch(self, entries: list[dict]) -> list[ProcessResult]:
        """``entries`` items look like {"type": "url"|"channel"|"query", "value": str, "limit": int}."""
        results: list[ProcessResult] = []
        for entry in entries:
            entry_type = entry.get("type")
            value = entry.get("value", "")
            limit = entry.get("limit", 5)
            try:
                if entry_type == "url":
                    results.append(self.process_url(value))
                elif entry_type == "channel":
                    results.extend(self.process_channel(value, limit=limit))
                elif entry_type == "query":
                    results.extend(self.process_query(value, limit=limit))
                else:
                    results.append(
                        ProcessResult(status=ProcessStatus.FAILED, error=f"unknown watchlist entry type: {entry_type!r}")
                    )
            except Exception as exc:  # noqa: BLE001 - batch must survive any single bad entry
                logger.exception("Unexpected error processing watchlist entry %r", entry)
                results.append(ProcessResult(status=ProcessStatus.FAILED, error=f"unexpected error: {exc}"))
        self._update_moc(results)
        return results

    def _update_moc(self, results: list[ProcessResult]) -> None:
        try:
            update_moc(self.vault_path, results)
        except OSError:
            logger.exception("Failed to update MOC index note")
