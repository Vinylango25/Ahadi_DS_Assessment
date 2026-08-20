"""
models.py
---------
SQLAlchemy ORM models for the Ahadi Kenya Population Analytics backend.

Each ``PopulationRecord`` row represents one county × year combination and
stores all derived demographic indicators produced by the data pipeline.
"""

from sqlalchemy import Column, Float, Integer, String, UniqueConstraint

from backend.database import Base


class PopulationRecord(Base):
    """
    ORM model for a single county-year population record.

    Columns
    -------
    id : int
        Auto-incrementing primary key.
    county : str
        County name as it appears in the GADM Level-2 boundary file
        (e.g. ``"Nairobi"``).
    year : int
        Projection year (2021 – 2025).
    total_population : float
        Total population (all ages, both sexes).
    children_under_5 : float
        Population aged 0 – 4 (both sexes).
    working_age : float
        Population aged 15 – 64 (both sexes).
    elderly_65plus : float
        Population aged 65 + (both sexes).
    sex_ratio : float
        Male population / female population × 100.
    dependency_ratio : float
        (children_under_5 + elderly_65plus) / working_age × 100.
    child_dependency_ratio : float
        children_under_5 / working_age × 100.
    elderly_dependency_ratio : float
        elderly_65plus / working_age × 100.
    pct_children : float
        children_under_5 / total_population × 100.
    pct_elderly : float
        elderly_65plus / total_population × 100.
    county_area_km2 : float
        Approximate county area in square kilometres derived from the GADM
        polygon geometry (may be NULL for legacy records).
    """

    __tablename__ = "population_records"

    # ------------------------------------------------------------------
    # Primary key
    # ------------------------------------------------------------------
    id: int = Column(Integer, primary_key=True, index=True, autoincrement=True)

    # ------------------------------------------------------------------
    # Dimensions
    # ------------------------------------------------------------------
    county: str = Column(String(100), nullable=False, index=True)
    year: int = Column(Integer, nullable=False, index=True)

    # ------------------------------------------------------------------
    # Raw population counts
    # ------------------------------------------------------------------
    total_population: float = Column(Float, nullable=True)
    children_under_5: float = Column(Float, nullable=True)
    working_age: float = Column(Float, nullable=True)
    elderly_65plus: float = Column(Float, nullable=True)

    # ------------------------------------------------------------------
    # Derived demographic indicators
    # ------------------------------------------------------------------
    sex_ratio: float = Column(Float, nullable=True)
    dependency_ratio: float = Column(Float, nullable=True)
    child_dependency_ratio: float = Column(Float, nullable=True)
    elderly_dependency_ratio: float = Column(Float, nullable=True)
    pct_children: float = Column(Float, nullable=True)
    pct_elderly: float = Column(Float, nullable=True)

    # ------------------------------------------------------------------
    # Spatial attribute
    # ------------------------------------------------------------------
    county_area_km2: float = Column(Float, nullable=True)

    # ------------------------------------------------------------------
    # Constraints
    # ------------------------------------------------------------------
    __table_args__ = (
        UniqueConstraint("county", "year", name="uq_county_year"),
    )

    def __repr__(self) -> str:
        return (
            f"<PopulationRecord county={self.county!r} year={self.year} "
            f"total_population={self.total_population}>"
        )
