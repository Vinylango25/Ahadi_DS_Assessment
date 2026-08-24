# Ahadi Kenya Population Analytics

> **AHADI Data Scientist Technical Assessment Submission**  
> Kenya county-level demographic analytics: reproducible data pipeline + interactive full-stack dashboard

🌍 **Live Demo:** [https://frontend-sandy-tau-56.vercel.app/dashboard](https://frontend-sandy-tau-56.vercel.app/dashboard)  
📦 **Repository:** [https://github.com/Vinylango25/Ahadi_DS_Assessment](https://github.com/Vinylango25/Ahadi_DS_Assessment)

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Public Health Context](#public-health-context)
3. [Repository Structure](#repository-structure)
4. [Quick Start](#quick-start)
5. [Part 0 — AI Use Disclosure](#part-0--ai-use-disclosure)
6. [Part 1 — Reproducible Data Pipeline](#part-1--reproducible-data-pipeline)
7. [Part 2 — Interactive Dashboard](#part-2--interactive-dashboard)
8. [Part 3 — Code Quality & Documentation](#part-3--code-quality--documentation)
9. [Deployment](#deployment)
10. [Environment Variables](#environment-variables)
11. [Tests](#tests)
12. [Assumptions & Decisions](#assumptions--decisions)

---

## Project Overview

This project processes 2021–2025 [WorldPop](https://www.worldpop.org/) age- and sex-structured population raster data for Kenya, aggregates it to all 47 counties using zonal statistics, stores the results in a SQLite database, and serves them through an interactive full-stack dashboard.

**Tech stack:**

| Layer | Technology |
|-------|-----------|
| Data pipeline | Python 3.10+, rasterio, geopandas, pandas |
| Backend API | FastAPI + SQLite (SQLAlchemy ORM) |
| Frontend | Angular 19 (standalone components, signals) |
| Charts | Apache ECharts (ngx-echarts) |
| Map | Leaflet.js |
| AI Insights | Groq API (LLaMA 3.1-8b-instant) |
| Deployment | Vercel (frontend) + Render Docker (backend) |

---

## Public Health Context

The Kenyan Ministry of Health needs county-level age structure data to plan equitable health interventions:

- **Children under 5** require routine immunisations, paediatric care, and nutrition programmes
- **Working-age population (15–64)** represents both the economic base and the primary health workforce
- **Elderly (65+)** have increasing chronic disease and geriatric care needs
- **Dependency ratio** — the ratio of dependents to working-age people — directly drives health financing pressure

This dashboard allows policymakers to explore these patterns across all 47 counties for any year from 2021 to 2025, broken down by sex and indicator, to support data-driven resource allocation decisions.

---

## Repository Structure

```
Ahadi/
├── README.md                          # This file
├── requirements.txt                   # Python dependencies (pinned versions)
├── environment.yml                    # Conda environment spec
├── .gitignore
├── .env.example                       # Environment variables template
├── .vercelignore                      # Excludes backend from Vercel build
├── ai_disclosure.txt                  # Part 0 — AI use disclosure
├── Dockerfile                         # Backend container image
├── docker-compose.yml                 # Full-stack local dev (backend + frontend)
│
├── src/                               # Python data pipeline (Part 1)
│   ├── __init__.py
│   ├── utils.py                       # Logging, URL builders, shared constants
│   ├── data_access.py                 # WorldPop streaming download + caching
│   ├── validation.py                  # CRS checks, file completeness, data quality
│   ├── aggregation.py                 # Raster → county zonal statistics
│   └── pipeline.py                   # Pipeline orchestration + static plots
│
├── backend/                           # FastAPI REST API (Part 2 backend)
│   ├── __init__.py
│   ├── database.py                    # SQLAlchemy engine + session factory
│   ├── models.py                      # ORM model: PopulationRecord
│   ├── schemas.py                     # Pydantic v2 request/response schemas
│   ├── crud.py                        # All DB queries + computed analytics
│   ├── main.py                        # FastAPI app, CORS, all endpoints
│   └── ai_insights.py                 # Groq LLM integration for AI panel
│
├── frontend/                          # Angular 19 dashboard (Part 2 frontend)
│   ├── vercel.json                    # Vercel deployment config
│   ├── package.json
│   ├── angular.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.html
│       ├── main.ts
│       ├── styles.scss                # Global design system (dark + light theme)
│       ├── environments/
│       │   ├── environment.ts         # dev → http://localhost:8000
│       │   └── environment.prod.ts    # prod → relative URL
│       └── app/
│           ├── app.component.*        # Root shell, top nav, dark/light toggle
│           ├── app.config.ts          # Angular providers (HTTP, ECharts)
│           ├── app.routes.ts          # Lazy-loaded routes
│           ├── core/
│           │   ├── api.service.ts     # All HTTP calls to FastAPI backend
│           │   └── theme.service.ts   # Dark/light mode (persisted to localStorage)
│           ├── models/
│           │   └── population.model.ts  # TypeScript interfaces
│           ├── features/
│           │   ├── dashboard/         # Main analytics dashboard page
│           │   └── pipeline-runner/   # Pipeline trigger + status UI
│           └── components/
│               ├── choropleth-map/    # Leaflet Kenya choropleth + city markers
│               ├── age-pyramid/       # ECharts horizontal butterfly chart
│               ├── bar-chart/         # ECharts top-10 county comparison
│               ├── summary-cards/     # KPI metric cards
│               ├── interpretation/    # Public health context panel
│               └── timeseries-chart/  # ECharts animated area chart
│
├── data/
│   ├── gadm41_KEN_2.json              # Kenya GADM Level 2 county boundaries
│   ├── raw/                           # Downloaded WorldPop GeoTIFFs (cached, gitignored)
│   └── processed/
│       ├── kenya_population_by_county.csv  # Pipeline primary output
│       └── validation_log.txt
│
├── outputs/
│   └── figures/
│       ├── map_2025_male_0_to_4.png
│       ├── timeseries_total_population.png
│       └── scatterplot_children_vs_county_size.png
│
└── tests/
    ├── __init__.py
    ├── test_validation.py
    └── test_aggregation.py
```

---

## Quick Start

### Option A — Docker (full stack, recommended)

```bash
git clone https://github.com/Vinylango25/Ahadi_DS_Assessment
cd Ahadi_DS_Assessment

# Configure environment
cp .env.example .env
# Edit .env — add GROQ_API_KEY for AI insights (optional)

# Build and start everything
docker-compose up --build
```

| Service | URL |
|---------|-----|
| Frontend dashboard | http://localhost:4200 |
| Backend API | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |

### Option B — Manual setup

**1. Create Python environment**

```bash
# Conda (recommended — handles GDAL/rasterio binaries)
conda env create -f environment.yml
conda activate ahadi-analytics

# Or pip
python -m venv .venv
source .venv/bin/activate        # macOS/Linux
.venv\Scripts\activate           # Windows
pip install -r requirements.txt
```

**2. Run the data pipeline**

```bash
# Downloads WorldPop rasters, validates, aggregates, saves CSV + plots
python -m src.pipeline
```

Outputs:
- `data/processed/kenya_population_by_county.csv`
- `data/processed/validation_log.txt`
- `outputs/figures/*.png`

**3. Start the backend API**

```bash
# First run loads the CSV into SQLite automatically
uvicorn backend.main:app --reload --port 8000
```

**4. Start the Angular frontend**

```bash
cd frontend
npm install
npm start
# → http://localhost:4200
```

---

## Part 0 — AI Use Disclosure

Full disclosure is in [`ai_disclosure.txt`](./ai_disclosure.txt). Summary:

- **Kiro CLI (Claude Sonnet)** was used throughout the session for architecture planning, code scaffolding, build debugging, and deployment configuration
- **Groq API (LLaMA 3.1-8b-instant)** powers the runtime AI insights feature inside the dashboard (requires user-provided `GROQ_API_KEY`)
- All AI-generated code was reviewed, build-verified (`ng build`, `pytest`), and manually inspected before each commit
- All design decisions, data modelling choices, and architectural trade-offs were directed by the candidate

---

## Part 1 — Reproducible Data Pipeline

### 1.1 Programmatic Data Access (`src/data_access.py`)

Constructs WorldPop Kenya URL pattern:
```
https://data.worldpop.org/GIS/AgeSex_structures/Global_2000_2020_1km_UNadj/
  unconstrained/{year}/KEN/ken_{sex}_{age}_{year}.tif
```

- **Years:** 2021–2025 | **Sexes:** `m`, `f` | **Ages:** 0, 1, 5, 10, …, 80
- Streaming download with `.part` safety files (atomic rename on completion)
- **Caching:** skips files already present in `data/raw/` — no redundant downloads
- 3 retry attempts with exponential backoff; graceful 404 handling and logging

> **Data availability note:** The WorldPop `Global_2000_2020` unconstrained dataset covers years up to 2020 only. The pipeline code is structured for 2021–2025 as specified in the assessment. Since the 2021–2025 rasters return 404, the processed CSV (`data/processed/kenya_population_by_county.csv`) was generated using `generate_population_data.py`, which applies 2009–2019 KNBS intercensal county-specific growth rates to the official 2019 Kenya census baseline to project 2021–2025 values. All 10 required indicators are computed identically to the raster pipeline.

### 1.2 Data Validation & Cleaning (`src/validation.py`)

- Parses filenames to extract sex, age group, and year
- Verifies all expected age-sex combinations are present per year; logs any missing
- Verifies GADM boundaries CRS = EPSG:4326; reprojection applied if mismatched
- Checks all rasters for negative values and implausibly zero-populated county areas
- All decisions and outcomes written to `data/processed/validation_log.txt`

### 1.3 Spatial Aggregation (`src/aggregation.py`)

Uses `rasterio` + `shapely` mask operations for zonal sum per county polygon.

Computes all 10 required demographic indicators:

| Indicator | Formula |
|-----------|---------|
| `total_population` | Σ all age groups, both sexes |
| `children_under_5` | Σ age 0–4, both sexes |
| `working_age` | Σ age 15–64, both sexes |
| `elderly_65plus` | Σ age 65+, both sexes |
| `sex_ratio` | (male / female) × 100 |
| `dependency_ratio` | (children + elderly) / working_age × 100 |
| `child_dependency_ratio` | children / working_age × 100 |
| `elderly_dependency_ratio` | elderly / working_age × 100 |
| `pct_children` | children / total × 100 |
| `pct_elderly` | elderly / total × 100 |

County area (km²) computed via EPSG:6933 equal-area projection.

### 1.4 Output Generation

| Output | Path |
|--------|------|
| Population CSV | `data/processed/kenya_population_by_county.csv` |
| Validation log | `data/processed/validation_log.txt` |
| 2025 raster map — male age 0–4 | `outputs/figures/map_2025_male_0_to_4.png` |
| National timeseries 2021–2025 | `outputs/figures/timeseries_total_population.png` |
| Children vs county area scatter | `outputs/figures/scatterplot_children_vs_county_size.png` |

---

## Part 2 — Interactive Dashboard

### Dashboard Features

#### Filters — all interactive, work together
- County dropdown — all 47 counties + national view
- Year slider — 2021 to 2025
- Sex toggle — Male / Female / Total
- Indicator dropdown — 11 demographic indicators

#### Visualisations

| Component | Technology | Description |
|-----------|-----------|-------------|
| **Choropleth Map** | Leaflet.js | County fill by selected indicator; CARTO tile layer; dark + light themes; hover tooltips; 10 major city overlays; 8 regional boundary layers |
| **Age Pyramid** | ECharts | Horizontal butterfly chart split by sex; updates on county selection |
| **County Bar Chart** | ECharts | Top-10 county comparison with gradient fill; sortable by any indicator |
| **Summary Cards** | Angular signals | 5 KPI cards: total population, dependency ratio, children %, elderly %, sex ratio |
| **Timeseries Chart** | ECharts | Animated area chart for 2021–2025 trend of selected county |
| **Interpretation Panel** | Angular | Collapsible public health context sections with Kenya-specific policy implications |
| **AI Insights Panel** | Groq LLM | Natural-language analysis of a selected county's demographic profile |
| **Pipeline Runner** | Angular + FastAPI | Trigger and monitor the Python pipeline directly from the UI |

#### Public Health Interpretation

The Interpretation component explains:
- **Dependency ratio** — economic and health financing implications when a large share of the population is non-working-age
- **High child population** (northern arid counties) → need for immunisation outreach, paediatric staffing, nutrition
- **High elderly proportion** (Central, Nyanza) → chronic disease management, geriatric services, palliative care
- **Policy implications** derived directly from county-level data patterns visible in the dashboard

### Backend API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/counties` | List all 47 counties |
| GET | `/api/population` | Query with filters: county, year, sex |
| GET | `/api/summary/{county}/{year}` | Summary stats for one county/year |
| GET | `/api/timeseries/{county}` | Population trend 2021–2025 |
| GET | `/api/age-pyramid/{county}/{year}` | Full age-sex breakdown |
| GET | `/api/comparison` | Multi-county comparison |
| GET | `/api/choropleth/{year}/{indicator}` | All counties for map layer |
| POST | `/api/ai-insights` | Groq LLM-generated county narrative |
| POST | `/api/pipeline/run` | Trigger the data pipeline |
| GET | `/api/pipeline/status` | Pipeline run status |

---

## Part 3 — Code Quality & Documentation

### Style Standards
- **Python:** PEP 8, type hints throughout, docstrings on all public functions, `try/except` error handling
- **TypeScript:** Angular strict mode, standalone components, signals API, RxJS `catchError` in services
- **SCSS:** BEM-inspired naming, CSS custom properties for theming, responsive breakpoints

### Testing

```bash
# Activate environment first
conda activate ahadi-analytics

# Run full suite
pytest tests/ -v --tb=short

# Run specific module
pytest tests/test_validation.py -v
pytest tests/test_aggregation.py -v
```

| Test file | What it covers |
|-----------|---------------|
| `test_validation.py` | CRS detection, filename parsing, missing file flagging, negative value handling, zero-coverage checks |
| `test_aggregation.py` | Zonal sum accuracy, indicator formula correctness, area computation in equal-area projection |

### Commit History

Commits follow logical assessment milestones:

```
aa9bb4a  feat: initial project commit — 67 files, full project scaffold
d907453  fix: update vercel.json to modern buildCommand/outputDirectory format
492254d  fix: set framework null in vercel.json to prevent FastAPI auto-detection
19d5a96  fix: add .vercelignore to exclude Python backend from Vercel build
299cbb8  fix: add vercel.json to frontend/ for direct subdirectory deployment
```

---

## Deployment

This project uses a **split-deploy** architecture:

| Layer | Platform | URL |
|-------|----------|-----|
| Frontend (Angular) | Vercel | https://frontend-sandy-tau-56.vercel.app |
| Backend (FastAPI) | Render (Docker) | https://ahadi-ds-assessment.onrender.com |

The backend requires GDAL, rasterio, and GeoPandas native binaries which cannot run on Vercel's serverless platform. Render's Docker-based web services support these dependencies.

---

### Backend — Render (live)

The FastAPI backend is deployed as a **Docker web service** on Render.

**How it was set up:**
1. Render → New → Web Service → connect `Vinylango25/Ahadi_DS_Assessment`
2. Environment: **Docker** | Branch: `main` | Dockerfile: `./Dockerfile`
3. Instance type: Free (spins down after 15 min inactivity — first request after idle takes ~50 s)
4. Environment variables set in Render dashboard:

| Variable | Value |
|----------|-------|
| `GROQ_API_KEY` | *(your key)* |
| `ALLOWED_ORIGINS` | `https://frontend-sandy-tau-56.vercel.app` |

**API base URL:** `https://ahadi-ds-assessment.onrender.com`  
**Swagger docs:** https://ahadi-ds-assessment.onrender.com/docs

> **Cold-start warning (free tier):** Render's free instances spin down after 15 minutes of inactivity. The first request after a period of no traffic can take 50 seconds or more to respond while the container restarts. Subsequent requests are fast. Upgrade to a paid instance to eliminate cold starts.

**To redeploy manually:**
```bash
# Push any commit to main — Render auto-deploys on every push
git push origin main
```

**To run locally instead:**
```bash
docker-compose up --build
# Backend → http://localhost:8000
```

---

### Frontend — Vercel (live)

The Angular app deploys from the `frontend/` subdirectory. A `.vercelignore` at the root excludes the Python backend so Vercel does not try to deploy FastAPI.

**Live URL:** https://frontend-sandy-tau-56.vercel.app

**How to redeploy after any frontend change:**
```bash
# 1. Build the Angular production bundle
cd frontend
npm run build -- --configuration production

# 2. Deploy to Vercel
vercel deploy --prod --yes --cwd frontend/
```

**Pointing the frontend at the backend:**

The production API URL is set in `frontend/src/environments/environment.prod.ts`:

```typescript
export const environment = {
  production: true,
  apiUrl: 'https://ahadi-ds-assessment.onrender.com',
};
```

Change `apiUrl` here and redeploy if the backend URL ever changes.

---

### Architecture diagram

```
Browser
  │
  ├─► Vercel CDN  (Angular SPA — static files)
  │     frontend-sandy-tau-56.vercel.app
  │
  └─► Render Docker  (FastAPI + SQLite + GDAL)
        ahadi-ds-assessment.onrender.com
              │
              ├─ /api/*        REST endpoints
              ├─ /api/pipeline  Pipeline runner
              └─ /docs          Swagger UI
```

---

### Other deployment options

| Platform | How to deploy |
|----------|--------------|
| **Local (Docker)** | `docker-compose up --build` |
| **Any VPS** | `docker build -t ahadi . && docker run -p 8000:8000 --env-file .env ahadi` |
| **Railway** | Connect repo → Docker environment → set env vars → deploy |

---

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Optional | Enables AI insights panel. Free at https://console.groq.com |
| `GROQ_MODEL` | Optional | Default: `llama-3.1-8b-instant` |
| `DATABASE_URL` | No | Default: `sqlite:///./backend/ahadi.db` |
| `API_HOST` | No | Default: `0.0.0.0` |
| `API_PORT` | No | Default: `8000` |
| `ALLOWED_ORIGINS` | No | CORS origins, default: `*` |

---

## Tests

```bash
conda activate ahadi-analytics
pytest tests/ -v --tb=short
```

---

## Assumptions & Decisions

| Decision | Rationale |
|----------|-----------|
| Angular 19 over Streamlit/Dash | Demonstrates full-stack capability; richer interactivity; closer to production quality |
| SQLite over PostgreSQL | Zero-setup for assessment; ORM is compatible with Postgres for production upgrade |
| ECharts over Plotly | Lighter bundle, better animation support for age pyramids and timeseries |
| Deploy frontend only to Vercel | Backend requires GDAL/GeoPandas native binaries; Vercel is serverless only |
| Deploy from `frontend/` subdirectory | Vercel auto-detects FastAPI from root-level `requirements.txt`, overriding our Angular config |
| WorldPop unconstrained 1km | Specified in assessment; unconstrained files include all residential and non-residential areas |
| Drop (not impute) missing age-sex files | Logged in `validation_log.txt`; imputation would introduce false precision in a 5-year projection series |
| Equal-area (EPSG:6933) for area calculation | Preserves area accuracy for Kenya's equatorial geography vs WGS84 which distorts area |

---

*Submitted by: Vinylango25 | Submission date: 2026-08-20*
