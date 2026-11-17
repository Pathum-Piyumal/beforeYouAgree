import json
from uuid import uuid4


class BodyLimitMiddleware:
    """Bound request buffering before JSON parsing, including chunked uploads."""

    def __init__(self, app, limit=1_000_000):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        messages, total = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            total += len(message.get("body", b""))
            if total > self.limit:
                body = json.dumps(
                    {
                        "error": {
                            "code": "REQUEST_TOO_LARGE",
                            "message": "Request exceeds the 1 MB limit",
                            "request_id": str(uuid4()),
                        }
                    }
                ).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [(b"content-type", b"application/json")],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
            messages.append(message)
            if not message.get("more_body", False):
                break
        iterator = iter(messages)

        async def replay():
            return next(iterator, {"type": "http.disconnect"})

        await self.app(scope, replay, send)
