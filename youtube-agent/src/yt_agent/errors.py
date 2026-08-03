"""Exception types shared across the pipeline.

All of these are *expected* failure modes (missing captions, private
videos, rate limits, ...). The pipeline catches them and turns them into
a ``ProcessResult`` instead of crashing, so a bad video never takes down
a batch run.
"""


class YouTubeAgentError(Exception):
    """Base class for all expected errors in this package."""


class VideoUnavailableError(YouTubeAgentError):
    """The video does not exist, is private, or was removed."""


class TranscriptUnavailableError(YouTubeAgentError):
    """No caption track could be retrieved for the video."""


class QuotaExceededError(YouTubeAgentError):
    """The YouTube Data API quota (or similar rate limit) was hit."""


class LLMError(YouTubeAgentError):
    """The LLM provider failed to produce a usable response."""


class LLMTransientError(LLMError):
    """A retryable error (timeout, 5xx, rate limit) from the LLM provider."""
