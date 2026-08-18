from __future__ import annotations

import re
from typing import Any

_PATTERNS = (
    re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----.*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----", re.DOTALL),
    re.compile(r"(?i)(authorization:\s*bearer\s+)[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)\b((?:api[_-]?key|access[_-]?token|secret|password|passphrase|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*)[^\s,;]+"),
    re.compile(r"\b(?:sk|ghp|github_pat)[_-][A-Za-z0-9_\-]{12,}\b"),
    re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
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
            key_text = str(key)
            safe_usage_count = key_text in {
                "input_tokens",
                "output_tokens",
                "total_tokens",
                "cached_tokens",
                "cached_input_tokens",
                "reasoning_tokens",
                "reasoning_output_tokens",
            } and isinstance(item, int)
            if not safe_usage_count and re.search(
                r"(?i)(password|secret|token|api.?key)", key_text
            ):
                output[key] = "[REDACTED]"
                count += 1
            else:
                output[key], found = redact_value(item)
                count += found
        return output, count
    return value, 0
