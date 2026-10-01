"""Start with: python -m recorder"""
from __future__ import annotations

import argparse
import webbrowser
from pathlib import Path

from .app import App
from .server import serve


def main() -> None:
    parser = argparse.ArgumentParser(description="Hydro Recorder")
    parser.add_argument("--port", type=int, default=8731)
    parser.add_argument("--data", default=str(Path(__file__).resolve().parent.parent / "data" / "recorder.db"))
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    app, server = App(args.data), None
    for port in range(args.port, args.port + 10):  # step past a port another program already holds
        try:
            server = serve(app, port)
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit(f"Ports {args.port}-{args.port + 9} are all in use by other programs.")
    url = f"http://localhost:{port}"
    print(f"Hydro Recorder is running. Screen: {url}\nRecords are saved in: {args.data}\nLeave this window open. Close it to stop recording.")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
