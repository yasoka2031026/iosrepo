import json
import tempfile
import unittest
from pathlib import Path

from yt_agent.errors import VideoUnavailableError
from yt_agent.llm_client import MockLLMClient
from yt_agent.models import ProcessStatus
from yt_agent.note_writer import sanitize_filename
from yt_agent.pipeline import Pipeline
from yt_agent.youtube_client import MockYouTubeClient, extract_video_id


def make_pipeline(fixtures=None, search_results=None, channel_results=None, llm_behavior="success", vault=None):
    yt = MockYouTubeClient(fixtures=fixtures, search_results=search_results, channel_results=channel_results)
    llm = MockLLMClient(behavior=llm_behavior)
    vault_path = vault or Path(tempfile.mkdtemp())
    return Pipeline(yt, llm, vault_path), vault_path


def video_fixture(title="Test Video", transcript="Hello world, this is a test transcript.", **overrides):
    metadata = {
        "title": title,
        "channel_title": "Test Channel",
        "channel_id": "UCtest",
        "published_at": "2026-01-01T00:00:00Z",
        **overrides,
    }
    return {"metadata": metadata, "transcript": transcript}


class ExtractVideoIdTests(unittest.TestCase):
    def test_watch_url(self):
        self.assertEqual(extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ")

    def test_short_url(self):
        self.assertEqual(extract_video_id("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ")

    def test_bare_id(self):
        self.assertEqual(extract_video_id("dQw4w9WgXcQ"), "dQw4w9WgXcQ")

    def test_invalid(self):
        with self.assertRaises(VideoUnavailableError):
            extract_video_id("not a url at all")


class SanitizeFilenameTests(unittest.TestCase):
    def test_strips_illegal_chars(self):
        self.assertEqual(sanitize_filename('Bad: "Title" / Test?'), "Bad Title Test")

    def test_empty_title_falls_back(self):
        self.assertEqual(sanitize_filename("???"), "Untitled")

    def test_truncates_long_titles(self):
        long_title = "A" * 300
        self.assertLessEqual(len(sanitize_filename(long_title)), 80)


class PipelineHappyPathTests(unittest.TestCase):
    def test_process_url_success(self):
        pipeline, vault = make_pipeline(fixtures={"abc12345678": video_fixture()})
        result = pipeline.process_url("https://www.youtube.com/watch?v=abc12345678")
        self.assertEqual(result.status, ProcessStatus.SUCCESS)
        self.assertTrue(Path(result.note_path).exists())
        note_text = Path(result.note_path).read_text(encoding="utf-8")
        self.assertIn("Mock summary", note_text)
        self.assertIn("video_id:", note_text)
        moc_text = (vault / "YouTube Information Gathering MOC.md").read_text(encoding="utf-8")
        self.assertIn("abc12345678", moc_text)

    def test_process_channel_multiple_videos(self):
        fixtures = {
            "vid00000001": video_fixture(title="Video One"),
            "vid00000002": video_fixture(title="Video Two"),
        }
        pipeline, _ = make_pipeline(
            fixtures=fixtures,
            channel_results={"UCchannel": ["vid00000001", "vid00000002"]},
        )
        results = pipeline.process_channel("UCchannel", limit=5)
        self.assertEqual(len(results), 2)
        self.assertTrue(all(r.status == ProcessStatus.SUCCESS for r in results))


class PipelineErrorPathTests(unittest.TestCase):
    def test_unknown_video_id_fails_gracefully(self):
        pipeline, _ = make_pipeline(fixtures={})
        result = pipeline.process_video_id("doesnotexist")
        self.assertEqual(result.status, ProcessStatus.FAILED)
        self.assertIsNotNone(result.error)

    def test_process_url_all_failed_into_nonexistent_vault_does_not_crash(self):
        # Regression test: if every result in a batch fails (no note ever
        # written), update_moc used to crash writing into a vault directory
        # that had never been created.
        fresh_vault = Path(tempfile.mkdtemp()) / "brand" / "new" / "vault"
        self.assertFalse(fresh_vault.exists())
        pipeline, _ = make_pipeline(fixtures={}, vault=fresh_vault)
        result = pipeline.process_url("missing0001")
        self.assertEqual(result.status, ProcessStatus.FAILED)
        self.assertTrue(fresh_vault.exists())

    def test_no_transcript_is_skipped_not_crashed(self):
        pipeline, _ = make_pipeline(fixtures={"noc0000001c": video_fixture(transcript=None)})
        result = pipeline.process_video_id("noc0000001c")
        self.assertEqual(result.status, ProcessStatus.SKIPPED)

    def test_live_video_is_skipped(self):
        pipeline, _ = make_pipeline(fixtures={"live0000001": video_fixture(is_live=True)})
        result = pipeline.process_video_id("live0000001")
        self.assertEqual(result.status, ProcessStatus.SKIPPED)

    def test_llm_malformed_json_is_partial_not_crash(self):
        pipeline, _ = make_pipeline(
            fixtures={"malf0000001": video_fixture()}, llm_behavior="malformed_json"
        )
        result = pipeline.process_video_id("malf0000001")
        self.assertEqual(result.status, ProcessStatus.PARTIAL)
        self.assertTrue(Path(result.note_path).exists())

    def test_llm_always_transient_fails_gracefully(self):
        pipeline, _ = make_pipeline(
            fixtures={"tran0000001": video_fixture()}, llm_behavior="always_transient"
        )
        result = pipeline.process_video_id("tran0000001")
        self.assertEqual(result.status, ProcessStatus.FAILED)

    def test_llm_transient_then_success_recovers(self):
        pipeline, _ = make_pipeline(
            fixtures={"retr0000001": video_fixture()}, llm_behavior="transient_then_success"
        )
        result = pipeline.process_video_id("retr0000001")
        self.assertEqual(result.status, ProcessStatus.SUCCESS)

    def test_batch_survives_mixed_valid_invalid(self):
        pipeline, _ = make_pipeline(fixtures={"good0000001": video_fixture()})
        entries = [
            {"type": "url", "value": "good0000001"},
            {"type": "url", "value": "missing0001"},
            {"type": "bogus", "value": "x"},
        ]
        results = pipeline.process_batch(entries)
        self.assertEqual(len(results), 3)
        self.assertEqual(results[0].status, ProcessStatus.SUCCESS)
        self.assertEqual(results[1].status, ProcessStatus.FAILED)
        self.assertEqual(results[2].status, ProcessStatus.FAILED)

    def test_channel_listing_survives_one_unavailable_video(self):
        # Regression test: search_videos/get_channel_recent_videos must return bare
        # video IDs, not eagerly-resolved VideoMetadata, so that one video failing
        # metadata lookup doesn't blow up the whole channel/query listing.
        fixtures = {
            "ok0000000001": video_fixture(title="OK 1"),
            "bad000000001": VideoUnavailableError("removed by uploader"),
            "ok0000000002": video_fixture(title="OK 2"),
        }
        pipeline, _ = make_pipeline(
            fixtures=fixtures,
            channel_results={"UCsomechannel": ["ok0000000001", "bad000000001", "ok0000000002"]},
        )
        results = pipeline.process_channel("UCsomechannel", limit=5)
        self.assertEqual(len(results), 3)
        self.assertEqual(results[0].status, ProcessStatus.SUCCESS)
        self.assertEqual(results[1].status, ProcessStatus.FAILED)
        self.assertEqual(results[2].status, ProcessStatus.SUCCESS)

    def test_reprocessing_updates_note_but_not_duplicate_moc_row(self):
        pipeline, vault = make_pipeline(fixtures={"dupe0000001": video_fixture()})
        r1 = pipeline.process_url("dupe0000001")
        r2 = pipeline.process_url("dupe0000001")
        self.assertEqual(r1.note_path, r2.note_path)
        moc_text = (vault / "YouTube Information Gathering MOC.md").read_text(encoding="utf-8")
        self.assertEqual(moc_text.count("<!-- dupe0000001 -->"), 1)


class LongTranscriptChunkingTests(unittest.TestCase):
    def test_long_transcript_is_chunked_and_summarized(self):
        long_transcript = "word " * 5000  # well over the 8000-char single-chunk budget
        pipeline, _ = make_pipeline(fixtures={"long0000001": video_fixture(transcript=long_transcript)})
        result = pipeline.process_video_id("long0000001")
        self.assertEqual(result.status, ProcessStatus.SUCCESS)


if __name__ == "__main__":
    unittest.main()
