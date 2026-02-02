from pydantic import BaseModel


class RiskAlertOut(BaseModel):
    rule_code: str
    severity: str
    reason: str

    class Config:
        from_attributes = True
