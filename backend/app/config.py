from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Nephrology Agentic Harness API"
    environment: str = "development"
    database_url: str = ""
    allowed_origins: str = "http://localhost:8000,http://127.0.0.1:8000,https://kidneycareclinic-star.github.io"
    supabase_url: str = ""
    supabase_publishable_key: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [x.strip() for x in self.allowed_origins.split(",") if x.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
