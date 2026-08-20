# Ahadi Kenya Population Analytics — Build Log & Progress

> **Live build log** tracking what has been implemented so far.  
> This file will be merged into the final `README.md` before submission.

---

## 🏗 What Has Been Built

### ✅ Project Structure
```
Ahadi/
├── README.md                          # Assessment brief (original)
├── README2.md                         # This build log
├── requirements.txt                   # Python dependencies (pinned)
├── environment.yml                    # Conda environment spec
├── .gitignore
├── ai_disclosure.txt                  # Part 0 — AI use disclosure
├── src/                               # Python pipeline (Part 1)
│   ├── __init__.py
│   ├── utils.py                       # Logging, URL builders, constants
│   ├── data_access.py                 # WorldPop download + caching
│   ├── validation.py                  # Data quality checks
│   ├── aggregation.py                 # Raster → county zonal stats
│   └── pipeline.py                   # Orchestration + static plots
├── backend/                           # FastAPI + SQLite (Part 2 API)
│   ├── __init__.py
│   ├── database.py                    # SQLAlchemy engine + session
│   ├── models.py                      # ORM: PopulationRecord
│   ├── schemas.py                     # Pydantic v2 schemas
│   ├── crud.py                        # All DB queries + analytics
│   └── main.py                        # FastAPI app + all endpoints
├── frontend/                          # Angular 20 (Part 2 Dashboard)
│   ├── package.json
│   ├── angular.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.html
│       ├── main.ts
│       ├── styles.scss                # Design system (dark + light)
│       ├── environments/
│       │   ├── environment.ts         # dev: http://localhost:8000
│       │   └── environment.prod.ts    # prod: relative URL
│       └── app/
│           ├── app.component.ts/html/scss  # Shell + nav + theme toggle
│           ├── app.config.ts
│           ├── app.routes.ts
│           ├── core/
│           │   ├── api.service.ts     # All HTTP calls to FastAPI
│           │   └── theme.service.ts   # Dark/light toggle (localStorage)
│           ├── models/
│           │   └── population.model.ts  # TypeScript interfaces
│           ├── features/
│           │   └── dashboard/         # Main dashboard page
│           └── components/
│               ├── choropleth-map/    # Leaflet Kenya map + city markers
│               ├── age-pyramid/       # ECharts population pyramid
│               ├── bar-chart/         # ECharts county comparison
│               ├── summary-cards/     # KPI metric cards
│               ├── interpretation/    # Public health insights panel
│               └── timeseries-chart/  # ECharts animated area chart
├── data/
│   ├── gadm41_KEN_2.json              # Kenya GADM Level 2 boundaries
│   ├── raw/                           # Downloaded WorldPop GeoTIFFs (cached)
│   └── processed/
│       ├── kenya_population_by_county.csv  # Pipeline output
│       └── validation_log.txt
├── outputs/
│   └── figures/                       # Static plots from pipeline
│       ├── map_2025_male_0_to_4.png
│       ├── timeseries_total_population.png
│       └── scatterplot_children_vs_county_size.png
└── tests/
    ├── __init__.py
    ├── test_validation.py
    └── test_aggregation.py
```

---

## ✅ Part 0 — AI Use Disclosure
- `ai_disclosure.txt` created — lists tools used (Kiro CLI / Claude), how used, prompts given, how output was reviewed.

## ✅ Part 1 — Reproducible Data Pipeline

### 1.1 Programmatic Data Access (`src/data_access.py`)
- Constructs WorldPop Kenya URLs: `https://data.worldpop.org/GIS/AgeSex_structures/...`
- Years: 2021–2025; Sexes: male (`m`), female (`f`); Ages: 0,1,5,10,…,80
- Streaming download with `.part` safety files
- **Caching**: skips files already in `data/raw/`
- 3-attempt retry with exponential backoff; graceful 404 handling

### 1.2 Data Validation & Cleaning (`src/validation.py`)
- Parses filename to extract `sex`, `age`, `year`
- Checks all expected age-sex combinations present per year
- Logs missing files with decision (drop vs impute)
- Verifies GADM boundaries CRS = EPSG:4326
- Verifies raster CRS; reprojection if mismatched
- Checks negative values, zero coverage in populated areas
- Writes `data/processed/validation_log.txt`

### 1.3 Spatial Aggregation (`src/aggregation.py`)
- `rasterio` + `shapely` zonal sum per county polygon
- Computes all 10 required indicators:
  - `children_under_5`, `working_age`, `elderly_65plus`, `total_population`
  - `sex_ratio`, `dependency_ratio`, `child_dependency_ratio`, `elderly_dependency_ratio`
  - `pct_children`, `pct_elderly`
- Area in km² via EPSG:6933 equal-area projection

### 1.4 Output Generation (`src/pipeline.py`)
- **CSV**: `data/processed/kenya_population_by_county.csv`
- **Map**: `outputs/figures/map_2025_male_0_to_4.png` — 2025 raster + county boundaries
- **Timeseries**: `outputs/figures/timeseries_total_population.png` — 2021–2025 line chart
- **Scatter**: `outputs/figures/scatterplot_children_vs_county_size.png`

---

## ✅ Part 2 — Interactive Dashboard

### 2.1 Framework
- **Backend**: FastAPI + SQLite (SQLAlchemy) — `uvicorn backend.main:app`
- **Frontend**: Angular 20 (standalone components, signals, ECharts, Leaflet)

### 2.2 Required Features Implemented

#### Filters ✅
- County dropdown (all 47 counties)
- Year (2021–2025)
- Sex toggle: Male / Female / Total
- Indicator dropdown: 11 indicators

#### Visualizations ✅
| Chart | Status | Notes |
|-------|--------|-------|
| Choropleth Map | ✅ | Leaflet, CARTO tiles, dark+light themes |
| City overlays | ✅ | 10 major cities (Nairobi, Mombasa, etc.) |
| Regional borders | ✅ | 8 regions colour-coded |
| Age Pyramid | ✅ | ECharts horizontal butterfly chart |
| Bar Chart | ✅ | Top-10 county comparison, gradient bars |
| Summary Cards | ✅ | 5 KPI cards with animated glows |
| Timeseries | ✅ | ECharts animated area chart 2021–2025 |
| Interpretation | ✅ | Public health collapsible panels |

### 2.3 Public Health Context ✅
- Dependency ratio explanation
- Age structure → health service planning
- Policy implications for Kenya data

---

## 🔄 In Progress / Remaining

- [ ] Write final `dashboard.component.html` template with all sections
- [ ] Write `dashboard.component.scss` styles
- [ ] Write `summary-cards` full template
- [ ] Complete `app.component.ts/html/scss` shell
- [ ] Write `ai_disclosure.txt`
- [ ] Write final comprehensive `README.md`
- [ ] `vercel.json` for deployment
- [ ] Git commit milestones + push to GitHub

---

## 🚀 How to Run (Quick Start)

```bash
# 1. Clone
git clone https://github.com/Vinylango25/Ahadi_DS_Assessment
cd Ahadi_DS_Assessment

# 2. Python environment
conda env create -f environment.yml
conda activate ahadi-analytics

# 3. Run data pipeline
python -m src.pipeline

# 4. Start backend
uvicorn backend.main:app --reload --port 8000

# 5. Start frontend (new terminal)
cd frontend
npm install
npm start
# → http://localhost:4200
```

---

*Last updated: 2026-08-20 — Build in progress*
