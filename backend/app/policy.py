from dataclasses import dataclass

from .auth import Principal
from .db import db_cursor


@dataclass(frozen=True)
class AuthorizationDecision:
    allowed: bool
    reason: str
    role: str | None = None
    access_level: str | None = None


def authorize_patient_action(
    principal: Principal,
    patient_external_id: str,
    *,
    workspace: str,
    action: str,
) -> AuthorizationDecision:
    with db_cursor() as cur:
        cur.execute(
            """
            select
              pm.role,
              pm.workspaces as membership_workspaces,
              pm.permissions,
              pa.access_level,
              pa.workspaces as assignment_workspaces
            from iam.principal ip
            join iam.practice_membership pm
              on pm.principal_id = ip.id
             and pm.active = true
            join iam.patient_assignment pa
              on pa.principal_id = ip.id
             and pa.practice_id = pm.practice_id
             and pa.active = true
            join ehr.patient p
              on p.id = pa.patient_id
             and p.active = true
            where ip.id = %s::uuid
              and p.external_id = %s
            limit 1
            """,
            (principal.id, patient_external_id),
        )
        row = cur.fetchone()

    if not row:
        return AuthorizationDecision(False, "No active care-team assignment.")

    if workspace not in (row["membership_workspaces"] or []):
        return AuthorizationDecision(
            False,
            "Workspace is outside clinician membership.",
            row["role"],
            row["access_level"],
        )

    if workspace not in (row["assignment_workspaces"] or []):
        return AuthorizationDecision(
            False,
            "Workspace is outside patient assignment.",
            row["role"],
            row["access_level"],
        )

    permissions = row["permissions"] or {}
    if not bool(permissions.get(action, False)):
        return AuthorizationDecision(
            False,
            f"Permission '{action}' is not granted.",
            row["role"],
            row["access_level"],
        )

    return AuthorizationDecision(
        True,
        "Authorized by active practice membership and patient assignment.",
        row["role"],
        row["access_level"],
    )
