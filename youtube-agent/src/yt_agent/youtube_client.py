"""YouTube data access: video metadata, transcripts, search, channel listing.

``RealYouTubeClient`` talks to the actual YouTube Data API + caption
tracks and only imports its third-party SDKs when instantiated, so the
mock-only test suite and validation loop never need them installed.

``MockYouTubeClient`` replays canned scenarios (fixtures) so the whole
pipeline can be exercised offline, deterministically, and repeatedly —
this is what ``scripts/run_validation_loop.py`` uses for its 20 runs.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from typing import Optional

from .errors import QuotaExceededError, TranscriptUnavailableError, VideoUnavailableError
from .models import Transcript, VideoMetadata

_VIDEO_ID_PATTERNS = [
    re.compile(r"(?:v=|/shorts/|/live/|youtu\.be/)([A-Za-z0-9_-]{11})"),
]


def extract_video_id(url_or_id: str) -> str:
    """Best-effort extraction of an 11-character YouTube video ID from a URL."""
    candidate = url_or_id.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate):
        return candidate
    for pattern in _VIDEO_ID_PATTERNS:
        match = pattern.search(candidate)
        if match:
            return match.group(1)
    raise VideoUnavailableError(f"Could not extract a video ID from: {url_or_id!r}")


class YouTubeClient(ABC):
    """Interface every concrete YouTube data source implements."""

    @abstractmethod
    def get_video_metadata(self, video_id: str) -> VideoMetadata: ...

    @abstractmethod
    def get_transcript(self, video_id: str) -> Transcript: ...

    @abstractmethod
    def search_videos(self, query: str, limit: int = 5) -> list[str]:
        """Return matching video IDs. Deliberately IDs only, not full metadata:
        callers fetch metadata per-video (see process_video_id) so that one
        unavailable video in a result set can't abort the whole listing."""
        ...

    @abstractmethod
    def get_channel_recent_videos(self, channel_id: str, limit: int = 5) -> list[str]:
        """Return recent video IDs for a channel. IDs only — see search_videos docstring."""
        ...


class RealYouTubeClient(YouTubeClient):
    """Talks to the real YouTube Data API v3 + youtube-transcript-api.

    Requires ``google-api-python-client`` and ``youtube-transcript-api``
    (see requirements.txt) and a valid ``api_key``. Not exercised by the
    test suite / validation loop — those run entirely against
    ``MockYouTubeClient``.
    """

    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("YouTube API key is required for RealYouTubeClient")
        self._api_key = api_key
        self._youtube = None

    def _client(self):
        if self._youtube is None:
            from googleapiclient.discovery import build  # type: ignore
            from googleapiclient.errors import HttpError  # noqa: F401  (kept for callers)

            self._youtube = build("youtube", "v3", developerKey=self._api_key)
        return self._youtube

    def get_video_metadata(self, video_id: str) -> VideoMetadata:
        from googleapiclient.errors import HttpError  # type: ignore

        try:
            resp = (
                self._client()
                .videos()
                .list(part="snippet,contentDetails,liveStreamingDetails", id=video_id)
                .execute()
            )
        except HttpError as exc:
            if getattr(exc, "status_code", None) == 403:
                raise QuotaExceededError(str(exc)) from exc
            raise VideoUnavailableError(str(exc)) from exc

        items = resp.get("items", [])
        if not items:
            raise VideoUnavailableError(f"Video not found or private: {video_id}")

        item = items[0]
        snippet = item["snippet"]
        return VideoMetadata(
            video_id=video_id,
            title=snippet.get("title", "(no title)"),
            channel_title=snippet.get("channelTitle", "unknown"),
            channel_id=snippet.get("channelId", ""),
            published_at=snippet.get("publishedAt", ""),
            duration_seconds=_iso8601_duration_to_seconds(
                item.get("contentDetails", {}).get("duration")
            ),
            language=snippet.get("defaultAudioLanguage") or snippet.get("defaultLanguage"),
            is_live=bool(item.get("liveStreamingDetails")),
        )

    def get_transcript(self, video_id: str) -> Transcript:
        from youtube_transcript_api import (  # type: ignore
            NoTranscriptFound,
            TranscriptsDisabled,
            VideoUnavailable,
            YouTubeTranscriptApi,
        )

        try:
            segments = YouTubeTranscriptApi.get_transcript(video_id)
        except (TranscriptsDisabled, NoTranscriptFound) as exc:
            raise TranscriptUnavailableError(str(exc)) from exc
        except VideoUnavailable as exc:
            raise VideoUnavailableError(str(exc)) from exc

        full_text = " ".join(seg["text"] for seg in segments).strip()
        if not full_text:
            raise TranscriptUnavailableError(f"Empty transcript for {video_id}")
        return Transcript(video_id=video_id, language="unknown", full_text=full_text)

    def search_videos(self, query: str, limit: int = 5) -> list[str]:
        from googleapiclient.errors import HttpError  # type: ignore

        try:
            resp = (
                self._client()
                .search()
                .list(part="snippet", q=query, type="video", maxResults=limit)
                .execute()
            )
        except HttpError as exc:
            if getattr(exc, "status_code", None) == 403:
                raise QuotaExceededError(str(exc)) from exc
            raise

        return [item["id"]["videoId"] for item in resp.get("items", [])]

    def get_channel_recent_videos(self, channel_id: str, limit: int = 5) -> list[str]:
        from googleapiclient.errors import HttpError  # type: ignore

        try:
            resp = (
                self._client()
                .search()
                .list(
                    part="snippet",
                    channelId=channel_id,
                    type="video",
                    order="date",
                    maxResults=limit,
                )
                .execute()
            )
        except HttpError as exc:
            if getattr(exc, "status_code", None) == 403:
                raise QuotaExceededError(str(exc)) from exc
            raise

        return [item["id"]["videoId"] for item in resp.get("items", [])]


