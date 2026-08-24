#!/usr/bin/env python3
import hashlib
import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import tempfile
import threading
import resource
import signal
import zipfile

SOCKET_PATH = "/run/kelion-converter-private/parser.sock"
CONVERTER_EXEC = "/opt/kelion/converter-exec.py"
MAX_OUTPUT_CHARS = 2_000_000
MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
ALLOWED = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
}
CONCURRENCY = threading.BoundedSemaphore(2)
CHILD_ENV = {
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "HOME": "/nonexistent",
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "NUMEXPR_NUM_THREADS": "1",
    "VECLIB_MAXIMUM_THREADS": "1",
}


def child_limits():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (25, 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024 * 1024, 4 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))


def archive_is_bounded(path):
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if not infos or len(infos) > 2_000:
                return False
            total = 0
            for info in infos:
                name = info.filename.replace("\\", "/")
                if not name or name.startswith("/") or ".." in name.split("/") or info.flag_bits & 1:
                    return False
                total += info.file_size
                if total > 100 * 1024 * 1024:
                    return False
                if info.file_size and (not info.compress_size or info.file_size / info.compress_size > 200):
                    return False
            return True
    except (OSError, zipfile.BadZipFile):
        return False


def response(handler, status, value):
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(raw)))
    handler.send_header("cache-control", "no-store")
    handler.end_headers()
    handler.wfile.write(raw)


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "kelion-converter"

    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        if self.path == "/healthz":
            response(self, 200, {"ok": True})
        else:
            response(self, 404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/v1/convert":
            response(self, 404, {"error": "not_found"})
            return
        if not CONCURRENCY.acquire(blocking=False):
            response(self, 429, {"error": "busy"})
            return
        try:
            self._convert()
        finally:
            CONCURRENCY.release()

    def _convert(self):
        filename = self.headers.get("x-filename", "")
        if not filename or len(filename) > 120 or not re.fullmatch(r"[A-Za-z0-9_. -]+", filename):
            response(self, 400, {"error": "filename_invalid"})
            return
        extension = os.path.splitext(filename)[1].lower()
        expected_type = ALLOWED.get(extension)
        if not expected_type or self.headers.get_content_type().lower() != expected_type:
            response(self, 415, {"error": "type_rejected"})
            return
        limit = MAX_ARCHIVE_BYTES if extension in (".docx", ".xlsx", ".pptx") else MAX_DOCUMENT_BYTES
        try:
            size = int(self.headers.get("content-length", "-1"))
        except ValueError:
            size = -1
        if size < 1 or size > limit:
            response(self, 413, {"error": "too_large"})
            return
        body = self.rfile.read(size)
        if len(body) != size:
            response(self, 400, {"error": "body_invalid"})
            return
        content_hash = hashlib.sha256(body).hexdigest()
        if content_hash != self.headers.get("x-content-sha256", "").lower():
            response(self, 400, {"error": "hash_mismatch"})
            return
        if extension == ".pdf" and not body.startswith(b"%PDF-"):
            response(self, 400, {"error": "content_invalid"})
            return
        if extension in (".docx", ".xlsx", ".pptx") and not body.startswith(b"PK"):
            response(self, 400, {"error": "content_invalid"})
            return
        if extension in (".txt", ".md", ".csv") and b"\0" in body:
            response(self, 400, {"error": "content_invalid"})
            return

        path = ""
        try:
            descriptor, path = tempfile.mkstemp(prefix="doc-", suffix=extension, dir="/tmp")
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(body)
            if extension in (".docx", ".xlsx", ".pptx") and not archive_is_bounded(path):
                response(self, 400, {"error": "archive_invalid"})
                return
            child = subprocess.Popen(
                [sys.executable, "-I", CONVERTER_EXEC, path],
                cwd="/tmp",
                env=CHILD_ENV,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                preexec_fn=child_limits,
            )
            try:
                output, _ = child.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.communicate()
                response(self, 504, {"error": "timeout"})
                return
            if child.returncode != 0:
                response(self, 422, {"error": "convert_failed"})
                return
            if len(output) > MAX_OUTPUT_CHARS * 4:
                response(self, 413, {"error": "output_too_large"})
                return
            markdown = output.decode("utf-8", errors="strict")
            if len(markdown) > MAX_OUTPUT_CHARS:
                response(self, 413, {"error": "output_too_large"})
                return
            response(self, 200, {"markdown": markdown.strip()})
        except Exception:
            response(self, 422, {"error": "convert_failed"})
        finally:
            if path:
                try:
                    os.unlink(path)
                except FileNotFoundError:
                    pass


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    request_queue_size = 4


def main():
    if "--self-test" in sys.argv:
        assert set(ALLOWED) == {".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".md", ".csv"}
        assert all(CHILD_ENV[name] == "1" for name in (
            "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
            "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS",
        ))
        print("converter-parser-self-test: TRECE")
        return
    try:
        os.unlink(SOCKET_PATH)
    except FileNotFoundError:
        pass
    with Server(SOCKET_PATH, Handler) as server:
        os.chmod(SOCKET_PATH, 0o660)
        server.serve_forever()


if __name__ == "__main__":
    main()
