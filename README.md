# Test Guidance for Data Scientist Position

Overview
Welcome to the AHADI Analytics technical assessment. This exercise is designed to assess your skills in building reproducible data pipelines, performing spatial analysis, creating interactive visualizations, and communicating insights for public health decision-making. You will work with real-world population data for Kenya, similar to the types of analyses you would conduct as a Data Scientist at AHADI.

Submission: A GitHub repository containing all code, datasets, and documentation.

**Background**
The Kenyan Ministry of Health needs to understand the country's population age structure to plan health interventions. Children under 5 require routine immunizations, the working-age population represents the workforce and economic base, and the elderly have increasing chronic disease needs. Understanding these patterns at the county level is essential for equitable resource allocation.

Your task is to process 2025 population projections for Kenya, create a clean analytical dataset, and build an interactive dashboard that allows policymakers to explore demographic patterns across all 47 counties.

While the tasks below are clearly defined, there is **room for creativity** in how you approach the analysis, present your results, and communicate your findings.
Candidates who go beyond the basics—demonstrating **thoughtful exploration, clear reasoning, and effective visualization**—will receive additional credit. 
As a reminder: The technical assessment will consist of a timed assignment of no longer than 3 hours: we are interested in seeing what you can accomplish in this time. It is not necessary to complete all of the assigned items.

**Data Sources**
1. Population Data
   You will work with WorldPop 2025 age- and sex-structured population data. The data are organized by age group and sex as GeoTIFF raster files for Kenya.

   For this exercise, use the 1km unconstrained resolution files from the Kenya directory.
2. Administrative Boundaries
   You will need district level boundaries to aggregate populatiopn data.
   Kenya GADM Level 2 (Counties):
   Alternative direct GeoJSON: gadm41_KEN_2.geojson

   The data are in WGS 84 (EPSG:4326).

**Your Tasks**
Part 1: Reproducible Data Pipeline
Create an automated, reproducible pipeline that takes in, processes and validates the population data for Kenya.

Requirements:
1.1 Programmatic Data Access
    Write a script that automatically downloads or accesses the required files from the provided URL.

    Your code should handle the directory listing or use the URL pattern to construct file paths.

    **Do not manually download individual files** - your code must programmatically access the data

    Use appropriate libraries for HTTP requests (e.g., requests in Python, curl in R)

    Implement caching to avoid re-downloading files during development

1.2 Data Validation and Cleaning
Your pipeline must handle intentional and realistic data inconsistencies:

File Validation:

    Programmatically identify all available GeoTIFF files in the Kenya directory

    Parse the file names to extract age group and sex

    Verify that all expected age-sex combinations are present (both sexes for each age group)

    Log any missing files and decide how to handle them (e.g., impute or drop)

Spatial Validation:

    Load the administrative boundaries and verify they are in the correct CRS (EPSG:4326)

    Load a sample raster and verify its CRS

    Reproject boundaries to match the raster CRS if needed (or vice versa)

    Verify that all counties are present and properly named

Data Quality Checks:

    Check for negative population values and handle appropriately

    Verify that population values are plausible (e.g., no zeros for populated areas)

    Check for and log any unusual patterns

1.3 Spatial Aggregation
For each county and age-sex combination:

    Extract population values from the raster to each county polygon

    Calculate total population per county for each age-sex group

    Create Summary Demographic indicators:
      
       Children under 5: Sum of age groups 0-4 (both sexes)
   
       Working age (15-64): Sum of age groups 15-19 through 60-64 (both sexes)
   
       Elderly (65+): Sum of age groups 65-69 and above (both sexes)
   
       Total population: Sum of all age groups (both sexes)
   
       Sex ratio: Male population / Female population * 100
   
       Dependency ratio: (Children_under_5 + Elderly_65plus) / Working_age * 100
   
       Child dependency ratio: Children_under_5 / Working_age * 100
   
       Elderly dependency ratio: Elderly_65plus / Working_age * 100
   
       Proportion children: Children_under_5 / Total_population * 100
   
       Proportion elderly: Elderly_65plus / Total_population * 100

