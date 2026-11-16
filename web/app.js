"use strict";

const $ = (id) => document.getElementById(id);
const DAY = 86400000;
const base = "https://metrics.torproject.org/";
const format = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-CA", { notation: "compact", maximumFractionDigits: 1 });
const names = new Intl.DisplayNames(["en-CA"], { type: "region", fallback: "code" });
const narrow = matchMedia("(max-width:620px)");
const presets = [...document.querySelectorAll("[data-days]")];
const eventButtons = [...document.querySelectorAll("[data-event]")];
const prefs = ["metric", "country", "compare", "from", "to"];
const metrics = {
  relay: { title: "Estimated relay users", unit: "estimated clients", local: true, file: "userstats-relay-country",
    detail: "Estimated clients connecting directly to relays, based on aggregate directory requests." },
  bridge: { title: "Estimated bridge users", unit: "estimated clients", local: true, file: "userstats-bridge-country",
    detail: "Estimated clients connecting through Tor bridges, across the transports covered by Tor Metrics." },
  size: { title: "Running relays and bridges", unit: "servers", file: "networksize", series: [["relays", "Running relays"], ["bridges", "Running bridges"]],
    detail: "The number of running relays and bridges reported in Tor’s network statistics." },
  bandwidth: { title: "Relay bandwidth", unit: "Gbit/s", file: "bandwidth", series: [["advertised", "Advertised capacity"], ["used", "Observed usage"]],
    detail: "Advertised capacity describes what relays report they can provide. Observed usage summarizes reported traffic." },
  addresses: { title: "Estimated v3 onion addresses", unit: "estimated addresses", file: "hidserv-dir-v3-onions-seen", series: [["addresses", "Unique v3 addresses"]],
    detail: "Estimated unique v3 onion addresses observed by onion-service directories each day." },
  traffic: { title: "Estimated v3 onion-service traffic", unit: "Gbit/s", file: "hidserv-rend-v3-relayed-cells", series: [["traffic", "v3 onion-service traffic"]],
    detail: "Estimated aggregate bandwidth carried by rendezvous circuits serving v3 onion services." },
};
const events = {
  tm: { metric: "bridge", from: "2025-03-01", to: "2025-06-15", start: "2025-04-28", label: "Rise in bridge usage" },
  ru: { metric: "bridge", from: "2024-10-06", to: "2024-12-21", start: "2024-11-06", end: "2024-11-21", label: "Snowflake blocking" },
  mm: { metric: "relay", from: "2021-01-15", to: "2021-05-27", start: "2021-02-15", end: "2021-04-27", label: "Nightly shutdowns" },
};

let snapshot;
let first;
let generation = 0;
let frame;
let focusIndex;
const locationCache = new Map();

function dateAt(index) {
  return new Date(first + index * DAY).toISOString().slice(0, 10);
}

function indexAt(iso) {
  return Math.round((Date.parse(iso + "T00:00:00Z") - first) / DAY);
}

function countryName(code) {
  return code === "world" ? "Worldwide" : names.of(code.toUpperCase());
}

function option(name, key) {
  const element = document.createElement("option");
  element.value = key;
  element.textContent = name;
  return element;
}

function countryOptions(metric) {
  const available = Object.keys(snapshot.countries).filter(code => snapshot.countries[code].includes(metric))
    .map(code => [countryName(code), code]).sort((a, b) => a[0].localeCompare(b[0], "en-CA"));
  for (const id of ["country", "compare"]) {
    const select = $(id);
    const current = select.value;
    select.replaceChildren(...(id === "compare" ? [option("No comparison", "")] : []), option("Worldwide", "world"),
      ...available.map(([name, code]) => option(name, code)));
    if ([...select.options].some(item => item.value === current)) select.value = current;
  }
}

function setPeriod(days) {
  $("to").value = dateAt(snapshot.days - 1);
  $("from").value = dateAt(days ? Math.max(0, snapshot.days - days) : 0);
}

function setMetric(value) {
  $("metric").value = value;
  const local = metrics[value].local;
  $("country-control").hidden = !local;
  $("compare-control").hidden = !local;
  if (local) countryOptions(value);
}

function numberText(value) {
  return Number.isFinite(value) ? format.format(value) : "No data";
}

