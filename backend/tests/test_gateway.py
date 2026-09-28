"""Access tests using a simulated Auth server and database; no patient data leaves CI."""

from contextlib import contextmanager
from types import SimpleNamespace

from fastapi.testclient import TestClient
import httpx
import pytest

from app import api, auth, policy
from app.main import app


USER_ID = "11111111-1111-4111-8111-111111111111"
PRINCIPAL_ID = "22222222-2222-4222-8222-222222222222"
PATIENT_ID = "33333333-3333-4333-8333-333333333333"


@pytest.fixture
def gateway(monkeypatch):
    state = {"linked": True, "assigned": True, "workspace": "office", "permission": True, "audits": []}
    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(
        supabase_url="https://synthetic-project.supabase.co",
        supabase_publishable_key="public-test-key",
    ))

    def auth_get(url, *, headers, timeout):
        assert url == "https://synthetic-project.supabase.co/auth/v1/user"
        assert headers["apikey"] == "public-test-key"
        assert timeout == 5.0
        if headers["Authorization"] == "Bearer invalid":
            return httpx.Response(401)
        return httpx.Response(200, json={"id": USER_ID, "is_anonymous": False})

    monkeypatch.setattr(auth.httpx, "get", auth_get)

    class Cursor:
        def execute(self, query, params):
            self.query = query
            self.params = params
            if "insert into iam.access_audit" in query:
                state["audits"].append(params)

        def fetchone(self):
            if "from iam.principal ip" in self.query:
                if not state["assigned"]:
                    return None
                return dict(patient_id=PATIENT_ID, role="physician", access_level="care_team",
                            membership_workspaces=[state["workspace"]],
                            assignment_workspaces=["office"],
                            permissions={"patient.read": state["permission"]})
            if "from iam.principal" in self.query:
                assert self.params == (USER_ID,)
                if not state["linked"]:
                    return None
                return dict(id=PRINCIPAL_ID, external_id="SYN-CLINICIAN-001",
                            display_name="Synthetic Clinician", principal_type="clinician", synthetic=True)
            if "from ehr.patient p" in self.query:
                return dict(external_id="PT-001", display_name="Synthetic Patient",
                            state_version=1, generated_at=None, engine_version="v1", state={"id": "PT-001"})
            raise AssertionError("Unexpected query: " + self.query)

        def fetchall(self):
            if "from iam.principal ip" in self.query:
                return [dict(external_id="PT-001", display_name="Synthetic Patient", access_level="care_team",
                             state_version=1, generated_at=None, engine_version="v1", state={"id": "PT-001"})]
            raise AssertionError("Unexpected query: " + self.query)

    @contextmanager
    def cursor():
        yield Cursor()

    for module in (auth, api, policy):
        monkeypatch.setattr(module, "db_cursor", cursor)
    return state, TestClient(app)


def test_header_impersonation_cannot_authenticate(gateway):
    state, client = gateway
    response = client.get("/v1/me", headers={"X-Dev-Principal": "SYN-CLINICIAN-001"})
    assert response.status_code == 401
    assert state["audits"] == []


def test_invalid_auth_session_is_rejected(gateway):
    _, client = gateway
    assert client.get("/v1/me", headers={"Authorization": "Bearer invalid"}).status_code == 401


def test_identity_service_failure_does_not_grant_access(gateway, monkeypatch):
    _, client = gateway

    def unavailable(*args, **kwargs):
        raise httpx.ConnectError("unavailable")

    monkeypatch.setattr(auth.httpx, "get", unavailable)
    assert client.get("/v1/me", headers={"Authorization": "Bearer valid"}).status_code == 503


def test_anonymous_auth_user_is_denied(gateway, monkeypatch):
    _, client = gateway
    monkeypatch.setattr(auth.httpx, "get", lambda *args, **kwargs: httpx.Response(
        200, json={"id": USER_ID, "is_anonymous": True}
    ))
    assert client.get("/v1/me", headers={"Authorization": "Bearer valid"}).status_code == 401


def test_authenticated_but_unlinked_user_is_denied(gateway):
    state, client = gateway
    state["linked"] = False
    assert client.get("/v1/me", headers={"Authorization": "Bearer valid"}).status_code == 403


def test_assigned_patient_can_be_read_and_access_is_audited(gateway):
    state, client = gateway
    response = client.get("/v1/patients/PT-001/state?workspace=office",
                          headers={"Authorization": "Bearer valid"})
    assert response.status_code == 200
    assert response.json()["patient"]["state"]["id"] == "PT-001"
    assert state["audits"][-1][0:5] == (PRINCIPAL_ID, PATIENT_ID, "patient.read", "office", True)


def test_unassigned_patient_is_denied_and_audited(gateway):
    state, client = gateway
    state["assigned"] = False
    response = client.get("/v1/patients/PT-002/state?workspace=office",
                          headers={"Authorization": "Bearer valid"})
    assert response.status_code == 403
    assert state["audits"][-1][1] is None
    assert state["audits"][-1][4] is False


@pytest.mark.parametrize("change", [{"workspace": "hospital"}, {"permission": "true"}, {"permission": False}])
def test_out_of_scope_or_ungranted_permission_is_denied(gateway, change):
    state, client = gateway
    state.update(change)
    response = client.get("/v1/patients/PT-001/state?workspace=office",
                          headers={"Authorization": "Bearer valid"})
    assert response.status_code == 403
    assert state["audits"][-1][4] is False


def test_census_read_is_audited(gateway):
    state, client = gateway
    response = client.get("/v1/patients?workspace=office", headers={"Authorization": "Bearer valid"})
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert state["audits"][-1][0:5] == (PRINCIPAL_ID, None, "patient.read", "office", True)
