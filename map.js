import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

mapboxgl.accessToken =
  'pk.eyJ1IjoibmF0YWxpZWh1eW5oMTI0IiwiYSI6ImNtcDhxd2g3eDBsYW4ycHEwNjhoOGc1Y20ifQ.sFv_g4J0BwG-Djzf6-v1dQ';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
});

const svg = d3.select('#map').select('svg');

// ---------------- traffic flow scale ----------------
const stationFlow = d3
  .scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);

// ---------------- helpers ----------------
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// ---------------- state ----------------
let stations = [];
let trips = [];
let circles;
let radiusScale;
let timeFilter = -1;

// ---------------- UI ----------------
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

function formatTime(minutes) {
  const d = new Date(0, 0, 0, 0, minutes);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------- traffic computation ----------------
function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    const id = station.short_name;

    const arr = arrivals.get(id) ?? 0;
    const dep = departures.get(id) ?? 0;

    return {
      ...station,
      arrivals: arr,
      departures: dep,
      totalTraffic: arr + dep,
    };
  });
}

// ---------------- filtering ----------------
function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) return trips;

  return trips.filter((trip) => {
    const start = minutesSinceMidnight(trip.started_at);
    const end = minutesSinceMidnight(trip.ended_at);

    return (
      Math.abs(start - timeFilter) <= 60 ||
      Math.abs(end - timeFilter) <= 60
    );
  });
}

// ---------------- UPDATE FUNCTION ----------------
function updateScatterPlot() {
  const filteredTrips = filterTripsByTime(trips, timeFilter);
  const updatedStations = computeStationTraffic(stations, filteredTrips);

  radiusScale.range(timeFilter === -1 ? [0, 25] : [3, 50]);

  circles
    .data(updatedStations, (d) => d.short_name)
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .attr('cx', (d) => getCoords(d).cx)
    .attr('cy', (d) => getCoords(d).cy)
    .style('pointer-events', 'auto') // 🔥 FIX
    .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic || 0)
    );
}

// ---------------- slider ----------------
function updateTimeDisplay() {
  timeFilter = Number(timeSlider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'block';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }

  updateScatterPlot();
}

timeSlider.addEventListener('input', updateTimeDisplay);

// ---------------- MAP LOAD ----------------
map.on('load', async () => {

  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#0072B2',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });

  const stationsData = await d3.json(
    'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
  );

  trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (d) => {
      d.started_at = new Date(d.started_at);
      d.ended_at = new Date(d.ended_at);
      return d;
    }
  );

  stations = stationsData.data.stations;

  const baseStations = computeStationTraffic(stations, trips);

  const maxTraffic = d3.max(baseStations, (d) => d.totalTraffic);

  radiusScale = d3.scaleSqrt()
    .domain([0, maxTraffic])
    .range([0, 25]);

  // ---------------- CIRCLES ----------------
  circles = svg
    .selectAll('circle')
    .data(baseStations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('fill', 'steelblue')
    .attr('fill-opacity', 0.6)
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .attr('cx', (d) => getCoords(d).cx)
    .attr('cy', (d) => getCoords(d).cy)
    .style('pointer-events', 'auto') // 🔥 FIX

    .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic || 0)
    )

    // ✅ SINGLE TOOLTIP ONLY (FIXED)
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);

  updateTimeDisplay();
});

window.map = map;
window.mapboxgl = mapboxgl;