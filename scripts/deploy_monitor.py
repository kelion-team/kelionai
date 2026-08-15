#!/usr/bin/env python3
"""
CLI local pentru monitorizarea progresului de deploy KelionAI.
Interoghează API-ul /api/deploy/progress la fiecare 2 secunde și randează o bară de progres dinamică.
"""

import sys
import time
import json
import urllib.request
import urllib.error

def get_progress(url: str):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "KelionDeployMonitor/1.0", "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        if response.status == 200:
            return json.loads(response.read().decode("utf-8"))
    return None

def render_simple_bar(percent: int, step: str, status: str, width: int = 30):
    completed = int(width * (percent / 100.0))
    bar = "=" * completed + "-" * (width - completed)
    sys.stdout.write(f"\r[{bar}] {percent}% | {status.upper()} | {step}")
    sys.stdout.flush()

def main():
    target_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000/api/deploy/progress"
    print(f"Monitoring deploy progress from: {target_url}")

    has_rich = False
    try:
        from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn
        from rich.console import Console
        has_rich = True
    except ImportError:
        pass

    if has_rich:
        console = Console()
        console.print("[bold blue]Starting Rich Deploy Monitor...[/bold blue]")
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
            console=console
        ) as progress:
            task = progress.add_task("Așteptare deploy...", total=100)
            while not progress.finished:
                try:
                    data = get_progress(target_url)
                    if data and data.get("ok") and "state" in data:
                        state = data["state"]
                        pct = state.get("percent", 0)
                        step = state.get("step", "")
                        status = state.get("status", "idle")
                        msg = f"[{status}] {step}"
                        progress.update(task, completed=pct, description=msg)
                        if status in ("success", "failed"):
                            break
                except Exception as e:
                    progress.update(task, description=f"[red]Eroare conexiune: {e}[/red]")
                time.sleep(2)
        print("\nDeploy finalizat!")
    else:
        while True:
            try:
                data = get_progress(target_url)
                if data and data.get("ok") and "state" in data:
                    state = data["state"]
                    pct = state.get("percent", 0)
                    step = state.get("step", "In lucru...")
                    status = state.get("status", "idle")
                    render_simple_bar(pct, step, status)
                    if status in ("success", "failed"):
                        print(f"\nFinalizat cu status: {status}")
                        break
            except Exception as e:
                sys.stdout.write(f"\rEroare conexiune: {e}")
                sys.stdout.flush()
            time.sleep(2)

if __name__ == "__main__":
    main()
