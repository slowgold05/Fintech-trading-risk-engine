from pydantic import BaseModel


class ResearchBriefEntry(BaseModel):
    symbol: str
    report_id: int | None


class ResearchBriefOut(BaseModel):
    id: int
    brief_date: str
    created_at: str
    entries: list[ResearchBriefEntry]


class ResearchBriefCollection(BaseModel):
    briefs: list[ResearchBriefOut]
