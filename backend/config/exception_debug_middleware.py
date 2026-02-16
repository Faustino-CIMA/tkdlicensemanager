import json
import time
import traceback
from pathlib import Path


def _agent_debug_log(hypothesis_id: str, message: str, data: dict[str, object]) -> None:
    candidate_paths = [
        Path("/home/faustino/Developments/Applications/tkdlicensemanager/.cursor/debug.log"),
        Path("/app/.cursor/debug.log"),
    ]
    payload = {
        "id": f"exc_{int(time.time() * 1000)}",
        "timestamp": int(time.time() * 1000),
        "runId": "admin-500-v2",
        "hypothesisId": hypothesis_id,
        "location": "backend/config/exception_debug_middleware.py",
        "message": message,
        "data": data,
    }
    for log_path in candidate_paths:
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=True) + "\n")
            break
        except OSError:
            continue
    # region agent log
    print(json.dumps(payload, ensure_ascii=True), flush=True)
    # endregion


class ExceptionDebugMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        if request.path.startswith("/admin"):
            tb = traceback.extract_tb(exception.__traceback__)
            last_frame = tb[-1] if tb else None
            _agent_debug_log(
                "H3_H4_H5",
                "Admin exception captured",
                {
                    "path": request.path,
                    "method": request.method,
                    "exception_type": exception.__class__.__name__,
                    "exception_message": str(exception),
                    "last_frame_file": (last_frame.filename if last_frame else ""),
                    "last_frame_line": (last_frame.lineno if last_frame else 0),
                    "last_frame_name": (last_frame.name if last_frame else ""),
                },
            )
        return None