async function getJson(file) {
  const response = await fetch(new URL(`./data/${file}.json`, location.href), {
    cache: "no-cache",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
  return response.json();
}

function countryData(code) {
  if (code === "world") return Promise.resolve(snapshot.world);
  if (!locationCache.has(code)) {
    const loading = getJson(code).catch(error => {
      locationCache.delete(code);
      throw error;
    });
    locationCache.set(code, loading);
  }
  return locationCache.get(code);
}

async function load() {
  $("status").hidden = false;
  $("status").textContent = "Loading daily measurements…";
  $("retry").hidden = true;
  try {
    const data = await getJson("snapshot");
    if (!data.first || !Number.isInteger(data.days) || data.days < 1 || !data.countries || !data.world) {
      throw new Error("Unexpected Tor Metrics data");
    }
    snapshot = data;
    first = Date.parse(snapshot.first + "T00:00:00Z");
    const params = new URLSearchParams(location.search);
    setMetric("relay");
    $("country").value = snapshot.countries.ca?.includes("relay") ? "ca" : "world";
    const metric = params.get("metric");
    if (Object.hasOwn(metrics, metric)) setMetric(metric);
    setPeriod(180);
    for (const key of ["country", "compare"]) {
      if ([...$(key).options].some(item => item.value === params.get(key))) $(key).value = params.get(key);
    }
    for (const id of ["from", "to"]) {
      $(id).min = snapshot.first;
      $(id).max = dateAt(snapshot.days - 1);
      const index = indexAt(params.get(id));
      if (Number.isInteger(index) && index >= 0 && index < snapshot.days) $(id).value = dateAt(index);
    }
    for (const key of ["relay", "bridge", "relays"]) {
      const values = snapshot.world[key];
      const last = values.findLastIndex(value => value !== null);
      const element = $("global-" + key);
      element.textContent = numberText(values[last]);
      if (last >= 0) element.title = "Observed " + dateAt(last) + " UTC";
    }
    $("snapshot-date").textContent = `Data through ${dateAt(snapshot.days - 1)} · Refreshed ${snapshot.refreshed}`;
    for (const control of [...prefs.map($), ...presets, ...eventButtons]) control.disabled = false;
    render();
  } catch {
    snapshot = undefined;
    $("status").textContent = "The Tor Metrics snapshot could not be loaded.";
    $("retry").hidden = false;
  }
}

function updateURL() {
  const url = new URL(location.href);
  for (const key of prefs) {
    if ($(key).value && (metrics[$("metric").value].local || !["country", "compare"].includes(key))) {
      url.searchParams.set(key, $(key).value);
    } else {
      url.searchParams.delete(key);
    }
  }
  history.replaceState(null, "", url);
}

function createTag(name, classes, text) {
  const element = document.createElement(name);
  if (classes) element.className = classes;
  if (text) element.textContent = text;
  return element;
}

function svg(name, attrs, text) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (text) element.textContent = text;
  return element;
}

function showStatus(message, retry = false) {
  $("status").textContent = message;
  $("status").hidden = false;
  $("plot").hidden = true;
  $("retry").hidden = !retry;
  $("download").disabled = true;
  frame = undefined;
}

async function render() {
  if (!snapshot) return;
  const currentGeneration = ++generation;
  const selected = $("metric").value;
  const metric = metrics[selected];
  const country = $("country").value;
  const compare = $("compare").value;
  const from = indexAt($("from").value);
  const to = indexAt($("to").value);
  const priorFocus = focusIndex;
  for (const button of presets) {
    const days = Number(button.dataset.days);
    const chosen = to === snapshot.days - 1 && from === (days ? Math.max(0, snapshot.days - days) : 0);
    button.setAttribute("aria-pressed", String(chosen));
  }
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to >= snapshot.days || to < from) {
    showStatus(`Choose a date range from ${snapshot.first} to ${dateAt(snapshot.days - 1)}.`);
    return;
  }
  updateURL();
  showStatus("Loading measurements for this view…");
  try {
    let series;
    if (metric.local) {
      const codes = compare && compare !== country ? [country, compare] : [country];
      const all = await Promise.all(codes.map(countryData));
      series = all.map((item, i) => ({ label: countryName(codes[i]), points: item[selected] || [] }));
    } else {
      series = metric.series.map(([key, label]) => ({ label, points: snapshot.world[key] }));
    }
    if (currentGeneration !== generation) return;
    const count = to - from + 1;
    const visible = series.map(line => ({ ...line, points: line.points.slice(from, to + 1) }));
    const values = visible.flatMap(line => line.points).filter(Number.isFinite);
    if (!values.length) {
      showStatus("Tor Metrics reports no values for this range. Try a wider range or another metric.");
      return;
    }
    const event = metric.local ? [country, compare].map(code => events[code]).find(mark => mark?.metric === selected
      && indexAt(mark.start) <= to && indexAt(mark.end || mark.start) >= from) : undefined;
    const source = new URL(`${metric.file}.html`, base);
    source.searchParams.set("start", dateAt(from));
    source.searchParams.set("end", dateAt(to));
    if (metric.local) source.searchParams.set("country", country === "world" ? "all" : country);
    $("chart-title").textContent = metric.title;
    $("chart-source").href = source.href;
    $("description").textContent = metric.detail;
    $("status").hidden = true;
    $("plot").hidden = false;
    $("download").disabled = false;
    focusIndex = priorFocus >= from && priorFocus <= to ? priorFocus : from + valuesLastIndex(visible);
    draw({ count, from, to, series: visible, maximum: Math.max(...values), unit: metric.unit, event });
  } catch {
    if (currentGeneration === generation) showStatus("The selected country’s data could not be loaded.", true);
  }
}