def _iso8601_duration_to_seconds(duration: Optional[str]) -> Optional[int]:
    if not duration:
        return None
    match = re.fullmatch(
        r"P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration
    )
    if not match:
        return None
    hours, minutes, seconds = (int(g) if g else 0 for g in match.groups())
    return hours * 3600 + minutes * 60 + seconds


class MockYouTubeClient(YouTubeClient):
    """Deterministic, offline stand-in used by tests and the validation loop.

    ``fixtures`` maps video_id -> either:
      - a dict with keys ``metadata`` (VideoMetadata kwargs) and
        ``transcript`` (full_text string or None to simulate "no captions"), or
      - an Exception instance, which is raised when that video is requested.

    ``search_results`` / ``channel_results`` map a query/channel_id to a
    list of video_ids (or an Exception to raise).
    """

    def __init__(
        self,
        fixtures: Optional[dict] = None,
        search_results: Optional[dict] = None,
        channel_results: Optional[dict] = None,
    ):
        self.fixtures = fixtures or {}
        self.search_results = search_results or {}
        self.channel_results = channel_results or {}

    def get_video_metadata(self, video_id: str) -> VideoMetadata:
        entry = self._lookup(video_id)
        meta = entry["metadata"]
        if isinstance(meta, VideoMetadata):
            return meta
        return VideoMetadata(video_id=video_id, **meta)

    def get_transcript(self, video_id: str) -> Transcript:
        entry = self._lookup(video_id)
        text = entry.get("transcript")
        if text is None:
            raise TranscriptUnavailableError(f"No captions available for {video_id}")
        return Transcript(
            video_id=video_id,
            language=entry.get("language", "en"),
            full_text=text,
            is_auto_generated=entry.get("is_auto_generated", True),
        )

    def search_videos(self, query: str, limit: int = 5) -> list[str]:
        result = self.search_results.get(query, [])
        if isinstance(result, Exception):
            raise result
        return list(result[:limit])

    def get_channel_recent_videos(self, channel_id: str, limit: int = 5) -> list[str]:
        result = self.channel_results.get(channel_id, [])
        if isinstance(result, Exception):
            raise result
        return list(result[:limit])

    def _lookup(self, video_id: str) -> dict:
        entry = self.fixtures.get(video_id)
        if entry is None:
            raise VideoUnavailableError(f"Video not found or private: {video_id}")
        if isinstance(entry, Exception):
            raise entry
        return entry
