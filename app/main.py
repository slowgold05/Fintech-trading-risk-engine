from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.routers import auth, assets, cash, compliance, market, market_history, orders, trades, portfolio, risk, watchlists, research


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop = None
    if settings.scheduled_jobs_enabled:
        from app.services.scheduled_jobs import start_scheduled_jobs
        stop = start_scheduled_jobs()
    try:
        yield
    finally:
        if stop is not None:
            stop()


app = FastAPI(
    lifespan=lifespan,
    title="Fintech Trading & Risk Engine",
    version="1.0.0",
    description="Secure backend for trading, portfolio analytics, and risk assessment",
    docs_url="/docs" if settings.enable_api_docs else None,
    redoc_url="/redoc" if settings.enable_api_docs else None,
    openapi_url="/openapi.json" if settings.enable_api_docs else None,
)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded"},
        headers={"Retry-After": "60"},
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if settings.enable_hsts:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Root / health endpoint
@app.get("/")
def root():
    return {
        "name": "Fintech Trading & Risk Engine",
        **({"docs": "/docs", "openapi": "/openapi.json"} if settings.enable_api_docs else {}),
        "status": "running",
    }


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.post("/token")
def token(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    return auth.login(request=request, response=response, form=form, db=db)


# Register routers
app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(market.router, prefix="/market", tags=["Market"])
app.include_router(market_history.router, prefix="/market", tags=["Market"])
app.include_router(trades.router, prefix="/trades", tags=["Trades"])
app.include_router(orders.router, prefix="/orders", tags=["Orders"])
app.include_router(compliance.router, prefix="/compliance", tags=["Compliance"])
app.include_router(portfolio.router, prefix="/portfolio", tags=["Portfolio"])
app.include_router(risk.router, prefix="/risk", tags=["Risk"])
app.include_router(assets.router, prefix="/assets", tags=["Assets"])
app.include_router(cash.router, prefix="/cash", tags=["Cash"])
app.include_router(watchlists.router, prefix="/watchlists", tags=["Watchlists"])
app.include_router(research.router, prefix="/research", tags=["Research"])
