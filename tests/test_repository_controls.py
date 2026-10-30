import pytest

from app.scripts import check_repository_controls
from app.services.control_evidence import control_status


def test_repository_controls_require_protected_main_and_passing_head_run(monkeypatch):
    protection = {"required_status_checks": {"strict": True,
                   "contexts": list(check_repository_controls.REQUIRED_JOBS)},
                  "required_pull_request_reviews": {"required_approving_review_count": 0},
                  "enforce_admins": {"enabled": True}}
    latest = [{"databaseId": 42, "headSha": "head", "status": "completed", "conclusion": "success"}]
    run = {"conclusion": "success", "url": "https://github.com/example/actions/runs/42",
           "jobs": [{"name": name, "conclusion": "success"} for name in check_repository_controls.REQUIRED_JOBS]}

    def fake_json(*args):
        return protection if args[1] == "api" else latest if args[1:3] == ("run", "list") else run

    monkeypatch.setattr(check_repository_controls, "_command_json", fake_json)
    results = dict(check_repository_controls.check("owner/repo", "branch", "head"))
    assert all(control_status(control_id, result) == "pass" for control_id, result in results.items())
    assert results["SM-CM-01"]["required_approvals"] == 0

    run["jobs"][0]["conclusion"] = "failure"
    assert control_status("SM-CM-01", dict(check_repository_controls.check("owner/repo", "branch", "head"))["SM-CM-01"]) == "fail"
    with pytest.raises(ValueError, match="does not match"):
        check_repository_controls.check("owner/repo", "branch", "other")
