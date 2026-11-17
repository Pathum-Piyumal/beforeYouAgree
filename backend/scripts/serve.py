"""Container entry point supporting the hosting provider's assigned PORT."""

import os

import uvicorn


def main():
    uvicorn.run(
        "app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), access_log=False
    )


if __name__ == "__main__":
    main()
