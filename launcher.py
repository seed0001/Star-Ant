#!/usr/bin/env python3
"""
Start the Vite dev server for Grass World (npm run dev).

By default the server runs in a **separate OS process** (new console on Windows, new
session on Unix) so the browser tab or this launcher can crash without taking down
Node/Vite. A background thread opens the default browser once the port answers.

  python path/to/launcher.py              # detached Vite + open browser when ready
  python path/to/launcher.py --foreground # block in this terminal (old behavior)
  python path/to/launcher.py --no-browser # detached, do not open a browser tab

  Vite is configured with host: true so the dev server listens on your LAN. On the tablet,
  open http://YOUR_PC_LAN_IP:5173/ (same port Vite prints). Windows: ipconfig → IPv4.

Run from anywhere, or double-click on Windows if .py is associated with Python.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
DEV_URL = "http://127.0.0.1:5173/"
DEV_PORT_FIRST = 5173
DEV_PORT_LAST = 5181


def _which(*names: str) -> str | None:
    for name in names:
        p = shutil.which(name)
        if p:
            return p
    return None


def resolve_dev_command() -> tuple[list[str], str] | tuple[None, str]:
    """
    Return argv for the dev server and a short label for messages.

    On Windows, `npm` alone is often not resolved by subprocess; `npm.cmd` works.
    If npm is missing but `node` is on PATH, run Vite directly from node_modules.
    """
    npm = _which("npm.cmd", "npm") if sys.platform == "win32" else _which("npm")
    if npm:
        return [npm, "run", "dev"], "npm run dev"

    npx = _which("npx.cmd", "npx") if sys.platform == "win32" else _which("npx")
    if npx:
        return [npx, "vite"], "npx vite"

    node = _which("node.exe", "node") if sys.platform == "win32" else _which("node")
    vite_js = ROOT / "node_modules" / "vite" / "bin" / "vite.js"
    if node and vite_js.is_file():
        return [node, str(vite_js)], "node node_modules/vite/bin/vite.js"

    return None, ""


def _open_browser_when_ready(timeout_s: float = 45.0) -> None:
    """
    Wait until a local dev server answers on 5173–5181 (Vite may use the next port
    if the default is taken), then open that base URL in the browser.
    """
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        for port in range(DEV_PORT_FIRST, DEV_PORT_LAST + 1):
            url = f"http://127.0.0.1:{port}/"
            try:
                with urlopen(url, timeout=0.75) as r:
                    code = getattr(r, "status", None) or r.getcode()
                    if code == 200:
                        webbrowser.open(url)
                        return
            except (URLError, OSError):
                continue
        time.sleep(0.15)
    print(
        "Timed out waiting for the dev server (tried ports "
        f"{DEV_PORT_FIRST}–{DEV_PORT_LAST}). "
        "If Vite is running, open the Local URL it prints (e.g. "
        "http://localhost:5174/). For the river lab add /river.html",
        file=sys.stderr,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Start Grass World Vite dev server.")
    parser.add_argument(
        "--foreground",
        "-f",
        action="store_true",
        help="Run Vite in this terminal and block until it exits (single process).",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open a browser tab automatically.",
    )
    args = parser.parse_args()

    if not (ROOT / "package.json").exists():
        print(
            "Error: package.json not found next to launcher.py.",
            file=sys.stderr,
        )
        sys.exit(1)

    cmd, label = resolve_dev_command()
    if cmd is None:
        print(
            "Error: Could not find Node.js tools.\n"
            "  • Install Node.js from https://nodejs.org/ (includes npm), then restart the terminal.\n"
            "  • Or ensure `node` is on PATH and run `npm install` in this folder first.",
            file=sys.stderr,
        )
        sys.exit(1)

    if args.foreground:
        print("Starting Vite dev server (Ctrl+C to stop)…")
        print(f"Command: {label}")
        print(f"Usually: {DEV_URL}\n")
        try:
            subprocess.run(
                cmd,
                cwd=ROOT,
                check=True,
            )
        except FileNotFoundError:
            print(
                "Error: Executable disappeared from PATH (try restarting the terminal).",
                file=sys.stderr,
            )
            sys.exit(1)
        except subprocess.CalledProcessError as e:
            sys.exit(e.returncode if e.returncode is not None else 1)
        except KeyboardInterrupt:
            print("\nStopped.")
        return

    # Detached: separate OS process so a browser/GPU crash does not kill Node.
    pop_kwargs: dict = {
        "cwd": ROOT,
    }
    if sys.platform == "win32":
        pop_kwargs["creationflags"] = subprocess.CREATE_NEW_CONSOLE
    else:
        pop_kwargs["start_new_session"] = True

    print("Starting Vite in a separate window/process…")
    print(f"Command: {label}")
    print(f"URL: {DEV_URL}")
    print("Tip: use --foreground to run Vite in this terminal instead.\n")

    try:
        subprocess.Popen(cmd, **pop_kwargs)
    except FileNotFoundError:
        print(
            "Error: Executable disappeared from PATH (try restarting the terminal).",
            file=sys.stderr,
        )
        sys.exit(1)
    except OSError as e:
        print(f"Error: could not start dev server: {e}", file=sys.stderr)
        sys.exit(1)

    if not args.no_browser:
        t = threading.Thread(
            target=_open_browser_when_ready,
            name="open-browser",
            daemon=False,
        )
        t.start()

    print(
        "Launcher done. Keep the Vite window open; close this window anytime.\n"
        "If the browser tab crashes, refresh — the dev server should still be running.\n"
        "River lab: use the same host:port as Vite’s “Local” line, with /river.html "
        "(e.g. http://127.0.0.1:5174/river.html if Vite chose 5174).\n"
    )


if __name__ == "__main__":
    main()
