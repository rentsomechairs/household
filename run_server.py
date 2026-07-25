#!/usr/bin/env python3
"""Launch Household Hub on a local web server and open it in a private browser window."""

from __future__ import annotations

import argparse
import contextlib
import http.server
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Iterable


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_PORT = 8000


def port_is_available(host: str, port: int) -> bool:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def choose_port(host: str, preferred: int) -> int:
    if port_is_available(host, preferred):
        return preferred
    for port in range(preferred + 1, preferred + 101):
        if port_is_available(host, port):
            print(f"Port {preferred} is busy; using port {port} instead.")
            return port
    raise RuntimeError("No available local port found between 8000 and 8100.")


def browser_candidates() -> Iterable[tuple[str, list[str]]]:
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    program_files = os.environ.get("PROGRAMFILES", "")
    program_files_x86 = os.environ.get("PROGRAMFILES(X86)", "")

    explicit = [
        ("Google Chrome", [str(Path(local_app_data) / "Google/Chrome/Application/chrome.exe"), "--incognito"]),
        ("Google Chrome", [str(Path(program_files) / "Google/Chrome/Application/chrome.exe"), "--incognito"]),
        ("Google Chrome", [str(Path(program_files_x86) / "Google/Chrome/Application/chrome.exe"), "--incognito"]),
        ("Microsoft Edge", [str(Path(program_files_x86) / "Microsoft/Edge/Application/msedge.exe"), "--inprivate"]),
        ("Microsoft Edge", [str(Path(program_files) / "Microsoft/Edge/Application/msedge.exe"), "--inprivate"]),
    ]

    for name, command in explicit:
        if command[0] and Path(command[0]).is_file():
            yield name, command

    for executable, private_flag, name in (
        ("chrome", "--incognito", "Google Chrome"),
        ("chrome.exe", "--incognito", "Google Chrome"),
        ("msedge", "--inprivate", "Microsoft Edge"),
        ("msedge.exe", "--inprivate", "Microsoft Edge"),
    ):
        located = shutil.which(executable)
        if located:
            yield name, [located, private_flag]


def open_private_browser(url: str) -> None:
    for name, command in browser_candidates():
        try:
            subprocess.Popen(
                [*command, "--new-window", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            print(f"Opened {url} in {name} private mode.")
            return
        except OSError:
            continue

    print("Could not find Chrome or Edge automatically.")
    print(f"Open this address manually in an Incognito/InPrivate window: {url}")


def launch_browser_after_start(url: str) -> None:
    time.sleep(0.8)
    open_private_browser(url)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Household Hub locally.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Preferred local port (default: 8000)")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Start the server without opening a browser")
    args = parser.parse_args()

    try:
        port = choose_port(args.host, args.port)
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    os.chdir(PROJECT_DIR)
    handler = http.server.SimpleHTTPRequestHandler

    try:
        server = http.server.ThreadingHTTPServer((args.host, port), handler)
    except OSError as exc:
        print(f"Could not start local server: {exc}", file=sys.stderr)
        return 1

    url = f"http://{args.host}:{port}/"
    print("\nHousehold Hub local server is running.")
    print(f"Address: {url}")
    print("Keep this window open while using the app.")
    print("Press Ctrl+C to stop the server.\n")

    if not args.no_browser:
        threading.Thread(target=launch_browser_after_start, args=(url,), daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local server...")
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
