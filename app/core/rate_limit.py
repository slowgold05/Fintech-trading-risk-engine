from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings

# Limited handlers must take `response: Response`. After the handler returns,
# slowapi writes the rate-limit headers onto that object. A missing response
# raises after the database commit, and the client only sees a 500.
limiter = Limiter(
    key_func=get_remote_address,
    enabled=settings.rate_limit_enabled,
    headers_enabled=True,
)
