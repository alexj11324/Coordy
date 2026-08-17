from __future__ import annotations

import re
from typing import Any

_PATTERNS = (
    re.compile(r"(?i)(authorization:\s*bearer\s+)[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)\b((?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*)[^\s,;]+"),
    re.compile(r"\b(?:sk|ghp|github_pat)_[A-Za-z0-9_\-]{12,}\b"),
)


def redact_text(text: str) -> tuple[str, int]:
    redactions = 0
    for pattern in _PATTERNS:
        text, count = pattern.subn(lambda match: (match.group(1) if match.lastindex else "") + "[REDACTED]", text)
        redactions += count
    return text, redactions


def redact_value(value: Any) -> tuple[Any, int]:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        output, count = [], 0
        for item in value:
            clean, found = redact_value(item)
            output.append(clean)
            count += found
        return output, count
    if isinstance(value, dict):
        output, count = {}, 0
        for key, item in value.items():
            if re.search(r"(?i)(password|secret|token|api.?key)", str(key)):
                output[key] = "[REDACTED]"
                count += 1
            else:
                output[key], found = redact_value(item)
                count += found
        return output, count
    return value, 0
