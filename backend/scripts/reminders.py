"""Run once, or use --loop as a separate durable database-backed scheduler process."""

import argparse
import time

from app.db.session import SessionLocal
from app.services.reminders import promote_due


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", action="store_true")
    args = parser.parse_args()
    while True:
        try:
            with SessionLocal() as db:
                count = promote_due(db)
                print(f"Account reminders marked due: {count}", flush=True)
        except Exception:
            if not args.loop:
                raise
            print("Reminder database unavailable; retrying in 60 seconds", flush=True)
        if not args.loop:
            break
        time.sleep(60)


if __name__ == "__main__":
    main()