function valuesLastIndex(series) {
  return Math.max(...series.map(line => line.points.findLastIndex(Number.isFinite)));
}

function niceCeiling(maximum) {
  if (maximum <= 4) return 4;
  const scale = 10 ** Math.floor(Math.log10(maximum / 4));
  const step = [1, 2, 2.5, 5, 10].find(n => n * scale * 4 >= maximum);
  return step * scale * 4;
}

function draw(model) {
  const { count, from, to, series, maximum, event } = model;
  const width = narrow.matches ? 420 : 800;
  const left = 54, right = width - 31, top = 31, bottom = 272;
  const ceiling = niceCeiling(maximum);
  const x = index => count === 1 ? (left + right) / 2 : left + (right - left) * index / (count - 1);
  const y = number => bottom - (bottom - top) * number / ceiling;
  const graph = $("graph");
  graph.setAttribute("viewBox", `0 0 ${width} 320`);
  const elements = [svg("text", { x: left, y: 20, "font-size": 13 }, model.unit)];
  for (let i = 0; i <= 4; i++) {
    const level = ceiling * i / 4;
    elements.push(svg("line", { x1: left, x2: right, y1: y(level), y2: y(level), class: "grid" }),
      svg("text", { x: left - 8, y: y(level) + 4, "text-anchor": "end", "font-size": 14 }, compact.format(level)));
  }
  if (event) {
    const start = Math.max(from, indexAt(event.start));
    const end = Math.min(to, indexAt(event.end || event.start));
    const marker = x(start - from);
    const width = x(end - from) - marker;
    if (width > 0) elements.push(svg("rect", { x: marker, y: top, width, height: bottom - top, fill: "#eee5d1", opacity: .7 }));
    else elements.push(svg("line", { x1: marker, x2: marker, y1: top, y2: bottom, class: "mark" }));
  }
  const ticks = Math.min(count, narrow.matches ? 3 : 5);
  for (let i = 0; i < ticks; i++) {
    const index = ticks === 1 ? 0 : Math.round((count - 1) * i / (ticks - 1));
    elements.push(svg("text", { x: x(index), y: 302, "text-anchor": i === 0 && ticks > 1 ? "start" : i === ticks - 1 && ticks > 1 ? "end" : "middle",
      "font-size": 14 }, dateAt(from + index)));
  }
  const legend = [];
  for (const [i, line] of series.entries()) {
    const style = i === 0 ? "primary" : "alternate";
    const segments = [];
    for (const [index, point] of line.points.entries()) {
      if (!Number.isFinite(point)) continue;
      const previous = Number.isFinite(line.points[index - 1]);
      const next = Number.isFinite(line.points[index + 1]);
      if (!previous && !next) elements.push(svg("circle", { cx: x(index), cy: y(point), r: 2.9, class: `point ${style}` }));
      else segments.push(`${previous ? "L" : "M"}${x(index).toFixed(1)} ${y(point).toFixed(1)}`);
    }
    elements.push(svg("path", { d: segments.join(" "), class: `trace ${style}` }));
    const item = createTag("span");
    item.append(createTag("i", `swatch ${style}`), document.createTextNode(line.label));
    legend.push(item);
  }
  if (event) {
    const item = createTag("span");
    item.append(createTag("i", "swatch event"), document.createTextNode(event.label));
    legend.push(item);
  }
  const cursor = svg("line", { x1: left, x2: left, y1: top, y2: bottom, class: "cursor" });
  const dots = series.map((line, i) => svg("circle", { r: 4, class: i === 0 ? "point primary" : "point alternate" }));
  graph.replaceChildren(...elements, cursor, ...dots);
  $("legend").replaceChildren(...legend);
  $("scrub").max = count - 1;
  frame = { ...model, x, y, left, right, width, cursor, dots };
  inspect(focusIndex - from);
}

