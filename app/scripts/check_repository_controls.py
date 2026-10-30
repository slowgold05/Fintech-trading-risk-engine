"""Record GitHub change-gate and secret-scan evidence for the checked-out commit."""

import argparse
import json
import subprocess

from app.services.control_evidence import control_status, write_evidence


REQUIRED_JOBS = {"backend", "frontend", "secrets", "python-security", "static-analysis", "dependency-scan"}


def _command_json(*args: str):
    return json.loads(subprocess.run(args, check=True, capture_output=True, text=True).stdout)


def check(repo: str, branch: str, head_sha: str) -> list[tuple[str, dict]]:
    protection = _command_json("gh", "api", f"repos/{repo}/branches/main/protection")
    runs = _command_json("gh", "run", "list", "--repo", repo, "--branch", branch,
                         "--event", "push", "--limit", "1", "--json",
                         "databaseId,headSha,status,conclusion")
    if not runs or runs[0]["headSha"] != head_sha:
        raise ValueError("Latest push CI run does not match the checked-out commit")
    if runs[0]["status"] != "completed":
        raise RuntimeError("Latest push CI run has not completed")
    run = _command_json("gh", "run", "view", str(runs[0]["databaseId"]), "--repo", repo,
                        "--json", "conclusion,jobs,url")
    jobs = {job["name"]: job["conclusion"] for job in run["jobs"]}
    contexts = set((protection.get("required_status_checks") or {}).get("contexts") or [])
    violations = [name for name in sorted(REQUIRED_JOBS) if name not in contexts or jobs.get(name) != "success"]
    if not protection.get("required_pull_request_reviews"):
        violations.append("pull request requirement")
    if not (protection.get("required_status_checks") or {}).get("strict"):
        violations.append("up-to-date branch requirement")
    if not (protection.get("enforce_admins") or {}).get("enabled"):
        violations.append("administrator enforcement")
    if run["conclusion"] != "success":
        violations.append("CI run conclusion")

    change = {"checked": len(REQUIRED_JOBS) + 4, "violation_count": len(violations),
              "violations": violations, "commit": head_sha, "run_url": run["url"],
              "required_approvals": protection["required_pull_request_reviews"].get("required_approving_review_count", 0)
              if protection.get("required_pull_request_reviews") else None}
    secrets = {"checked": 1, "violation_count": int(jobs.get("secrets") != "success"),
               "violations": [] if jobs.get("secrets") == "success" else ["Gitleaks CI job"],
               "commit": head_sha, "run_url": run["url"]}
    return [("SM-CM-01", change), ("SM-SM-01", secrets)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Check the latest push CI run and main-branch protection.")
    parser.add_argument("--repo", required=True)
    parser.add_argument("--branch", required=True)
    args = parser.parse_args()
    head_sha = subprocess.run(["git", "rev-parse", "HEAD"], check=True,
                              capture_output=True, text=True).stdout.strip()
    results = []
    for control_id, result in check(args.repo, args.branch, head_sha):
        path, digest = write_evidence(control_id, result)
        status = control_status(control_id, result)
        results.append({"control_id": control_id, "status": status, "evidence": str(path), "sha256": digest})
    print(json.dumps(results, sort_keys=True))
    if any(item["status"] != "pass" for item in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
