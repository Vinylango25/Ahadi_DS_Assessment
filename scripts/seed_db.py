"""
scripts/seed_db.py
------------------
Seed backend/ahadi.db from data/processed/kenya_population_by_county.csv.
Run from the project root with the ahadi-analytics conda environment:

    conda run -n ahadi-analytics python scripts/seed_db.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pandas as pd
from sqlalchemy import create_engine, func, distinct
from sqlalchemy.orm import sessionmaker

BAKED_DB = os.path.join("backend", "ahadi.db")
CSV_PATH = os.path.join("data", "processed", "kenya_population_by_county.csv")


def main() -> None:
    os.makedirs("backend", exist_ok=True)

    if os.path.exists(BAKED_DB):
        os.remove(BAKED_DB)
        print(f"Removed old {BAKED_DB}")

    engine = create_engine(
        f"sqlite:///{BAKED_DB}",
        connect_args={"check_same_thread": False},
    )

    from backend.database import Base
    import backend.models  # noqa — registers models
    Base.metadata.create_all(bind=engine, checkfirst=True)
    print(f"Tables created in {BAKED_DB}")

    df = pd.read_csv(CSV_PATH)
    print(f"CSV loaded: {len(df)} rows, {len(df.columns)} columns")

    from backend.models import PopulationRecord
    model_cols = {c.key for c in PopulationRecord.__table__.columns if c.key != "id"}
    usable = model_cols & set(df.columns)
    missing = model_cols - set(df.columns)
    if missing:
        print(f"  WARNING — CSV missing model columns (will be NULL): {sorted(missing)}")

    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        records = [
            PopulationRecord(
                **{col: (None if pd.isna(row[col]) else row[col]) for col in usable}
            )
            for _, row in df.iterrows()
        ]
        db.bulk_save_objects(records)
        db.commit()

        count     = db.query(func.count(PopulationRecord.id)).scalar()
        counties  = db.query(distinct(PopulationRecord.county)).count()
        years     = db.query(distinct(PopulationRecord.year)).count()
        total2025 = (
            db.query(func.sum(PopulationRecord.total_population))
              .filter(PopulationRecord.year == 2025)
              .scalar()
        )

        print(f"\n✓ Seeded {count} rows  ({counties} counties × {years} years)")
        print(f"✓ Kenya total population 2025: {total2025:,.0f}")
        print(f"✓ DB written to: {os.path.abspath(BAKED_DB)}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
