# Electoral Polling Station Results Viewer for Brazil (2006-2024)

An interactive web application for exploring Brazilian election results at the polling-station level, enriched with demographic and socioeconomic data.

This project combines electoral returns, geospatial polling station layers, census-derived indicators, and comparative analytics into a single browser-based interface. It was built to help researchers, journalists, campaign analysts, and politically curious users inspect how voting behavior changes across locations, elections, candidates, and social profiles.

## Overview

The viewer allows you to:

- load multiple Brazilian election cycles from 2006 to 2024
- switch between general and municipal elections
- inspect results for president, governor, senator, mayor, city council, federal deputy, and state deputy
- explore results at the polling-station level on an interactive map
- compare candidates, parties, federations, and coalitions where applicable
- apply demographic and socioeconomic filters to isolate local voting environments
- analyze performance patterns by factor such as women, race, income, schooling, sanitation, age, and civil status
- inspect aggregated selections, individual polling places, or filtered map subsets

## What The Site Does

This site is designed as a visual electoral observatory.

At its core, it matches three types of information:

1. Election results by polling location
2. Polling station geospatial data
3. Census and demographic context for each location

That allows the app to answer questions such as:

- Where did a candidate overperform inside a state or municipality?
- Which local voting stations have similar demographic profiles?
- How does candidate performance change in places with more women, different race composition, different schooling patterns, or higher income?
- What happens when we compare party vote, candidate vote, and turnout across the same geography?

## Main Features

### Interactive map

- Leaflet-based map rendering
- polling-station level points across Brazil
- dynamic recoloring by winner, candidate performance, party, federation, or coalition
- comparison-based point sizing
- selection by click, shift-click, and drag box
- view preservation when switching elections or cargos, when possible

### Election coverage

- General elections: 2006, 2010, 2014, 2018, 2022
- Municipal elections: 2008, 2012, 2016, 2020, 2024
- General cargos:
  - President
  - Governor
  - Senator
  - Federal Deputy
  - State Deputy
- Municipal cargos:
  - Mayor
  - City Council

### Results panel

- candidate cards with vote share and vote totals
- party and coalition/federation views for proportional races
- election status badges such as elected, not elected, second round, and inapt
- summary panels and comparison boxes
- contextual metrics such as valid votes, turnout, blank votes, and null votes

### Filters

- municipality filter
- neighborhood filter
- polling-station name search
- automatic filter application without requiring a manual apply step
- turnout and result re-aggregation based on active filters

### Demographic and socioeconomic filters

The viewer supports map filtering and correlation analysis using local census indicators such as:

- income
- race/color
- age
- gender
- schooling
- civil status
- sanitation

### Advanced analysis panel

The project includes an analytical layer that goes beyond standard election maps:

- ISE-style socioeconomic charts
- factor-vs-performance scatter plots
- regression line, beta coefficient, and r² summaries
- tercile comparisons
- weighted averages
- candidate and party comparison modes

## Data Sources Inside The Project

The repository includes structured electoral and geographic assets such as:

- `resultados_geo/Majoritarias */`
- `resultados_geo/Censo */`
- `resultados_geo/locais_votacao_*`
- `lista_municipios.json`

The app reads compressed assets directly in the browser and merges:

- electoral result payloads
- polling-station geometry and location data
- enriched census and demographic attributes

## How It Works

### 1. Load election data

When the user chooses an election year, office, state, and optionally municipality, the app loads compressed result packages for the selected context.

### 2. Load polling-station geography

The relevant geospatial polling-station database is opened and filtered to the corresponding geographic scope.

### 3. Merge census and demographic attributes

The app enriches polling places with census indicators such as income, schooling, sanitation, race composition, and gender composition.

### 4. Render the map and UI

Once the merge is complete, the map is painted, the results panel is assembled, and all filters and analysis modules become available.

## Use Cases

This project is especially useful for:

- election result exploration
- local political analysis
- academic research
- campaign intelligence
- journalism and data storytelling
- demographic correlation analysis
- municipal and state-level comparative work

## Running The Project

Because the application loads many local assets, it should be served through a local or static web server rather than opened directly as a raw `file://` page.

Simple options:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

You can also host it on static hosting platforms such as GitHub Pages.

## Notes On Performance

The project handles large geospatial and electoral datasets in the browser. Depending on the selected year, office, and geography, some combinations may load substantial ZIP and database assets.

The app therefore includes:

- ZIP reader caching
- memory cleanup controls
- progressive redraw logic
- direct browser-side data merging
- automatic re-rendering after filter changes

## Export And Analysis Scripts

The repository also includes Python-side export tooling for analysis outside the browser.

Example:

- [scripts/export_factor_xlsx.py](c:/mapas/Polling-Stations-Results-Brazil-2006-2024-main/scripts/export_factor_xlsx.py)

This script can generate Excel workbooks with factor-vs-vote analysis derived from the same logic used in the site’s analytical charts.

## Why This Project Is Different

Most election maps stop at municipality-level choropleths or candidate totals.

This project goes further by combining:

- polling-station precision
- demographic enrichment
- socioeconomic analysis
- candidate and party comparison
- browser-native exploration

That makes it possible to study the fine-grained territorial and social structure of Brazilian voting behavior in a way that is rarely available in public tools.

## Acknowledgments

This project stands at the intersection of electoral data engineering, browser GIS, and public-interest political analysis. It was built to make complex election data accessible, inspectable, and analytically useful.

## License

This project is licensed under CC BY-NC 4.0 with additional restrictions.  
Commercial use is strictly prohibited.
