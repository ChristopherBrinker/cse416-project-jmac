"""Small Convex HTTP client for secret-authenticated provider mutations."""

import json
from dataclasses import dataclass, field
from http.client import HTTPException
from ipaddress import ip_address
from math import isfinite
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_RESPONSE_BYTES = 65_536


class ProviderAPIError(RuntimeError):
    """Only safe, locally defined messages may be exposed to worker logs."""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


def validate_deployment_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
        if not hostname or parsed.username is not None or parsed.password is not None:
            raise ValueError
        if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError
        if any(character.isspace() for character in value):
            raise ValueError
        if port is not None and port == 0:
            raise ValueError
    except ValueError:
        raise ValueError(
            "CONVEX_URL must be a deployment origin without credentials or a path"
        ) from None

    if hostname.endswith(".convex.site"):
        raise ValueError(
            "Use the .convex.cloud deployment URL, not the .convex.site HTTP actions URL"
        )
    loopback = hostname == "localhost"
    try:
        loopback = loopback or ip_address(hostname).is_loopback
    except ValueError:
        pass
    if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
        raise ValueError(
            "CONVEX_URL requires HTTPS, except for local loopback development"
        )
    return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


@dataclass(frozen=True, slots=True)
class ProviderConfig:
    deployment_url: str
    provider_id: str
    secret: str = field(repr=False)
    heartbeat_interval: float = 15.0
    request_timeout: float = 10.0
    max_retries: int = 3

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "deployment_url", validate_deployment_url(self.deployment_url)
        )
        for name, value in (
            ("JMAC_PROVIDER_ID", self.provider_id),
            ("JMAC_PROVIDER_SECRET", self.secret),
        ):
            if not value or any(character.isspace() for character in value):
                raise ValueError(f"{name} must be configured without whitespace")
        for name, value, maximum in (
            ("JMAC_HEARTBEAT_INTERVAL_SECONDS", self.heartbeat_interval, 300),
            ("JMAC_REQUEST_TIMEOUT_SECONDS", self.request_timeout, 60),
        ):
            if not isfinite(value) or not 0.1 <= value <= maximum:
                raise ValueError(f"{name} must be between 0.1 and {maximum} seconds")
        if type(self.max_retries) is not int or not 0 <= self.max_retries <= 5:
            raise ValueError("JMAC_MAX_RETRIES must be an integer between 0 and 5")


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward a request containing the provider secret to another URL.
        return None


class ProviderClient:
    def __init__(self, config: ProviderConfig) -> None:
        self.config = config
        self._opener = build_opener(_NoRedirects())

    def heartbeat(self) -> None:
        self._mutation("provider:heartbeat", {})

    def set_status(self, status: Literal["ready", "offline"]) -> None:
        if status not in ("ready", "offline"):
            raise ValueError("Provider status must be ready or offline")
        self._mutation("provider:setStatus", {"newStatus": status})

    def _mutation(self, path: str, arguments: dict[str, str]) -> None:
        payload = {
            "path": path,
            "args": {
                "providerId": self.config.provider_id,
                "secret": self.config.secret,
                **arguments,
            },
            "format": "json",
        }
        request = Request(
            f"{self.config.deployment_url}/api/mutation",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with self._opener.open(
                request, timeout=self.config.request_timeout
            ) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError as error:
            status = error.code
            error.close()
            retryable = status == 429 or (500 <= status <= 599 and status != 560)
            raise ProviderAPIError(
                f"Provider API returned HTTP {status}.", retryable=retryable
            ) from None
        except (URLError, OSError, HTTPException):
            raise ProviderAPIError(
                "Cannot reach the provider API.", retryable=True
            ) from None

        if len(body) > MAX_RESPONSE_BYTES:
            raise ProviderAPIError("Provider API returned an oversized response.")
        try:
            document = json.loads(body)
        except (ValueError, UnicodeError):
            raise ProviderAPIError("Provider API returned invalid JSON.") from None
        if not isinstance(document, dict) or document.get("status") != "success":
            # Convex errors and logLines can echo request arguments. Never log them.
            raise ProviderAPIError(
                "Provider function failed; check the deployed backend."
            )
        result = document.get("value")
        if not isinstance(result, dict):
            raise ProviderAPIError("Provider API returned an unexpected result.")
        if result.get("success") is True:
            return
        if result.get("error") == "Invalid authentication":
            raise ProviderAPIError(
                "Provider authentication failed; check the provider ID and secret."
            )
        if result.get("error") == "Provider not found":
            raise ProviderAPIError("Provider record was not found in this deployment.")
        raise ProviderAPIError("Provider API rejected the request.")
