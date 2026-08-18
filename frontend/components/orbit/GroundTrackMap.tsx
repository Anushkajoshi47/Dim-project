'use client';

import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import { useMissionStore } from '@/lib/store';
import { SERIES } from '@/lib/theme';
import type { GeoPoint } from '@/lib/types';

/**
 * 2D world map with live ground tracks.
 *
 * Client-only by construction — Leaflet touches `window` at import time, so this
 * module is never imported directly; it is loaded through MapPanel's
 * `dynamic(..., { ssr: false })` wrapper.
 */

const SAT_COLOR: Record<string, string> = {
  SOMAIYASAT: SERIES[0],
  SOMAIYAPOD: SERIES[1],
};

/**
 * Split a ground track wherever it crosses the antimeridian.
 *
 * A polyline drawn straight from +179° to −179° would smear a horizontal line
 * across the whole map. Breaking the track into segments at the wrap is what
 * makes it render as the familiar sinusoid.
 */
function splitAtAntimeridian(points: GeoPoint[]): [number, number][][] {
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];

  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (i > 0 && Math.abs(p.lon - points[i - 1].lon) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push([p.lat, p.lon]);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

/** Spacecraft marker: a labelled diamond, so identity is not colour-only. */
function satelliteIcon(color: string, label: string, sunlit: boolean) {
  return L.divIcon({
    className: '',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    html: `
      <div style="position:relative;width:12px;height:12px;">
        <div style="
          width:12px;height:12px;
          background:${color};
          border:1.5px solid #0b1219;
          box-shadow:0 0 0 1px ${color}66, 0 0 10px ${color}88;
          transform:rotate(45deg);
        "></div>
        <div style="
          position:absolute;left:16px;top:-4px;white-space:nowrap;
          font-family:ui-monospace,monospace;font-size:9px;font-weight:600;
          letter-spacing:0.08em;color:${color};
          text-shadow:0 0 4px #000, 0 1px 2px #000;
        ">${label}${sunlit ? '' : ' ◐'}</div>
      </div>`,
  });
}

/** Ground station marker: a crossed circle, visually distinct from spacecraft. */
function stationIcon(label: string) {
  return L.divIcon({
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `
      <div style="position:relative;width:14px;height:14px;">
        <div style="
          width:14px;height:14px;border-radius:50%;
          border:1.5px solid #34d3c0;background:rgba(52,211,192,0.16);
          box-shadow:0 0 8px rgba(52,211,192,0.5);
        "></div>
        <div style="position:absolute;left:6px;top:0;width:1px;height:14px;background:#34d3c0;opacity:0.8;"></div>
        <div style="position:absolute;top:6px;left:0;height:1px;width:14px;background:#34d3c0;opacity:0.8;"></div>
        <div style="
          position:absolute;left:18px;top:-2px;white-space:nowrap;
          font-family:ui-monospace,monospace;font-size:9px;font-weight:600;
          letter-spacing:0.08em;color:#34d3c0;text-shadow:0 0 4px #000,0 1px 2px #000;
        ">${label}</div>
      </div>`,
  });
}

/** 30° graticule so the map still gives spatial reference if tiles fail to load. */
function Graticule() {
  const lines = useMemo(() => {
    const out: { positions: [number, number][]; major: boolean }[] = [];
    for (let lon = -180; lon <= 180; lon += 30) {
      out.push({ positions: [[-85, lon], [85, lon]], major: lon === 0 });
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      out.push({ positions: [[lat, -180], [lat, 180]], major: lat === 0 });
    }
    return out;
  }, []);

  return (
    <>
      {lines.map((l, i) => (
        <Polyline
          key={i}
          positions={l.positions}
          pathOptions={{
            color: l.major ? '#2b3947' : '#1e2833',
            weight: l.major ? 1 : 0.5,
            opacity: 0.9,
            interactive: false,
          }}
        />
      ))}
    </>
  );
}

export default function GroundTrackMap() {
  const orbit = useMissionStore((s) => s.orbit);

  if (!orbit) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[11px] text-ink-muted">
        awaiting orbit solution…
      </div>
    );
  }

  const gs = orbit.groundStation;

  return (
    <MapContainer
      center={[18, 60]}
      zoom={2}
      minZoom={1}
      maxZoom={6}
      zoomControl
      attributionControl
      worldCopyJump
      className="h-full w-full"
      style={{ background: '#070b10' }}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap &copy; CARTO — simulated track, not a real spacecraft'
        subdomains="abcd"
        noWrap={false}
      />

      <Graticule />

      {/* Ground station and its visibility circle at the minimum usable elevation */}
      <Marker position={[gs.lat, gs.lon]} icon={stationIcon('KJSIT GS')} />
      <Circle
        center={[gs.lat, gs.lon]}
        radius={2_000_000}
        pathOptions={{
          color: '#34d3c0',
          weight: 1,
          opacity: 0.35,
          fillColor: '#34d3c0',
          fillOpacity: 0.05,
          dashArray: '4 4',
          interactive: false,
        }}
      />

      {orbit.satellites.map((sat) => {
        const color = SAT_COLOR[sat.id] ?? SERIES[0];
        return (
          <div key={sat.id}>
            {/* Past ground track */}
            {splitAtAntimeridian(sat.track).map((seg, i) => (
              <Polyline
                key={`t${i}`}
                positions={seg}
                pathOptions={{ color, weight: 2, opacity: 0.9, interactive: false }}
              />
            ))}
            {/* Predicted ground track */}
            {splitAtAntimeridian(sat.futureTrack).map((seg, i) => (
              <Polyline
                key={`f${i}`}
                positions={seg}
                pathOptions={{
                  color,
                  weight: 1.3,
                  opacity: 0.45,
                  dashArray: '3 5',
                  interactive: false,
                }}
              />
            ))}
            {/* Instantaneous footprint */}
            <Circle
              center={[sat.lat, sat.lon]}
              radius={sat.footprintRadius}
              pathOptions={{
                color,
                weight: 1,
                opacity: 0.4,
                fillColor: color,
                fillOpacity: 0.06,
                interactive: false,
              }}
            />
            <CircleMarker
              center={[sat.lat, sat.lon]}
              radius={13}
              pathOptions={{ color, weight: 0, fillColor: color, fillOpacity: 0.12 }}
            />
            <Marker position={[sat.lat, sat.lon]} icon={satelliteIcon(color, sat.name, sat.sunlit)}>
              <Tooltip direction="bottom" offset={[0, 10]} opacity={1}>
                <div className="font-mono text-[10px] leading-relaxed">
                  <div className="font-semibold">{sat.name}</div>
                  <div>
                    {Math.abs(sat.lat).toFixed(2)}°{sat.lat >= 0 ? 'N' : 'S'}{' '}
                    {Math.abs(sat.lon).toFixed(2)}°{sat.lon >= 0 ? 'E' : 'W'}
                  </div>
                  <div>alt {sat.altitude.toFixed(0)} km · {sat.velocity.toFixed(2)} km/s</div>
                  <div>
                    el {sat.look.elevation.toFixed(1)}° · az {sat.look.azimuth.toFixed(0)}°
                  </div>
                  <div>{sat.sunlit ? 'sunlit' : 'eclipse'} · orbit {sat.orbitNumber}</div>
                </div>
              </Tooltip>
            </Marker>
          </div>
        );
      })}

      {/* Inter-satellite link, drawn only when Earth is not occulting it */}
      {orbit.interSatLos && orbit.satellites.length === 2 && (
        <Polyline
          positions={splitAtAntimeridian([
            { lat: orbit.satellites[0].lat, lon: orbit.satellites[0].lon },
            { lat: orbit.satellites[1].lat, lon: orbit.satellites[1].lon },
          ]).flat()}
          pathOptions={{
            color: '#34d3c0',
            weight: 1.2,
            opacity: 0.6,
            dashArray: '2 4',
            interactive: false,
          }}
        />
      )}
    </MapContainer>
  );
}