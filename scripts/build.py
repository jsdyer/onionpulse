"""Build a static site from The Tor Project's live, daily CSV snapshots."""

import argparse
import csv
import json
import math
import re
import shutil
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://metrics.torproject.org/"
FIRST = date(2021, 1, 1)
FILES = {
    "userstats-relay-country": ("country", {"relay": "users"}),
    "userstats-bridge-country": ("country", {"bridge": "users"}),
    "networksize": (None, {"relays": "relays", "bridges": "bridges"}),
    "bandwidth": (None, {"advertised": "advbw", "used": "bwhist"}),
    "hidserv-dir-v3-onions-seen": (None, {"addresses": "onions"}),
    "hidserv-rend-v3-relayed-cells": (None, {"traffic": "relayed"}),
}
DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
COUNTRY = re.compile(r"[a-z]{2}")
LIMIT = 50_000_000


def get_csv(name, end, inputs):
    if inputs:
        return (inputs / f"{name}.csv").read_text(encoding="utf-8-sig")
    url = f"{BASE}{name}.csv?{urlencode({'start': FIRST, 'end': end})}"
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "CoolCode OnionPulse (github.com/jsdyer/onionpulse)"})
            with urlopen(request, timeout=60) as response:
                payload = response.read(LIMIT + 1)
                expected = response.headers.get("Content-Length")
            if len(payload) > LIMIT or (expected and int(expected) != len(payload)):
                raise OSError("unexpected response length")
            return payload.decode("utf-8-sig")
        except (OSError, ValueError, UnicodeError) as error:
            if attempt == 2:
                raise RuntimeError(f"Could not download {url}: {error}") from error
            time.sleep(2 ** (attempt + 1))


def parse(name, end, inputs):
    group, columns = FILES[name]
    lines = (line for line in get_csv(name, end, inputs).splitlines() if line and not line.startswith("#"))
    reader = csv.DictReader(lines)
    required = {"date", *columns.values()}
    if group:
        required.add(group)
    if not required.issubset(reader.fieldnames or []):
        raise ValueError(f"{name}: missing expected CSV columns")

    span = (end - FIRST).days + 1
    output = {}
    # Date strings repeat across countries. Cache their offsets during this import.
    offsets = {}
    for row in reader:
        day = row["date"]
        if None in row or not day or not DAY.fullmatch(day):
            raise ValueError(f"{name}: malformed row near line {reader.line_num}")
        if day not in offsets:
            offsets[day] = (date.fromisoformat(day) - FIRST).days
        offset = offsets[day]
        if offset < 0 or offset >= span:
            continue
        country = row[group] if group else ""
        if country is None:
            raise ValueError(f"{name}: missing country column")
        if country and not COUNTRY.fullmatch(country):
            continue
        series = output.setdefault(country or "world", {})
        for key, column in columns.items():
            value = row[column]
            if value is None:
                raise ValueError(f"{name}: missing measurement at {day}")
            if not value or value in {"NA", "NaN"}:
                continue
            number = float(value)
            if not math.isfinite(number) or number < 0:
                raise ValueError(f"{name}: invalid measurement at {day}")
            if key not in series:
                series[key] = [None] * span
            if series[key][offset] is not None:
                raise ValueError(f"{name}: duplicate measurement at {day}/{country}")
            series[key][offset] = int(number) if number.is_integer() else round(number, 6)
    world = output.get("world", {})
    if any(key not in world or sum(value is not None for value in world[key]) < 30 for key in columns):
        raise ValueError(f"{name}: too few global observations")
    return output


def save_json(path, data):
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def build(output, inputs):
    end = datetime.now(timezone.utc).date()
    observations = {}
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {name: executor.submit(parse, name, end, inputs) for name in FILES}
        for future in futures.values():
            for country, series in future.result().items():
                observations.setdefault(country, {}).update(series)
    latest = max(index for series in observations["world"].values()
                 for index, value in enumerate(series) if value is not None)
    dates = {country: list(series) for country, series in sorted(observations.items()) if series and country != "world"}
    all_series = {country: {key: data[:latest + 1] for key, data in series.items()}
                  for country, series in observations.items() if series}
    output.parent.mkdir(exist_ok=True, parents=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        staging = Path(temporary) / "site"
        shutil.copytree(ROOT / "web", staging)
        (staging / "data").mkdir()
        save_json(staging / "data" / "snapshot.json", {
            "first": FIRST.isoformat(),
            "days": latest + 1,
            "refreshed": end.isoformat(),
            "countries": dates,
            "world": all_series.pop("world"),
        })
        for country, series in all_series.items():
            save_json(staging / "data" / f"{country}.json", series)
        if output.exists():
            shutil.rmtree(output)
        staging.replace(output)
    print(f"Built {len(dates)} geographic codes and {latest + 1:,} days of Tor Metrics data.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, help="Use locally saved official CSVs")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    output = args.output.resolve()
    source_folders = (ROOT / name for name in ("web", "scripts", ".git", ".github"))
    if output == ROOT or output in ROOT.parents or any(output.is_relative_to(folder) for folder in source_folders):
        parser.error("Choose a dedicated output directory separate from source files")
    try:
        build(output, args.input_dir)
    except (ValueError, OSError, RuntimeError) as error:
        parser.exit(1, f"Onion Pulse build failed: {error}\n")


if __name__ == "__main__":
    main()
