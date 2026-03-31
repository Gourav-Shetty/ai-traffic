import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { ModelPredictionState, NETWORK, SimulationState } from '../types';
import { motion } from 'motion/react';
import { Activity } from 'lucide-react';

interface NetworkMapProps {
  simulations: Record<string, SimulationState>;
  modelPredictions: Record<string, ModelPredictionState>;
  onSelectJunction: (id: string) => void;
}

interface TileSource {
  id: string;
  url: string;
  attribution: string;
  subdomains?: string[];
}

interface ClusterBucket {
  members: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    congestion: number;
  }>;
}

const TILE_SOURCES: TileSource[] = [
  {
    id: 'carto-dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: ['a', 'b', 'c', 'd'],
  },
  {
    id: 'osm',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: ['a', 'b', 'c'],
  },
];

const getMarkerColor = (congestion: number) => {
  if (congestion > 80) return '#dc2626'; // red-600
  if (congestion > 50) return '#ca8a04'; // yellow-600
  return '#16a34a'; // green-600
};

function ResilientTileLayer({ onOfflineState }: { onOfflineState: (offline: boolean) => void }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = TILE_SOURCES[sourceIndex];

  const eventHandlers = useMemo(
    () => ({
      tileerror: () => {
        setSourceIndex((previous) => {
          if (previous < TILE_SOURCES.length - 1) {
            onOfflineState(false);
            return previous + 1;
          }
          onOfflineState(true);
          return previous;
        });
      },
      load: () => {
        onOfflineState(false);
      },
    }),
    [onOfflineState]
  );

  return (
    <TileLayer
      key={source.id}
      url={source.url}
      attribution={source.attribution}
      subdomains={source.subdomains}
      eventHandlers={eventHandlers}
    />
  );
}

function LeafletHeatLayer({ simulations }: { simulations: Record<string, SimulationState> }) {
  const map = useMap();
  const heatLayerRef = useRef<L.HeatLayer | null>(null);

  useEffect(() => {
    if (!heatLayerRef.current) {
      heatLayerRef.current = L.heatLayer([], {
        radius: 48,
        blur: 30,
        maxZoom: 18,
        minOpacity: 0.3,
        max: 0.65,
        gradient: {
          0.15: '#16a34a',
          0.45: '#ca8a04',
          0.75: '#dc2626',
        },
      }).addTo(map);
    }

    const points = NETWORK.map((junction) => {
      const congestion = simulations[junction.id]?.congestionLevel ?? 0;
      // Keep a small floor so low congestion still emits a visible aura.
      const intensity = Math.min(1, Math.max(0.12, congestion / 100));
      return [junction.lat, junction.lng, intensity] as [number, number, number];
    });

    heatLayerRef.current.setLatLngs(points);
  }, [map, simulations]);

  useEffect(() => {
    return () => {
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
    };
  }, [map]);

  return null;
}

function CongestionAuraLayer({ simulations }: { simulations: Record<string, SimulationState> }) {
  return (
    <>
      {NETWORK.map((junction) => {
        const congestion = simulations[junction.id]?.congestionLevel ?? 0;
        if (congestion <= 0) return null;

        const color = getMarkerColor(congestion);
        const radius = 120 + congestion * 10;
        const opacity = Math.min(0.25, 0.06 + congestion / 500);

        return (
          <Circle
            key={`aura-${junction.id}`}
            center={[junction.lat, junction.lng]}
            radius={radius}
            pathOptions={{
              color,
              fillColor: color,
              opacity: 0,
              fillOpacity: opacity,
            }}
          />
        );
      })}
    </>
  );
}

