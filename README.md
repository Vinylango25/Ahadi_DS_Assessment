# Test Guidance for Data Science Position

You will work with a small population dataset and administrative boundaries from **Sierra Leone**.
The data contain **intentional inconsistencies** that reflect common issues in routine statistical reporting.

Your task is to **clean, validate, and analyze** the data, then produce a brief, clear summary of your results.
You must use **R** or **Python** for all parts of this exercise.

While the tasks are clearly defined, there is **room for creativity** in how you approach the analysis, present your results, and communicate your findings.
Candidates who go beyond the basics—demonstrating **thoughtful exploration, clear reasoning, and effective visualization**—will receive additional credit.

## Files Provided

- **Shapefile:** `data/who_shapefile_sle_adm2_latest.gpkg`
- **Population Data:** `data/sle_pop_2020_2025.csv`

## You Are Expected To

- Identify and correct key data-quality issues.
- Validate and clean administrative names for joinability.
- Estimate or handle missing values logically.
- Join datasets using consistent administrative identifiers.
- Produce a simple, interpretable summary or visualization of key patterns (e.g., population growth, density, or variation across districts).
- Write clean, **reproducible code** and briefly document your steps.

## Deliverables

1. A single script showing your workflow (`.R`, `.py`, or `.Rmd`).
2. A **final cleaned dataset** containing:
   - Total population (2020–2025 or latest available year)
   - Any derived indicators you compute (e.g., population growth rate, density)
3. A short summary output (table or chart).
4. A short `README.md` (2–3 sentences) describing your approach, including any use of AI tools (e.g., ChatGPT, Claude).
   - Specify **where and how** you used them, and include a short example of the prompt or interaction if relevant.

## Evaluation Criteria

1. Clarity and reproducibility of code.
2. Sound logic in cleaning, joining, and analysis.
3. Quality and readability of outputs and visualization.
4. Brief but clear documentation.

## Time and Tools

**Estimated completion time:** 2–3 hours.
Use any standard libraries in **R** or **Python**, such as:

- R: `dplyr`, `sf`, `readr`, `ggplot2`, `tidyr`
- Python: `pandas`, `geopandas`, `matplotlib`, `numpy`, `seaborn`

_Tip:_ Treat this as a **real-world data cleaning and analysis problem**.
Clearly explain any assumptions, show your validation steps, and make sure your outputs are interpretable to a general analytical audience.
