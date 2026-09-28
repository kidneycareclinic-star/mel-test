from dataclasses import dataclass
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


def get_current_principal(
    x_dev_principal: str | None = Header(default=None, alias="X-Dev-Principal"),
) -> Principal:
    settings = get_settings()

    if settings.environment != "development":
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Production identity provider is not configured yet.",
        )

    external_id = x_dev_principal or settings.dev_principal_external_id
    if external_id != settings.dev_principal_external_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Development principal is not allowed.",
        )

    with db_cursor() as cur:
        cur.execute(
            """
            select id::text, external_id, display_name, principal_type, synthetic
            from iam.principal
            where external_id = %s and active = true
            limit 1
            """,
            (external_id,),
        )
        row = cur.fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Principal not found or inactive.",
        )

    return Principal(**row)