1.4 Output Generation
Your pipeline must produce:

Primary Dataset - A clean CSV file (kenya_population_by_county.csv) with columns:

    county: County name (as in GADM)

    total_population

    children_under_5

    working_age

    elderly_65plus

    sex_ratio

    dependency_ratio

    child_dependency_ratio

    elderly_dependency_ratio

    pct_children

    pct_elderly


Automated Summary Report - Generate a brief text or HTML report containing:

    Total population of Kenya

    Top 5 most populous counties

    Top 5 counties with highest dependency ratio

    Top 5 counties with highest child population proportion

    Summary of data quality issues encountered and how they were handled

    Basic statistics (mean, median, range) for key indicators

Validation Log - A log file documenting:

    All files processed

    Any missing files or data issues

    Validation steps performed

    Decisions made for handling data quality issues

1.5 Environment Setup
Include a way to recreate your environment:

    Python: requirements.txt or environment.yml

    R: renv.lock or DESCRIPTION

Part 2: Interactive Dashboard (2 hours)

Build a functional, user-friendly dashboard that allows exploration of Kenya's population data.
Requirements:

2.1 Dashboard Framework
Choose one of these options:

    Python: Streamlit, Dash, or Flask + Plotly

    R: Shiny

2.2 Required Features

Filters (must work together):

    County dropdown (optional - allows selecting specific counties for comparison)

    Sex toggle: Male, Female, or Total

    Indicator dropdown: Choose which metric to display on the map:

        Total Population

        Children under 5

        Elderly 65+

        Dependency Ratio

        Sex Ratio

        Child Dependency Ratio

        Elderly Dependency Ratio

Visualizations (must update based on filters):

    Choropleth Map (primary visualization):

        Display Kenya's counties colored by the selected indicator

        Color scale should be intuitive (e.g., sequential for population counts, diverging for ratios)

        Hover tooltips showing county name and all key indicators

        Click on a county to update other visualizations

    Age Pyramid (secondary visualization):

        Show population distribution by age group

        Split by sex (if sex filter is not "Total")

        Update when clicking on a specific county

        If multiple counties selected, show combined or stacked distribution

    County Comparison Bar Chart:

        Compare selected counties (or top/bottom counties) on key indicators

        Allow sorting by different metrics

        Show at least 3-5 counties for comparison

    Summary Statistics Cards (dashboard header):

        Total population (for selected county/countries)

        Dependency ratio

        Child population (number and %)

        Elderly population (number and %)

        Sex ratio

2.3 Public Health Context
Include an "Interpretation" section on the dashboard that:

    Explains the public health significance of dependency ratios

    Describes how age structure affects health service planning:

        High child population → need for immunization, pediatric care, nutrition programs

        High elderly population → need for chronic disease management, geriatric care

        High dependency ratio → economic implications for health financing

    Suggests at least two policy implications based on the data patterns you observe

Part 3: Documentation and Software Engineering (1 hour)

3.1 Repository Structure
Your GitHub repository should have a clear, organized structure. For example:
text

kenya-population-analysis/
├── README.md
├── requirements.txt                # or renv.lock
├── .gitignore
├── src/
│   ├── __init__.py
│   ├── pipeline.py                 # main pipeline script
│   ├── data_access.py              # downloading/accessing data
│   ├── validation.py               # data validation functions
│   ├── aggregation.py              # raster aggregation to counties
│   └── utils.py                    # helper functions
├── dashboard/
│   ├── app.py                      # dashboard entry point
│   ├── components/                 # dashboard UI components
│   └── assets/                     # CSS, images
├── data/
│   ├── raw/                        # (optional - for caching downloads)
│   └── processed/
│       ├── kenya_population_by_county.csv
│       └── validation_log.txt
├── outputs/
│   ├── summary_report.html
│   └── figures/                    # optional static figures
└── tests/
    ├── test_validation.py
    └── test_aggregation.py

3.2 README.md Requirements
Your README must include:

Project Description:

    Brief overview of what this project does

    The public health context

