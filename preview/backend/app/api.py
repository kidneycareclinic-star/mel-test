from fastapi import APIRouter, Depends, HTTPException, status

from .auth import Principal, get_current_principal
from .db import db_cursor
from .policy import authorize_patient_action

router = APIRouter(prefix="/v1")


@router.get("/me")
def me(principal: Principal = Depends(get_current_principal)):
    return {
        "id": principal.id,
        "externalId": principal.external_id,
        "displayName": principal.display_name,
        "principalType": principal.principal_type,
        "synthetic": principal.synthetic,
    }


@router.get("/patients")
def patient_census(
    workspace: str = "office",
    principal: Principal = Depends(get_current_principal),
):
    with db_cursor() as cur:
        cur.execute(
            """
            select
              p.external_id,
              p.display_name,
              pa.access_level,
              ps.state_version,
              ps.generated_at,
              ps.engine_version,
              ps.state
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
            join lateral (
              select state_version, generated_at, engine_version, state
              from ehr.patient_state
              where patient_id = p.id
              order by state_version desc
              limit 1
            ) ps on true
            where ip.id = %s::uuid
              and %s = any(pm.workspaces)
              and %s = any(pa.workspaces)
              and coalesce((pm.permissions ->> 'patient.read')::boolean, false) = true
            order by p.external_id
            """,
            (principal.id, workspace, workspace),
        )
        rows = cur.fetchall()

    return {
        "source": "fastapi-postgresql",
        "workspace": workspace,
        "count": len(rows),
        "patients": [
            {
                "externalId": row["external_id"],
                "displayName": row["display_name"],
                "accessLevel": row["access_level"],
                "stateVersion": row["state_version"],
                "generatedAt": row["generated_at"],
                "engineVersion": row["engine_version"],
                "state": row["state"],
            }
            for row in rows
        ],
    }


@router.get("/patients/{patient_external_id}/state")
def patient_state(
    patient_external_id: str,
    workspace: str = "office",
    principal: Principal = Depends(get_current_principal),
):
    decision = authorize_patient_action(
        principal,
        patient_external_id,
        workspace=workspace,
        action="patient.read",
    )
    if not decision.allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=decision.reason,
        )

    with db_cursor() as cur:
        cur.execute(
            """
            select
              p.external_id,
              p.display_name,
              ps.state_version,
              ps.generated_at,
              ps.engine_version,
              ps.state
            from ehr.patient p
            join lateral (
              select state_version, generated_at, engine_version, state
              from ehr.patient_state
              where patient_id = p.id
              order by state_version desc
              limit 1
            ) ps on true
            where p.external_id = %s
              and p.synthetic = true
            limit 1
            """,
            (patient_external_id,),
        )
        row = cur.fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Synthetic patient not found.",
        )

    return {
        "source": "fastapi-postgresql",
        "authorization": {
            "role": decision.role,
            "accessLevel": decision.access_level,
            "workspace": workspace,
        },
        "patient": {
            "externalId": row["external_id"],
            "displayName": row["display_name"],
            "stateVersion": row["state_version"],
            "generatedAt": row["generated_at"],
            "engineVersion": row["engine_version"],
            "state": row["state"],
        },
    }
