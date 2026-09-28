from contextlib import contextmanager
import psycopg
from psycopg.rows import dict_row

from .config import get_settings


@contextmanager
def db_cursor():
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured")

    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            yield cur