function ClusteredJunctionMarkers({
  simulations,
  modelPredictions,
  onSelectJunction,
}: NetworkMapProps) {
  const map = useMap();
  const [refreshTick, setRefreshTick] = useState(0);

  useMapEvents({
    zoomend: () => setRefreshTick((current) => current + 1),
    moveend: () => setRefreshTick((current) => current + 1),
  });

  const groupedMarkers = useMemo(() => {
    const zoom = map.getZoom();
    const gridSize = 0.008 * Math.pow(2, Math.max(0, 14 - zoom));
    const buckets = new Map<string, ClusterBucket>();

    for (const junction of NETWORK) {
      const congestion = simulations[junction.id]?.congestionLevel ?? 0;
      const latKey = Math.floor(junction.lat / gridSize);
      const lngKey = Math.floor(junction.lng / gridSize);
      const key = `${latKey}:${lngKey}`;

      const existing = buckets.get(key);
      const node = {
        id: junction.id,
        name: junction.name,
        lat: junction.lat,
        lng: junction.lng,
        congestion,
      };

      if (existing) {
        existing.members.push(node);
      } else {
        buckets.set(key, { members: [node] });
      }
    }

    return Array.from(buckets.values());
  }, [map, refreshTick, simulations]);

  return (
    <>
      {groupedMarkers.map((bucket, index) => {
        if (bucket.members.length === 1) {
          const single = bucket.members[0];
          const sim = simulations[single.id];
          const prediction = modelPredictions[single.id];
          const color = getMarkerColor(single.congestion);
          const isRelieving = sim?.relievingNeighbor !== null;

          return (
            <CircleMarker
              key={single.id}
              center={[single.lat, single.lng]}
              radius={8}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: color,
                fillOpacity: 1,
              }}
            >
              <Popup className="traffic-popup" closeButton={true} autoPan={true}>
                <div className="p-1 min-w-[200px] text-black font-sans">
                  <h3 className="font-bold text-lg mb-2">{single.name}</h3>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Congestion:</span>
                    <span style={{ color, fontWeight: 'bold' }}>{Math.round(single.congestion)}%</span>
                  </div>
                  <div className="flex justify-between text-sm mb-3">
                    <span className="text-gray-600">Active Lane:</span>
                    <span className="font-medium">{sim ? `Lane ${sim.activeGreenLane + 1}` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-3">
                    <span className="text-gray-600">Model Status:</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${prediction?.source === 'model' ? 'text-emerald-700 bg-emerald-100' : 'text-yellow-700 bg-yellow-100'}`}>
                      {prediction?.source === 'model' ? 'Live Model' : 'Fallback'}
                    </span>
                  </div>
                  {isRelieving && (
                    <div className="flex items-center gap-2 text-xs text-[#F27D26] bg-[#F27D26]/10 p-2 rounded-lg mb-3">
                      <Activity className="w-3 h-3" />
                      <span>Relieving traffic for adjacent node</span>
                    </div>
                  )}
                  <button
                    onClick={() => onSelectJunction(single.id)}
                    className="w-full py-2 mt-2 bg-[#050505] text-white hover:bg-[#1a1a1a] rounded-lg text-sm font-bold transition-colors"
                  >
                    Open Junction Control
                  </button>
                </div>
              </Popup>
            </CircleMarker>
          );
        }

        const averageLat = bucket.members.reduce((sum, node) => sum + node.lat, 0) / bucket.members.length;
        const averageLng = bucket.members.reduce((sum, node) => sum + node.lng, 0) / bucket.members.length;
        const averageCongestion = bucket.members.reduce((sum, node) => sum + node.congestion, 0) / bucket.members.length;
        const color = getMarkerColor(averageCongestion);

        return (
          <CircleMarker
            key={`cluster-${index}`}
            center={[averageLat, averageLng]}
            radius={Math.min(18, 9 + bucket.members.length * 1.2)}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              fillColor: color,
              fillOpacity: 0.9,
            }}
            eventHandlers={{
              click: () => {
                const nextZoom = Math.min(18, map.getZoom() + 2);
                map.flyTo([averageLat, averageLng], nextZoom, { duration: 0.4 });
              },
            }}
          >
            <Tooltip permanent direction="center" offset={[0, 0]} className="cluster-label">
              <span className="text-[11px] font-black text-white">{bucket.members.length}</span>
            </Tooltip>
            <Popup className="traffic-popup" closeButton={true} autoPan={true}>
              <div className="text-black min-w-[220px] font-sans">
                <h3 className="font-bold text-sm mb-2">Clustered Junctions ({bucket.members.length})</h3>
                <p className="text-xs text-gray-600 mb-2">Average congestion: {Math.round(averageCongestion)}%</p>
                <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                  {bucket.members.map((node) => (
                    <div key={node.id} className="flex justify-between">
                      <span>{node.name}</span>
                      <span style={{ color: getMarkerColor(node.congestion), fontWeight: 700 }}>{Math.round(node.congestion)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

export function NetworkMap({ simulations, modelPredictions, onSelectJunction }: NetworkMapProps) {
  const [isOfflineTiles, setIsOfflineTiles] = useState(false);

  return (
    <div className="absolute inset-0 w-full h-full bg-[#050505]">
      <MapContainer
        center={[12.917361, 77.622833]}
        zoom={14}
        minZoom={11}
        maxZoom={19}
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <ResilientTileLayer onOfflineState={setIsOfflineTiles} />
        <LeafletHeatLayer simulations={simulations} />
        <CongestionAuraLayer simulations={simulations} />
        <ClusteredJunctionMarkers
          simulations={simulations}
          modelPredictions={modelPredictions}
          onSelectJunction={onSelectJunction}
        />
      </MapContainer>

      {isOfflineTiles && (
        <div className="absolute bottom-6 right-6 z-[1000] px-3 py-2 rounded-lg bg-black/75 border border-white/20 text-xs text-white/80">
          Tile provider unavailable. Running in low-connectivity fallback mode.
        </div>
      )}

      {/* Map HUD */}
      <div className="absolute top-8 left-8 pointer-events-none z-[1000]">
        <motion.div 
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="flex flex-col gap-1 bg-[#151619]/90 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-xl"
        >
          <h2 className="text-2xl font-black tracking-tighter uppercase leading-none text-white">
            Traffic<span className="text-[#F27D26]">AI</span> Network
          </h2>
          <p className="text-xs text-white/60">Select a junction to monitor and control live traffic</p>
        </motion.div>
      </div>
    </div>
  );
}
