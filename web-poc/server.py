#!/usr/bin/env python3
"""
LINE Chat Analyzer - Web POC Server
外部ライブラリ不要 (Python stdlib のみ)

Usage:
    python server.py
    ANTHROPIC_API_KEY=sk-ant-xxx python server.py  # 環境変数でAPIキーを設定
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.request
import urllib.error
import os
from pathlib import Path

PORT = 8080
STATIC_DIR = Path(__file__).parent / "static"
ENV_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()}  {fmt % args}")

    # ── GET ──────────────────────────────────────────────────────────
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._serve_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
        else:
            self._not_found()

    # ── POST ─────────────────────────────────────────────────────────
    def do_POST(self):
        if self.path == "/api/claude":
            self._proxy_claude()
        else:
            self._not_found()

    # ── OPTIONS (CORS プリフライト) ────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    # ── Claude API プロキシ ───────────────────────────────────────────
    def _proxy_claude(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)

            # 優先順位: 環境変数 > クライアントが設定タブで入力したキー
            client_key = self.headers.get("x-client-api-key", "")
            key = ENV_API_KEY or client_key

            if not key:
                self._json_error(401, "APIキーが設定されていません。設定タブから入力してください。")
                return

            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages",
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                },
                method="POST",
            )

            with urllib.request.urlopen(req, timeout=60) as resp:
                result = resp.read()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(result)

        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self._json_error(500, str(e))

    # ── ユーティリティ ─────────────────────────────────────────────────
    def _serve_file(self, path, content_type):
        try:
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", len(data))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self._not_found()

    def _json_error(self, code, message):
        body = json.dumps({"error": message}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _not_found(self):
        self.send_response(404)
        self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, x-client-api-key")


if __name__ == "__main__":
    server = HTTPServer(("localhost", PORT), Handler)
    print("=" * 50)
    print("  LINE Chat Analyzer - Web POC")
    print("=" * 50)
    print(f"  URL : http://localhost:{PORT}")
    print(f"  API キー: {'環境変数から設定済み ✓' if ENV_API_KEY else '未設定 (設定タブから入力)'}")
    print("  終了: Ctrl + C")
    print("=" * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバーを停止しました")
