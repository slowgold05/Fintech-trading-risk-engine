from pydantic import BaseModel


class AssetOut(BaseModel):
    id: int
    symbol: str
    asset_type: str
    name: str | None = None

    class Config:
        from_attributes = True
