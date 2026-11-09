from pydantic import BaseModel


class ResearchReportOut(BaseModel):
    id: int
    job_id: int
    symbol: str
    created_at: str
    sources: list[dict]
    bull_case: str | None
    bear_case: str | None
    synthesis: str | None
    risks: str | None
    model_version: str | None
    prompt_version: str | None
    backend_detail: dict | None


class ResearchReportCollection(BaseModel):
    reports: list[ResearchReportOut]
