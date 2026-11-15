import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CHIMOIO_CENTRO } from "@contracts/types";

/** Mapa de entrega — OpenStreetMap com opção de vista de satélite (Esri).
    O cliente toca/arrasta o marcador para indicar o local exacto da entrega. */
export default function MapaEntrega({ lat, lng, onPick }: {
  lat: number | null; lng: number | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const layersRef = useRef<{ ruas: L.TileLayer; satelite: L.TileLayer } | null>(null);
  const [satelite, setSatelite] = useState(false);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const centro: L.LatLngExpression = lat != null && lng != null ? [lat, lng] : CHIMOIO_CENTRO;
    // zoom 13: mostra logo o Distrito de Chimoio por inteiro (zona de entregas)
    const map = L.map(ref.current, { center: centro, zoom: lat != null && lng != null ? 16 : 13, attributionControl: false });

    const ruas = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 });
    const sat = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19 },
    );
    ruas.addTo(map);
    layersRef.current = { ruas, satelite: sat };

    const icon = L.divIcon({
      html: '<div style="font-size:30px;transform:translate(-50%,-92%);text-shadow:0 2px 4px rgba(0,0,0,.4)">📍</div>',
      className: "", iconSize: [0, 0],
    });
    const marker = L.marker(centro, { draggable: true, icon }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      onPick(+p.lat.toFixed(6), +p.lng.toFixed(6));
    });
    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onPick(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6));
    });
    markerRef.current = marker;
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; layersRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // centra no marcador quando as coordenadas mudam por fora
  useEffect(() => {
    if (lat != null && lng != null && markerRef.current && mapRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    }
  }, [lat, lng]);

  const trocarCamada = (sat: boolean) => {
    const ls = layersRef.current, map = mapRef.current;
    if (!ls || !map) return;
    setSatelite(sat);
    map.removeLayer(sat ? ls.ruas : ls.satelite);
    (sat ? ls.satelite : ls.ruas).addTo(map);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <button type="button" className={`c-btn c-btn-peq ${!satelite ? "c-btn-prim" : "c-btn-cinza"}`} onClick={() => trocarCamada(false)}>
          🗺️ Mapa
        </button>
        <button type="button" className={`c-btn c-btn-peq ${satelite ? "c-btn-prim" : "c-btn-cinza"}`} onClick={() => trocarCamada(true)}>
          🛰️ Satélite
        </button>
        {lat != null && lng != null && (
          <span className="c-sub" style={{ alignSelf: "center", marginLeft: "auto" }}>📍 {lat.toFixed(5)}, {lng.toFixed(5)}</span>
        )}
      </div>
      <div ref={ref} style={{ height: 240, borderRadius: 12, border: "1.5px solid #e6dcec", zIndex: 1 }} />
      <p className="c-sub" style={{ margin: "4px 2px 0" }}>Toque no mapa ou arraste o 📍 para marcar o local exacto da entrega.</p>
    </div>
  );
}
