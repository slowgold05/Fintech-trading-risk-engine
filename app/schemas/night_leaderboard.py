from datetime import date
import re
from typing import Literal

from pydantic import BaseModel, Field, StrictBool, ValidationInfo, field_validator

from app.schemas.night_notebook import DecimalText, NotebookInput


_ALIAS = re.compile(r"[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*")


class LeaderboardPreference(NotebookInput):
    enabled: StrictBool
    alias: str | None = Field(default=None, validate_default=True)

    @field_validator("alias")
    @classmethod
    def normalize_alias(cls, value: str | None, info: ValidationInfo) -> str | None:
        if value is None:
            if info.data.get("enabled"):
                raise ValueError("Supply a public alias to opt in.")
            return None
        trimmed = re.sub(r" +", " ", value.strip())
        if not 3 <= len(trimmed) <= 24 or _ALIAS.fullmatch(trimmed) is None:
            raise ValueError("Use 3–24 letters or digits, separated by single spaces, hyphens, or underscores.")
        return trimmed


class LeaderboardMe(BaseModel):
    enabled: bool
    alias: str | None


class LeaderboardRow(BaseModel):
    rank: int
    alias: str
    return_ratio: DecimalText


class LeaderboardOut(BaseModel):
    start: date
    end: date
    coverage: Literal["available", "partial", "missing"]
    excluded_count: int
    items: list[LeaderboardRow]
    my_entry: LeaderboardMe
