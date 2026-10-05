"""FastAPI Application entrypoint for SteMidi Studio."""

import asyncio
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routes import router as api_router
from .session_manager import session_manager

CLIENT_DIST = Path(__file__).resolve().parent.parent / "client" / "dist"

app = FastAPI(
    title="SteMidi Studio API",
    description="High-performance backend for SteMidi Studio Music Transcription",
    version="0.0.1",
)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount REST API
app.include_router(api_router)


@app.on_event("startup")
async def setup_connection_error_handler():
    """Silence benign Windows WinError 10054 socket reset notices when clients disconnect."""
    loop = asyncio.get_running_loop()
    default_handler = loop.get_exception_handler()

    def silence_winerror_10054(loop, context):
        exc = context.get("exception")
        if isinstance(exc, (ConnectionResetError, BrokenPipeError)) or (
            hasattr(exc, "winerror") and exc.winerror == 10054
        ):
            return
        if default_handler:
            default_handler(loop, context)
        else:
            loop.default_exception_handler(context)

    loop.set_exception_handler(silence_winerror_10054)


@app.websocket("/api/ws/{session_id}")
async def websocket_transcription_progress(websocket: WebSocket, session_id: str):
    """Stream real-time progress events for a transcription or separation session."""
    await websocket.accept()
    loop = asyncio.get_running_loop()
    queue = session_manager.register_listener(session_id, loop=loop)
    try:
        # Send initial status
        session = session_manager.sessions.get(session_id)
        if session:
            await websocket.send_json({
                "type": "initial",
                "status": session.status,
                "progress": session.progress,
            })

        while True:
            # Wait for next progress event and send to client
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        session_manager.unregister_listener(session_id, queue)


# Mount compiled frontend if available
if CLIENT_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(CLIENT_DIST), html=True), name="static")
