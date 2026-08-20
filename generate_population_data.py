"""
generate_population_data.py
Generates kenya_population_by_county.csv using 2019 KNBS census baseline
with county-specific growth rate projections to 2021-2025.
"""
import pandas as pd
import numpy as np
from pathlib import Path

# 2019 Kenya Census county populations (official KNBS data)
census_2019 = {
    'Mombasa': 1208333, 'Kwale': 866820, 'Kilifi': 1453787, 'Tana River': 315943,
    'Lamu': 143920, 'Taita Taveta': 340671, 'Garissa': 841353, 'Wajir': 781263,
    'Mandera': 1025756, 'Marsabit': 459785, 'Isiolo': 268002, 'Meru': 1545714,
    'Tharaka-Nithi': 393177, 'Embu': 608599, 'Kitui': 1136187, 'Machakos': 1421932,
    'Makueni': 987653, 'Nyandarua': 638289, 'Nyeri': 759164, 'Kirinyaga': 610411,
    'Murang\'a': 1056640, 'Kiambu': 2417735, 'Turkana': 926976, 'West Pokot': 621241,
    'Samburu': 310327, 'Trans Nzoia': 990341, 'Uasin Gishu': 1163186,
    'Elgeyo-Marakwet': 454480, 'Nandi': 885711, 'Baringo': 666763,
    'Laikipia': 518560, 'Nakuru': 2162202, 'Narok': 1157873, 'Kajiado': 1107296,
    'Kericho': 901777, 'Bomet': 875689, 'Kakamega': 1867579, 'Vihiga': 590013,
    'Bungoma': 1670570, 'Busia': 893681, 'Siaya': 993183, 'Kisumu': 1155574,
    'Homa Bay': 1131950, 'Migori': 1116436, 'Kisii': 1266860,
    'Nyamira': 605576, 'Nairobi': 4397073
}

# Kenya national age structure (proportions from 2019 census)
age_groups = {
    '0-4': 0.148, '5-9': 0.136, '10-14': 0.128, '15-19': 0.108,
    '20-24': 0.092, '25-29': 0.082, '30-34': 0.068, '35-39': 0.057,
    '40-44': 0.046, '45-49': 0.037, '50-54': 0.030, '55-59': 0.023,
    '60-64': 0.017, '65-69': 0.012, '70-74': 0.008, '75-79': 0.005, '80+': 0.003
}

# Male/female ratio within each group (males per female)
sex_ratios = {
    '0-4': 1.03, '5-9': 1.02, '10-14': 1.01, '15-19': 0.98,
    '20-24': 0.95, '25-29': 0.93, '30-34': 0.94, '35-39': 0.95,
    '40-44': 0.96, '45-49': 0.96, '50-54': 0.94, '55-59': 0.91,
    '60-64': 0.88, '65-69': 0.82, '70-74': 0.75, '75-79': 0.68, '80+': 0.60
}

# County annual growth rates (KNBS 2009-2019 intercensal)
growth_rates = {
    'Mombasa': 0.033, 'Kwale': 0.027, 'Kilifi': 0.027, 'Tana River': 0.031,
    'Lamu': 0.041, 'Taita Taveta': 0.021, 'Garissa': 0.033, 'Wajir': 0.039,
    'Mandera': 0.038, 'Marsabit': 0.041, 'Isiolo': 0.033, 'Meru': 0.020,
    'Tharaka-Nithi': 0.018, 'Embu': 0.017, 'Kitui': 0.021, 'Machakos': 0.024,
    'Makueni': 0.018, 'Nyandarua': 0.025, 'Nyeri': 0.013, 'Kirinyaga': 0.017,
    'Murang\'a': 0.016, 'Kiambu': 0.038, 'Turkana': 0.045, 'West Pokot': 0.040,
    'Samburu': 0.029, 'Trans Nzoia': 0.031, 'Uasin Gishu': 0.031,
    'Elgeyo-Marakwet': 0.025, 'Nandi': 0.029, 'Baringo': 0.027,
    'Laikipia': 0.028, 'Nakuru': 0.033, 'Narok': 0.039, 'Kajiado': 0.046,
    'Kericho': 0.024, 'Bomet': 0.029, 'Kakamega': 0.021, 'Vihiga': 0.013,
    'Bungoma': 0.028, 'Busia': 0.026, 'Siaya': 0.015, 'Kisumu': 0.022,
    'Homa Bay': 0.019, 'Migori': 0.026, 'Kisii': 0.021, 'Nyamira': 0.019,
    'Nairobi': 0.040
}

records = []

for county, base_pop in census_2019.items():
    gr = growth_rates.get(county, 0.022)
    for year in range(2021, 2026):
        years_since_2019 = year - 2019
        total = int(base_pop * ((1 + gr) ** years_since_2019))

        male_total = female_total = 0
        children = working = elderly = 0

        for ag, prop in age_groups.items():
            grp = total * prop
            sr = sex_ratios[ag]
            male_total += grp * sr / (1 + sr)
            female_total += grp / (1 + sr)
            start = int(ag.split('-')[0].replace('+', ''))
            if start < 5:
                children += grp
            elif 15 <= start <= 64:
                working += grp
            elif start >= 65:
                elderly += grp

        male_total = round(male_total)
        female_total = round(female_total)
        children = round(children)
        working = round(working)
        elderly = round(elderly)

        records.append({
            'county': county,
            'year': year,
            'total_population': total,
            'children_under_5': children,
            'working_age': working,
            'elderly_65plus': elderly,
            'sex_ratio': round(male_total / female_total * 100, 2) if female_total else None,
            'dependency_ratio': round((children + elderly) / working * 100, 2) if working else None,
            'child_dependency_ratio': round(children / working * 100, 2) if working else None,
            'elderly_dependency_ratio': round(elderly / working * 100, 2) if working else None,
            'pct_children': round(children / total * 100, 2) if total else None,
            'pct_elderly': round(elderly / total * 100, 2) if total else None,
        })

df = pd.DataFrame(records)
out = Path('data/processed')
out.mkdir(parents=True, exist_ok=True)
df.to_csv(out / 'kenya_population_by_county.csv', index=False)
print(f'Generated {len(df)} records — {df.county.nunique()} counties x {df.year.nunique()} years')
print(df[df.year == 2025][['county', 'total_population', 'dependency_ratio']]
      .sort_values('total_population', ascending=False).head(10).to_string())
