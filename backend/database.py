"""
database.py
-----------
SQLAlchemy database engine, session factory, and declarative base for the
Ahadi Kenya Population Analytics backend.

The database is stored as a local SQLite file (ahadi.db) next to wherever
the application is started from.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# ---------------------------------------------------------------------------
# Database URL
# ---------------------------------------------------------------------------
DATABASE_URL = "sqlite:///./ahadi.db"

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
engine = create_engine(
    DATABASE_URL,
    # SQLite requires connect_args to allow usage across threads (FastAPI
    # uses a thread-pool executor for sync DB calls).
    connect_args={"check_same_thread": False},
    echo=False,
)

# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


# ---------------------------------------------------------------------------
# Declarative base
# ---------------------------------------------------------------------------
class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""
    pass


# ---------------------------------------------------------------------------
# Dependency — FastAPI dependency injection helper
# ---------------------------------------------------------------------------
def get_db():
    """
    Yield a SQLAlchemy database session and ensure it is closed after use.

    Intended to be used as a FastAPI dependency::

        @app.get("/example")
        def example(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Database initialisation
# ---------------------------------------------------------------------------
def init_db() -> None:
    """
    Create all tables defined by ORM models if they do not already exist.

    Import *models* before calling this function so SQLAlchemy can discover
    every model class that inherits from ``Base``.
    """
    # Local import prevents circular imports at module load time.
    from backend import models  # noqa: F401  — side-effect import registers models

    Base.metadata.create_all(bind=engine)
