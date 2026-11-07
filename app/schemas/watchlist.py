from pydantic import BaseModel, ConfigDict, field_validator, model_validator


def _symbol(value: str) -> str:
    symbol = value.strip().upper()
    if not 1 <= len(symbol) <= 20:
        raise ValueError("symbol must contain 1 to 20 characters")
    return symbol


class WatchlistCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: str

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        name = value.strip()
        if not 1 <= len(name) <= 40:
            raise ValueError("name must contain 1 to 40 characters")
        return name


class WatchlistSymbolCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    symbol: str

    @field_validator("symbol")
    @classmethod
    def clean_symbol(cls, value: str) -> str:
        return _symbol(value)


class WatchlistPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: str | None = None
    symbol_order: list[str] | None = None

    @model_validator(mode="before")
    @classmethod
    def required_fields(cls, data):
        if not isinstance(data, dict):
            return data
        if "name" in data and data["name"] is None:
            raise ValueError("name cannot be null")
        if "symbol_order" in data and data["symbol_order"] is None:
            raise ValueError("symbol_order cannot be null")
        if "name" not in data and "symbol_order" not in data:
            raise ValueError("name or symbol_order is required")
        return data

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        name = value.strip()
        if not 1 <= len(name) <= 40:
            raise ValueError("name must contain 1 to 40 characters")
        return name

    @field_validator("symbol_order")
    @classmethod
    def clean_order(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        if len(value) > 50:
            raise ValueError("symbol_order cannot contain more than 50 symbols")
        cleaned: list[str] = []
        seen: set[str] = set()
        for raw in value:
            symbol = _symbol(raw)
            if symbol in seen:
                raise ValueError("symbol_order cannot contain duplicates")
            seen.add(symbol)
            cleaned.append(symbol)
        return cleaned


class WatchlistSymbolOut(BaseModel):
    symbol: str
    position: int


class WatchlistOut(BaseModel):
    id: int
    name: str
    symbols: list[WatchlistSymbolOut]


class WatchlistCollection(BaseModel):
    watchlists: list[WatchlistOut]
