"""Core data structures passed between pipeline stages."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


@dataclass
class VideoMetadata:
    video_id: str
    title: str
    channel_title: str
    channel_id: str
    published_at: str  # ISO 8601
    duration_seconds: Optional[int] = None
    url: str = ""
    language: Optional[str] = None
    is_live: bool = False

    def __post_init__(self) -> None:
        if not self.url:
            self.url = f"https://www.youtube.com/watch?v={self.video_id}"


@dataclass
class Transcript:
    video_id: str
    language: str
    full_text: str
    is_auto_generated: bool = True


@dataclass
class NotableQuote:
    quote: str
    timestamp: Optional[str] = None


@dataclass
class StructuredNote:
    summary: str
    key_points: list[str] = field(default_factory=list)
    notable_quotes: list[NotableQuote] = field(default_factory=list)
    action_items: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    parse_error: bool = False


class ProcessStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class ProcessResult:
    status: ProcessStatus
    video_id: Optional[str] = None
    video: Optional[VideoMetadata] = None
    note: Optional[StructuredNote] = None
    note_path: Optional[str] = None
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.status in (ProcessStatus.SUCCESS, ProcessStatus.PARTIAL)