Setup Instructions:

    How to clone the repository

    How to install dependencies (Python/R)

    How to set up the environment (virtual environment, renv, etc.)

Usage Instructions:

    How to run the data pipeline (e.g., python src/pipeline.py or Rscript src/pipeline.R)

    How to launch the dashboard (e.g., streamlit run dashboard/app.py or shiny::runApp())

    Expected output location and format

AI Use Disclosure (Required):
If you used AI tools (ChatGPT, Claude, Copilot, etc.):

    Specify which tools were used

    Describe how they were used (e.g., "Used ChatGPT to help debug raster projection issues")

    Provide 1-2 example prompts you used

    Describe how you reviewed and validated AI-generated code

    Note that using AI is allowed and encouraged as a coding aid - we want to see responsible use

3.3 Code Quality

    Use functions/classes to organize code logically

    Include docstrings for all functions explaining inputs, outputs, and purpose

    Add comments for non-obvious code sections

    Follow a consistent style guide (PEP 8 for Python, tidyverse style for R)

    Use meaningful variable names

    Handle errors gracefully with appropriate try-except blocks or condition checks

3.4 Version Control

    Use Git with clear, descriptive commit messages

    Show a logical progression of work (not just one big commit)

    Commit at meaningful milestones:

        Initial setup and structure

        Data access implementation

        Validation and cleaning

        Aggregation logic

        Dashboard development

        Documentation and cleanup

Evaluation Criteria

Your submission will be evaluated on the following criteria, aligned with the AHADI Data Scientist competencies:
Competency	Weight	Excellent	Good	Needs Improvement
Reproducible Pipeline	25%	Fully automated data access, comprehensive validation, efficient raster aggregation, clear logging	Mostly automated, good validation, works correctly	Manual steps, minimal validation, inefficient or broken
Data Handling & Spatial Analysis	20%	Impeccable handling of missing data, correct CRS handling, efficient raster extraction	Handles main cases correctly, minor issues	Errors in aggregation, incorrect projections, data loss
Dashboard & Visualization	25%	Polished, intuitive, all filters work, meaningful health context, professional appearance	Functional, clear visuals, minor usability issues	Broken features, confusing design, missing health context
Code Quality & Documentation	15%	Modular, well-documented, clean structure, excellent README	Somewhat organized, adequate documentation	Spaghetti code, no comments, poor structure
Communication & AI Use	15%	Clear AI disclosure, insightful health implications, professional presentation	Basic AI disclosure, clear presentation	Missing AI disclosure, unclear communication


Resources and Tips

R Libraries to Consider:

    sf - Spatial operations

    terra or raster - Raster data handling

    tidyverse (dplyr, ggplot2, tidyr) - Data manipulation and visualization

    shiny - Dashboard framework

    leaflet - Interactive maps

    httr - HTTP requests for data access

Python Libraries to Consider:

    geopandas - Spatial operations

    rasterio or xarray - Raster data handling

    pandas - Data manipulation

    matplotlib, seaborn, plotly - Visualization

    streamlit or dash - Dashboard framework

    requests - HTTP requests for data access

General Tips:

    Start simple: Get basic data loading and aggregation working before adding complexity

    Test with small data: Use a subset of age groups for initial development

    Document as you go: Write notes about decisions and assumptions

    Think about the user: Your dashboard should be intuitive for a Ministry of Health official

    Be explicit about assumptions: If you need to make assumptions (e.g., about missing data), state them clearly in your README

    Use version control: Commit frequently with meaningful messages

Data Access Tips:

    The WorldPop directory may not support directory listing. You might need to construct URLs based on expected file patterns or use the full URL list if provided.


Reproducibility Tip:
Include a script that checks your environment and installs required packages automatically. This demonstrates attention to reproducibility.

Submission Instructions

    Create a public GitHub repository for your work

    Complete as many of the tasks described above as possible in a three hour period

    Ensure your repository follows the structure outlined in Part 3.1

    Make sure your README is comprehensive and clear

    Submit the repository URL through the provided submission form

Good luck! We look forward to seeing your work.

