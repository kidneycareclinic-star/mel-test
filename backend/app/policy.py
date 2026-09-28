from dataclasses import dataclass
from uuid import UUID

from .auth import Principal
from .db import db_cursor


@dataclass(frozen=True)
class AuthorizationDecision:
    allowed: bool
    reason: str
    role: str | None = None
    access_level: str | None = None
    patient_id: str | None = None


def record_access_decision(
    principal: Principal,
    patient_id: str | None,
    *,
    workspace: str,
    action: str,
    decision: AuthorizationDecision,
) -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            insert into iam.access_audit(
              principal_id,
              patient_id,
              action,
              workspace,
              allowed,
              reason
            )
            values (%s::uuid, %s::uuid, %s, %s, %s, %s)
            """,
            (
                principal.id,
                patient_id,
                action,
                workspace,
                decision.allowed,
                decision.reason,
            ),
        )


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
              p.id::text as patient_id,
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
             and p.synthetic = true
            where ip.id = %s::uuid
              and ip.active = true
              and ip.synthetic = true
              and ip.principal_type = 'clinician'
              and p.external_id = %s
            limit 1
            """,
            (principal.id, patient_external_id),
        )
        row = cur.fetchone()

    if not row:
        decision = AuthorizationDecision(
            False,
            "No active care-team assignment.",
        )
        record_access_decision(
            principal,
            None,
            workspace=workspace,
            action=action,
            decision=decision,
        )
        return decision

    patient_id = row["patient_id"]

    if workspace not in (row["membership_workspaces"] or []):
        decision = AuthorizationDecision(
            False,
            "Workspace is outside clinician membership.",
            row["role"],
            row["access_level"],
            patient_id,
        )
        record_access_decision(
            principal,
            patient_id,
            workspace=workspace,
            action=action,
            decision=decision,
        )
        return decision

    if workspace not in (row["assignment_workspaces"] or []):
        decision = AuthorizationDecision(
            False,
            "Workspace is outside patient assignment.",
            row["role"],
            row["access_level"],
            patient_id,
        )
        record_access_decision(
            principal,
            patient_id,
            workspace=workspace,
            action=action,
            decision=decision,
        )
        return decision

    permissions = row["permissions"] or {}
    if permissions.get(action) is not True:
        decision = AuthorizationDecision(
            False,
            f"Permission '{action}' is not granted.",
            row["role"],
            row["access_level"],
            patient_id,
        )
        record_access_decision(
            principal,
            patient_id,
            workspace=workspace,
            action=action,
            decision=decision,
        )
        return decision

    decision = AuthorizationDecision(
        True,
        "Authorized by active practice membership and patient assignment.",
        row["role"],
        row["access_level"],
        patient_id,
    )
    record_access_decision(
        principal,
        patient_id,
        workspace=workspace,
        action=action,
        decision=decision,
    )
    return decision