function inspect(offset) {
  if (!frame || offset === undefined) return;
  const { x, y, cursor, dots, series, from, unit } = frame;
  focusIndex = from + offset;
  const date = dateAt(focusIndex);
  $("scrub").value = offset;
  $("scrub").setAttribute("aria-valuetext", date + " UTC");
  $("inspect-date").textContent = date;
  const pixel = x(offset);
  cursor.setAttribute("x1", pixel);
  cursor.setAttribute("x2", pixel);
  for (const [i, dot] of dots.entries()) {
    const point = series[i].points[offset];
    dot.style.display = Number.isFinite(point) ? "" : "none";
    if (Number.isFinite(point)) {
      dot.setAttribute("cx", pixel);
      dot.setAttribute("cy", y(point));
    }
  }
  $("inspect-values").textContent = series.map(line => {
    const point = line.points[offset];
    return `${line.label} · ${numberText(point)}${Number.isFinite(point) && unit === "Gbit/s" ? " Gbit/s" : ""}`;
  }).join("  /  ");
}

$("graph").addEventListener("pointermove", event => {
  if (!frame || event.pointerType === "touch") return;
  const bounds = $("graph").getBoundingClientRect();
  const pixel = (event.clientX - bounds.left) * frame.width / bounds.width;
  const percent = Math.max(0, Math.min(1, (pixel - frame.left) / (frame.right - frame.left)));
  inspect(Math.round(percent * (frame.count - 1)));
});
narrow.addEventListener("change", () => { if (frame) draw(frame); });
$("scrub").addEventListener("input", () => inspect(Number($("scrub").value)));
$("metric").addEventListener("change", () => {
  setMetric($("metric").value);
  render();
});
for (const id of prefs.slice(1)) $(id).addEventListener("change", render);
for (const button of presets) button.addEventListener("click", () => {
  setPeriod(Number(button.dataset.days));
  render();
});
for (const button of eventButtons) button.addEventListener("click", () => {
  const country = button.dataset.event;
  const event = events[country];
  setMetric(event.metric);
  $("country").value = country;
  $("compare").value = "";
  $("from").value = event.from;
  $("to").value = event.to;
  focusIndex = indexAt(event.start);
  render();
  $("explore-title").scrollIntoView();
  $("metric").focus({ preventScroll: true });
});
$("retry").addEventListener("click", () => snapshot ? render() : load());
$("download").addEventListener("click", () => {
  if (!frame) return;
  const { count, from, to, series, unit } = frame;
  const quote = value => '"' + value.replaceAll('"', '""') + '"';
  const header = ["date_utc", ...series.map(line => quote(`${line.label} (${unit})`))].join(",");
  const lines = [header];
  for (let offset = 0; offset < count; offset++) {
    lines.push([dateAt(from + offset), ...series.map(line => line.points[offset] ?? "")].join(","));
  }
  const link = createTag("a");
  link.href = URL.createObjectURL(new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }));
  link.download = `onion-pulse-${$("metric").value}-${dateAt(from)}_${dateAt(to)}.csv`;
  link.click();
  const url = link.href;
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
load();
