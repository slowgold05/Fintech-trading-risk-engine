from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.watchlist import WatchlistOut


class WatchlistImport(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    watchlist_id: int = Field(gt=0, le=2_147_483_647)
    symbols: list[str] = Field(min_length=1, max_length=50)
    dry_run: bool

    @field_validator("symbols")
    @classmethod
    def limit_symbol_bytes(cls, symbols: list[str]) -> list[str]:
        try:
            size = sum(len(symbol.encode("utf-8")) for symbol in symbols)
        except UnicodeEncodeError:
            raise ValueError("Symbols must be valid UTF-8 text") from None
        if size > 64 * 1024:
            raise ValueError("Symbols must fit within 64 KiB")
        return symbols


class WatchlistImportRow(BaseModel):
    row: int
    symbol: str
    status: Literal["add", "existing", "invalid", "duplicate"]


class WatchlistImportResult(BaseModel):
    rows: list[WatchlistImportRow]
    added: int
    watchlist: WatchlistOut


class TransferErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, str] | None = None


class TransferError(BaseModel):
    detail: TransferErrorDetail
