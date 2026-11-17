"""Isolated real API for the browser integration suite; never uses the local database."""

import os
import socket
import sys
import tempfile
import threading
from pathlib import Path

import uvicorn


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="before-you-agree-browser-") as directory:
        os.environ.update(
            DATABASE_URL=f"sqlite:///{(Path(directory) / 'browser.db').as_posix()}",
            APP_ENVIRONMENT="development",
            JWT_SECRET="isolated-browser-test-secret-at-least-32-bytes",
            JWT_ALGORITHM="HS256",
            CORS_ORIGINS="*",
            AUTH_RATE_LIMIT_PER_MINUTE="1000",
            LLM_API_KEY="",
            LLM_PROVIDER="mock",
        )
        from app.db.base import Base
        from app.db.session import engine
        from app.main import app

        Base.metadata.create_all(engine)
        try:
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                print(f"BROWSER_API=http://127.0.0.1:{listener.getsockname()[1]}", flush=True)
                server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))

                def stop_on_parent_exit() -> None:
                    sys.stdin.read()
                    server.should_exit = True

                threading.Thread(target=stop_on_parent_exit, daemon=True).start()
                server.run(sockets=[listener])
        finally:
            engine.dispose()


if __name__ == "__main__":
    main()
