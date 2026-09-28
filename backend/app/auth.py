"""Resolve a Supabase Auth session to a locally assigned synthetic clinician."""

from dataclasses import dataclass
from uuid import UUID

import httpx
from fastapi import Header, HTTPException, status

from .config import get_settings
from .db import db_cursor


@dataclass(frozen=True)
class Principal:
    id: str
    external_id: str
    display_name: str
    principal_type: str
    synthetic: bool


def _authenticated_user_id(token: str) -> str:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_publishable_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Clinician authentication is not configured.")

    try:
        response = httpx.get(
            settings.supabase_url.rstrip("/") + "/auth/v1/user",
            headers={
                "Authorization": "Bearer " + token,
                "apikey": settings.supabase_publishable_key,
            },
            timeout=5.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Identity service is unavailable.") from exc

    if response.status_code != 200:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session is invalid or expired.")
    try:
        user = response.json()
        if not isinstance(user, dict) or user.get("is_anonymous") is True:
            raise ValueError("Anonymous or malformed Auth user")
        return str(UUID(user["id"]))
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session has no valid clinician identity.") from exc


def get_current_principal(
    authorization: str | None = Header(default=None),
) -> Principal:
    if not authorization or len(authorization) > 8192:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Clinician session required.")
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not token or token.strip() != token or " " in token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bearer session required.")

    user_id = _authenticated_user_id(token)
    with db_cursor() as cur:
        cur.execute(
            """
            select id::text, external_id, display_name, principal_type, synthetic
            from iam.principal
            where auth_user_id = %s::uuid
              and active = true
              and synthetic = true
              and principal_type = 'clinician'
            limit 1
            """,
            (user_id,),
        )
        row = cur.fetchone()

    if not row:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No linked active synthetic clinician.")
    return Principal(**row)
