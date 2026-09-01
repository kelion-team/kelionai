#!/usr/bin/env python3
"""Read-only, repeatable benchmark for the active loopback llama.cpp model.

The script intentionally does not restart, switch, configure, or write anything
on the host.  It emits one JSON document and never includes generated content.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import statistics
import subprocess
import threading
import time
from typing import Any


API_HOST = "127.0.0.1"
API_PORT = 24080
COMPLETION_PATH = "/completion"
MODELS_PATH = "/v1/models"
HEALTH_PATH = "/health"
UNIT = "private-ai-llm.service"
WARMUP_COUNT = 1
SAMPLE_COUNT = 3
REQUEST_TIMEOUT_SECONDS = 1800
PROMPT = (
    "Continue this deterministic Romanian software-test sequence with short "
    "numbered items only: 1. validare input; 2. autorizare obiect; 3. rollback;"
)
REQUEST_PARAMETERS: dict[str, Any] = {
    "prompt": PROMPT,
    "n_predict": 128,
    "temperature": 0,
    "seed": 424242,
    "stream": True,
    "ignore_eos": True,
    "cache_prompt": False,
}


class BenchmarkError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise BenchmarkError(message)


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as error:
        fail(f"cannot read required runtime state: {path.name}: {error.strerror}")
    raise AssertionError("unreachable")


def read_int(path: Path) -> int:
    value = read_text(path)
    if not value.isdigit():
        fail(f"runtime counter is not an integer: {path.name}")
    return int(value)


def systemctl(*arguments: str) -> str:
    command = ["systemctl", *arguments]
    result = subprocess.run(
        command,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        fail(f"read-only systemctl query failed: {' '.join(arguments)}")
    return result.stdout.strip()


def unit_property(name: str) -> str:
    return systemctl("show", UNIT, f"--property={name}", "--value", "--no-pager")


def http_json(method: str, path: str, body: bytes | None = None) -> Any:
    connection = http.client.HTTPConnection(API_HOST, API_PORT, timeout=30)
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read()
    except (OSError, TimeoutError, http.client.HTTPException) as error:
        fail(f"loopback llama.cpp request failed for {path}: {type(error).__name__}")
    finally:
        connection.close()
    if response.status != 200:
        fail(f"loopback llama.cpp returned HTTP {response.status} for {path}")
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail(f"loopback llama.cpp returned invalid JSON for {path}")
    raise AssertionError("unreachable")


def proc_status_bytes(pid: int, field: str) -> int:
    prefix = f"{field}:"
    for line in read_text(Path(f"/proc/{pid}/status")).splitlines():
        if line.startswith(prefix):
            parts = line.split()
            if len(parts) != 3 or parts[2] != "kB" or not parts[1].isdigit():
                fail(f"invalid {field} in llama-server process status")
            return int(parts[1]) * 1024
    fail(f"missing {field} in llama-server process status")
    raise AssertionError("unreachable")


def proc_cpu_seconds(pid: int) -> float:
    stat = read_text(Path(f"/proc/{pid}/stat"))
    try:
        fields_after_comm = stat.rsplit(")", 1)[1].split()
        ticks = int(fields_after_comm[11]) + int(fields_after_comm[12])
    except (IndexError, ValueError):
        fail("invalid llama-server process CPU counters")
    return ticks / os.sysconf("SC_CLK_TCK")


def load_average() -> dict[str, float]:
    fields = read_text(Path("/proc/loadavg")).split()
    if len(fields) < 3:
        fail("invalid host load average")
    return {
        "one_minute": float(fields[0]),
        "five_minutes": float(fields[1]),
        "fifteen_minutes": float(fields[2]),
    }


def memory_snapshot(pid: int, cgroup_directory: Path) -> dict[str, int]:
    return {
        "process_rss_bytes": proc_status_bytes(pid, "VmRSS"),
        "process_peak_rss_bytes": proc_status_bytes(pid, "VmHWM"),
        "cgroup_current_bytes": read_int(cgroup_directory / "memory.current"),
        "cgroup_lifetime_peak_bytes": read_int(cgroup_directory / "memory.peak"),
    }


class MemoryMonitor:
    def __init__(self, pid: int, cgroup_directory: Path) -> None:
        self.pid = pid
        self.cgroup_directory = cgroup_directory
        self.stop_event = threading.Event()
        self.observed_process_rss_peak_bytes = 0
        self.observed_cgroup_peak_bytes = 0
        self.error: BaseException | None = None
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _sample(self) -> None:
        snapshot = memory_snapshot(self.pid, self.cgroup_directory)
        self.observed_process_rss_peak_bytes = max(
            self.observed_process_rss_peak_bytes,
            snapshot["process_rss_bytes"],
        )
        self.observed_cgroup_peak_bytes = max(
            self.observed_cgroup_peak_bytes,
            snapshot["cgroup_current_bytes"],
        )

    def _run(self) -> None:
        try:
            while not self.stop_event.is_set():
                self._sample()
                self.stop_event.wait(0.05)
            self._sample()
        except BaseException as error:  # Propagated after the request finishes.
            self.error = error

    def __enter__(self) -> "MemoryMonitor":
        self.thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.stop_event.set()
        self.thread.join(timeout=5)
        if self.thread.is_alive():
            fail("memory monitor did not stop")
        if self.error is not None:
            raise self.error


def validate_timings(timings: Any) -> dict[str, Any]:
    if not isinstance(timings, dict):
        fail("llama.cpp final stream event omitted timings")
    required = (
        "prompt_n",
        "prompt_ms",
        "prompt_per_second",
        "predicted_n",
        "predicted_ms",
        "predicted_per_second",
    )
    for field in required:
        value = timings.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            fail(f"llama.cpp timings.{field} is not numeric")
        if not math.isfinite(float(value)) or float(value) < 0:
            fail(f"llama.cpp timings.{field} is invalid")
    if timings["predicted_n"] <= 0 or timings["predicted_ms"] <= 0:
        fail("llama.cpp did not measure generated tokens")
    return timings


def run_streamed_probe(
    ordinal: int,
    phase: str,
    request_body: bytes,
    pid: int,
    cgroup_directory: Path,
) -> dict[str, Any]:
    if unit_property("MainPID") != str(pid):
        fail("llama-server PID changed before a benchmark probe")

    memory_before = memory_snapshot(pid, cgroup_directory)
    load_before = load_average()
    cpu_before = proc_cpu_seconds(pid)
    started_at = utc_now()
    connection = http.client.HTTPConnection(
        API_HOST,
        API_PORT,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    first_token_ns: int | None = None
    final_event: dict[str, Any] | None = None
    parsed_events = 0

    with MemoryMonitor(pid, cgroup_directory) as monitor:
        start_ns = time.perf_counter_ns()
        try:
            connection.request(
                "POST",
                COMPLETION_PATH,
                body=request_body,
                headers={
                    "Accept": "text/event-stream",
                    "Content-Type": "application/json",
                },
            )
            response = connection.getresponse()
            if response.status != 200:
                fail(f"llama.cpp benchmark returned HTTP {response.status}")
            while True:
                raw_line = response.readline()
                if not raw_line:
                    break
                try:
                    line = raw_line.decode("utf-8").strip()
                except UnicodeDecodeError:
                    fail("llama.cpp stream contains invalid UTF-8")
                if not line:
                    continue
                payload = line[5:].strip() if line.startswith("data:") else line
                if payload == "[DONE]":
                    continue
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    fail("llama.cpp stream contains invalid JSON")
                if not isinstance(event, dict):
                    fail("llama.cpp stream event is not an object")
                parsed_events += 1
                content = event.get("content")
                if first_token_ns is None and isinstance(content, str) and content:
                    first_token_ns = time.perf_counter_ns()
                if "timings" in event:
                    final_event = event
            completed_ns = time.perf_counter_ns()
        except (OSError, TimeoutError, http.client.HTTPException) as error:
            fail(f"llama.cpp benchmark stream failed: {type(error).__name__}")
        finally:
            connection.close()

    if unit_property("MainPID") != str(pid):
        fail("llama-server PID changed during a benchmark probe")
    if parsed_events == 0 or first_token_ns is None or final_event is None:
        fail("llama.cpp benchmark stream is incomplete")
    timings = validate_timings(final_event.get("timings"))
    memory_after = memory_snapshot(pid, cgroup_directory)
    cpu_after = proc_cpu_seconds(pid)

    return {
        "phase": phase,
        "ordinal": ordinal,
        "started_at": started_at,
        "completed_at": utc_now(),
        "ttft_ms": round((first_token_ns - start_ns) / 1_000_000, 3),
        "end_to_end_ms": round((completed_ns - start_ns) / 1_000_000, 3),
        "process_cpu_seconds": round(cpu_after - cpu_before, 3),
        "event_count": parsed_events,
        "timings": timings,
        "memory_before": memory_before,
        "memory_after": memory_after,
        "observed_memory_peak_during_probe": {
            "process_rss_bytes": monitor.observed_process_rss_peak_bytes,
            "cgroup_current_bytes": monitor.observed_cgroup_peak_bytes,
        },
        "host_load_before": load_before,
        "host_load_after": load_average(),
    }


def distribution(values: list[float]) -> dict[str, float]:
    if not values:
        fail("cannot aggregate an empty measurement set")
    return {
        "minimum": min(values),
        "median": statistics.median(values),
        "mean": statistics.fmean(values),
        "maximum": max(values),
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def mapped_model_files(pid: int) -> list[dict[str, Any]]:
    paths: set[Path] = set()
    for line in read_text(Path(f"/proc/{pid}/maps")).splitlines():
        fields = line.split()
        if fields and fields[-1].startswith("/srv/private-ai/models/"):
            paths.add(Path(fields[-1]))
    if not paths:
        fail("llama-server has no mapped local model file")
    return [
        {"name": path.name, "bytes": path.stat().st_size}
        for path in sorted(paths)
    ]


def cpu_model() -> str:
    for line in read_text(Path("/proc/cpuinfo")).splitlines():
        if line.startswith("model name"):
            return line.split(":", 1)[1].strip()
    fail("host CPU model is unavailable")
    raise AssertionError("unreachable")


def total_memory_bytes() -> int:
    for line in read_text(Path("/proc/meminfo")).splitlines():
        if line.startswith("MemTotal:"):
            fields = line.split()
            if len(fields) == 3 and fields[1].isdigit() and fields[2] == "kB":
                return int(fields[1]) * 1024
    fail("host total memory is unavailable")
    raise AssertionError("unreachable")


def main() -> None:
    if os.geteuid() != 0:
        fail("benchmark must use the existing root SSH identity")
    if systemctl("is-active", UNIT) != "active":
        fail("private-ai-llm.service is not active")
    pid_text = unit_property("MainPID")
    if not pid_text.isdigit() or int(pid_text) <= 0:
        fail("private-ai-llm.service has no measured MainPID")
    pid = int(pid_text)

    executable = Path(os.readlink(f"/proc/{pid}/exe"))
    if executable != Path("/opt/private-ai/bin/llama-server"):
        fail("active service does not execute the pinned local llama-server")
    control_group = unit_property("ControlGroup")
    if not control_group.startswith("/") or ".." in Path(control_group).parts:
        fail("private-ai-llm.service has an invalid cgroup")
    cgroup_directory = Path("/sys/fs/cgroup" + control_group)
    if not cgroup_directory.is_dir():
        fail("private-ai-llm.service cgroup is unavailable")

    health = http_json("GET", HEALTH_PATH)
    if not isinstance(health, dict) or health.get("status") != "ok":
        fail("loopback llama.cpp health is not ok")
    models = http_json("GET", MODELS_PATH)
    model_rows = models.get("data") if isinstance(models, dict) else None
    if not isinstance(model_rows, list) or len(model_rows) != 1:
        fail("loopback llama.cpp must expose exactly one active model")
    model_id = model_rows[0].get("id") if isinstance(model_rows[0], dict) else None
    if not isinstance(model_id, str) or not model_id:
        fail("loopback llama.cpp active model id is invalid")

    request_body = json.dumps(
        REQUEST_PARAMETERS,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    measured_started_at = utc_now()
    warmup = run_streamed_probe(0, "warmup", request_body, pid, cgroup_directory)
    samples = [
        run_streamed_probe(ordinal, "sample", request_body, pid, cgroup_directory)
        for ordinal in range(1, SAMPLE_COUNT + 1)
    ]

    predicted_rates = [float(row["timings"]["predicted_per_second"]) for row in samples]
    prompt_rates = [float(row["timings"]["prompt_per_second"]) for row in samples]
    ttft_values = [float(row["ttft_ms"]) for row in samples]
    end_to_end_values = [float(row["end_to_end_ms"]) for row in samples]
    cpu_values = [float(row["process_cpu_seconds"]) for row in samples]
    observed_rss = [
        int(row["observed_memory_peak_during_probe"]["process_rss_bytes"])
        for row in samples
    ]
    observed_cgroup = [
        int(row["observed_memory_peak_during_probe"]["cgroup_current_bytes"])
        for row in samples
    ]

    model_files = mapped_model_files(pid)
    llama_commit_path = Path("/var/lib/private-ai/llama-cpp.commit")
    llama_commit = read_text(llama_commit_path)
    if len(llama_commit) != 40 or any(character not in "0123456789abcdef" for character in llama_commit):
        fail("llama.cpp commit receipt is invalid")

    result = {
        "schema": "kelion.private-ai.active-model-benchmark.v1",
        "measurement_policy": {
            "read_only": True,
            "warmup_count": WARMUP_COUNT,
            "sample_count": SAMPLE_COUNT,
            "generated_content_recorded": False,
            "aggregate_excludes_warmup": True,
        },
        "measured_at": {
            "started": measured_started_at,
            "completed": utc_now(),
        },
        "host": {
            "cpu_model": cpu_model(),
            "logical_cpu_count": os.cpu_count(),
            "memory_total_bytes": total_memory_bytes(),
        },
        "service": {
            "unit": UNIT,
            "main_pid": pid,
            "control_group": control_group,
            "cpu_quota_per_second": unit_property("CPUQuotaPerSecUSec"),
            "memory_high": unit_property("MemoryHigh"),
            "memory_max": unit_property("MemoryMax"),
            "llama_server_sha256": sha256_file(executable),
            "llama_cpp_commit": llama_commit,
        },
        "model": {
            "id": model_id,
            "mapped_files": model_files,
            "mapped_total_bytes": sum(row["bytes"] for row in model_files),
        },
        "request": {
            "endpoint": f"http://{API_HOST}:{API_PORT}{COMPLETION_PATH}",
            "sha256": hashlib.sha256(request_body).hexdigest(),
            "parameters": REQUEST_PARAMETERS,
        },
        "warmup": warmup,
        "samples": samples,
        "aggregate": {
            "sample_count": len(samples),
            "predicted_tokens_per_second": distribution(predicted_rates),
            "prompt_tokens_per_second": distribution(prompt_rates),
            "ttft_ms": distribution(ttft_values),
            "end_to_end_ms": distribution(end_to_end_values),
            "process_cpu_seconds": distribution(cpu_values),
            "observed_process_rss_peak_bytes": {
                "minimum": min(observed_rss),
                "median": statistics.median(observed_rss),
                "maximum": max(observed_rss),
            },
            "observed_cgroup_peak_bytes": {
                "minimum": min(observed_cgroup),
                "median": statistics.median(observed_cgroup),
                "maximum": max(observed_cgroup),
            },
        },
    }
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except BenchmarkError as error:
        raise SystemExit(f"benchmark failed: {error}") from None
