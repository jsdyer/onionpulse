# Onion Pulse

A browser-only timeline of the Tor network using daily, aggregate estimates published by The Tor Project. Compare countries and territories for estimated relay or bridge users. Explore worldwide relay and bridge counts, relay bandwidth, estimated unique v3 onion addresses, and estimated v3 onion-service traffic. Set a date window, inspect it with a pointer or the keyboard, and download the visible series as CSV. The research cards open example date ranges from the Tor Metrics timeline.

## Data and interpretation

[The Tor Project](https://metrics.torproject.org/) releases its [CSV data](https://metrics.torproject.org/stats.html) under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Onion Pulse generates its own charts from those files. The build queries six documented CSV endpoints from January 2021 onward. It validates column headers and numeric measurements, preserves missing days, and prepares a worldwide snapshot and individually downloadable country/territory files. The interface displays both the date the snapshot was built and the most recent observed date. Coverage differs by series and geography. New measurements can arrive after the observation date.

Tor estimates clients from aggregate directory requests. Directory counts, measurement coverage, and client behaviour can affect the series. The app displays no user or service identities. [Tor Metrics News](https://metrics.torproject.org/news.html) provides context about events near observed changes. Inspect the [measurement methodology](https://metrics.torproject.org/reproducible-metrics.html) and linked charts when drawing conclusions.

## Run locally

Run `python3 scripts/build.py` with Python 3.11 or later, then `python3 -m http.server 8000 --directory dist`. Open http://localhost:8000/. Add `--input-dir /path/to/csvs` to build from saved CSVs with the names recorded in `FILES` in the build script.

The GitHub Pages workflow builds the static directory. A failed download or invalid upstream CSV stops that build. Once deployed, all charts work with the same-origin snapshot and the browser’s built-in APIs. Asset paths are relative and work under the CoolCode project subdirectory.
