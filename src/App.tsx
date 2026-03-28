/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { Simulation } from './components/Simulation';
import { ControlPanel } from './components/ControlPanel';
import { NetworkMap } from './components/NetworkMap';
import { Activity, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LaneDebugMetrics, 
  laneIntensityToVehicleCount, 
  ModelPredictionState, 
  NETWORK, 
  SimulationState,
  NeighborState,
  NetworkMetrics,
  CoordinationRequest,
  CoordinationAction,
  getLaneConnectionForLane,
  getIncomingConnectionsTo,
  COORDINATION_CONGESTION_THRESHOLD,
  COORDINATION_MILD_EXTENSION,
  COORDINATION_MODERATE_EXTENSION,
  COORDINATION_SEVERE_EXTENSION,
  COORDINATION_MAX_TOTAL_EXTENSION_PERCENT
} from './types';

const MIN_GREEN_SECONDS = 5;
const MAX_GREEN_SECONDS = 60;
const EMERGENCY_ENTRY_CLEARANCE_SECONDS = 2;
const EMERGENCY_RECOVERY_CLEARANCE_SECONDS = 2;
const EMERGENCY_MIN_GREEN_SECONDS = 12;
const EMERGENCY_EXTENSION_SECONDS = 6;
const CORRIDOR_ENTRY_CLEARANCE_SECONDS = 1;
const CORRIDOR_RECOVERY_CLEARANCE_SECONDS = 1;
const CORRIDOR_MIN_GREEN_SECONDS = 8;
const CORRIDOR_EXTENSION_SECONDS = 3;
const CORRIDOR_MAX_HOPS = 4;
const NEIGHBOR_TRANSFER_EFFICIENCY = 0.85;
const SPILLOVER_START_CONGESTION = 60;
const MAX_SPILLOVER_PER_TICK = 1.2;
const DOWNSTREAM_BACKPRESSURE_START = 55;
const MAX_BACKPRESSURE_PER_TICK = 1.5;
const LINK_TRANSFER_CAPACITY_PER_TICK = 2.0;
const LINK_IN_TRANSIT_CAPACITY = 12.0;
const SPILLBACK_RATIO = 0.8;

interface TransitPacket {
  fromId: string;
  toId: string;
  toLane: number;
  amount: number;
  remainingTicks: number;
}

interface LinkFlowDebugRow {
  key: string;
  fromId: string;
  toId: string;
  toLane: number;
  accepted: number;
  blocked: number;
  arrived: number;
  inTransit: number;
}

interface EmergencyCorridorRequest {
  sourceId: string;
  desiredLane: number;
  hop: number;
}

interface EmergencyCorridorHop {
  fromId: string;
  toId: string;
  outgoingLane: number;
  incomingLane: number;
  hop: number;
}

interface EmergencyCorridorPlan {
  sourceId: string;
  headingLane: number;
  hops: EmergencyCorridorHop[];
}

function clampGreenTime(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(MIN_GREEN_SECONDS, Math.min(MAX_GREEN_SECONDS, Math.round(value)));
}

function buildModelInput(sim: SimulationState) {
  const [lane1, lane2, lane3, lane4] = sim.trafficIntensity.map((v) => laneIntensityToVehicleCount(v));
  const now = new Date();
  const hour = now.getHours();
  const isPeak = (hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20) ? 1 : 0;
  const avgLoad = sim.trafficIntensity.reduce((sum, value) => sum + value, 0) / 4;

  return {
    lane_1_count: lane1,
    lane_2_count: lane2,
    lane_3_count: lane3,
    lane_4_count: lane4,
    hour,
    is_peak: isPeak,
    heavy_ratio: Math.min(1, Math.max(0, 0.12 + avgLoad / 400)),
    two_wheeler_ratio: Math.min(1, Math.max(0, 0.3 + avgLoad / 500)),
    emergency: sim.emergencyActive ? 1 : 0,
  };
}

function fallbackTimings(sim: SimulationState): number[] {
  return sim.trafficIntensity.map((intensity) => clampGreenTime(8 + (intensity / 100) * 20));
}

/**
 * Build neighbor states for a junction based on upstream sims
 * This lets us know what traffic is coming from where
 */
function buildNeighborStates(
  junctionId: string,
  allSimulations: Record<string, SimulationState>
): NeighborState[] {
  const incoming = getIncomingConnectionsTo(junctionId);
  return incoming.map(({ fromJunction, fromLane, toIncomingLane }) => {
    const neighborSim = allSimulations[fromJunction];
    return {
      junctionId: fromJunction,
      incomingLane: toIncomingLane,
      neighborCongestion: neighborSim?.congestionLevel ?? 50,
      neighborActiveGreen: neighborSim?.activeGreenLane ?? -1,
      neighborRelieves: neighborSim?.activeGreenLane === fromLane, // is their green pointing at us?
    };
  });
}

/**
 * Calculate network-wide aggregated metrics
 */
function calculateNetworkMetrics(allSimulations: Record<string, SimulationState>): NetworkMetrics {
  const congestions = Object.values(allSimulations).map(s => s.congestionLevel);
  const avgCongestion = congestions.length > 0 
    ? congestions.reduce((a, b) => a + b, 0) / congestions.length 
    : 0;

  return {
    avgCongestion: Math.round(avgCongestion),
    maxCongestion: Math.max(...congestions, 0),
    junctionsInCongestion: congestions.filter(c => c > 50).length,
    networkCapacity: Object.values(allSimulations).reduce(
      (sum, s) => sum + s.trafficIntensity.reduce((a, b) => a + b, 0) / 4,
      0
    ) / Object.keys(allSimulations).length,
    lastUpdated: Date.now(),
  };
}

/**
 * Generate coordination requests for neighbors
 * Called by congested junctions to ask neighbors for help
 */
function generateCoordinationRequest(
  junctionId: string,
  sim: SimulationState,
  allSimulations: Record<string, SimulationState>
): CoordinationRequest | null {
  const { congestionLevel } = sim;
  
  // Only request help if significantly congested
  if (congestionLevel < COORDINATION_CONGESTION_THRESHOLD) {
    return null;
  }

  // Calculate urgency
  let urgency: 'mild' | 'moderate' | 'severe' = 'mild';
  if (congestionLevel > 75) urgency = 'severe';
  else if (congestionLevel > 65) urgency = 'moderate';

  // Identify which incoming lanes have the most traffic (candidates for relief)
  const incomingConnections = getIncomingConnectionsTo(junctionId);
  const preferredLanes = incomingConnections
    .map(conn => ({ lane: conn.toIncomingLane, intensity: sim.trafficIntensity[conn.toIncomingLane] }))
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 2) // prioritize top 2 lanes
    .map(x => x.lane);

  return {
    junctionId,
    requiredCongestion: Math.round(congestionLevel),
    preferredLanes,
    urgency
  };
}

/**
 * Evaluate incoming coordination requests from neighbors
 * Decide how much help we can afford to give
 */
function evaluateCoordinationRequests(
  junctionId: string,
  sim: SimulationState,
  requests: CoordinationRequest[]
): CoordinationAction[] {
  const actions: CoordinationAction[] = [];
  
  // Only help if we're not in crisis ourselves
  if (sim.congestionLevel > 70) {
    return []; // prioritize own congestion when critical
  }

  for (const request of requests) {
    // Find which of our lanes connects to the requesting junction
    const outgoingToRequester = NETWORK
      .find(j => j.id === junctionId)
      ?.laneConnections
      .filter(conn => conn.neighborId === request.junctionId);

    if (!outgoingToRequester || outgoingToRequester.length === 0) {
      continue; // not directly connected
    }

    // Determine how much help to give
    let extension = COORDINATION_MILD_EXTENSION;
    if (request.urgency === 'moderate') extension = COORDINATION_MODERATE_EXTENSION;
    else if (request.urgency === 'severe') extension = COORDINATION_SEVERE_EXTENSION;

    // Scale extension based on our own congestion
    const congestionFactor = 1 - (sim.congestionLevel / 100) * 0.5;
    const scaledExtension = Math.round(extension * congestionFactor);

    if (scaledExtension > 0) {
      for (const conn of outgoingToRequester) {
        actions.push({
          helpingJunctionId: request.junctionId,
          lane: conn.lane,
          extensionSeconds: scaledExtension,
          reason: `Helping ${request.junctionId} (${request.requiredCongestion}% congestion)`
        });
      }
    }
  }

  return actions;
}

/**
 * Calculate the adjusted green time for a lane considering coordination
 */
function calculateCoordinationAdjustedTiming(
  baseTimingSeconds: number,
  lane: number,
  coordinationActions: CoordinationAction[]
): number {
  const relevantActions = coordinationActions.filter(a => a.lane === lane);
  
  if (relevantActions.length === 0) {
    return baseTimingSeconds;
  }

  // Sum extensions for this lane
  const totalExtension = relevantActions.reduce((sum, a) => sum + a.extensionSeconds, 0);
  
  // Cap extension to not exceed max percentage
  const maxAllowedExtension = (baseTimingSeconds * COORDINATION_MAX_TOTAL_EXTENSION_PERCENT) / 100;
  const cappedExtension = Math.min(totalExtension, maxAllowedExtension);

  return Math.round(baseTimingSeconds + cappedExtension);
}

// Infer which lane at `fromId` points toward `toId` using map coordinates.
// 0=North, 1=East, 2=South, 3=West
function inferLaneTowardsNeighbor(fromId: string, toId: string): number | null {
  const from = NETWORK.find((j) => j.id === fromId);
  const to = NETWORK.find((j) => j.id === toId);
  if (!from || !to) return null;

  const dLat = to.lat - from.lat;
  const dLng = to.lng - from.lng;

  if (Math.abs(dLng) >= Math.abs(dLat)) {
    return dLng >= 0 ? 1 : 3;
  }

  return dLat >= 0 ? 0 : 2;
}

function estimateTravelTicks(fromId: string, toId: string): number {
  const from = NETWORK.find((j) => j.id === fromId);
  const to = NETWORK.find((j) => j.id === toId);
  if (!from || !to) return 3;

  const dLat = to.lat - from.lat;
  const dLng = to.lng - from.lng;
  const distance = Math.sqrt(dLat * dLat + dLng * dLng);

  // Convert map distance to a stable simulation delay band.
  return Math.max(2, Math.min(6, Math.round(distance * 800)));
}

function linkKey(fromId: string, toId: string, toLane: number): string {
  return `${fromId}->${toId}:${toLane}`;
}

function laneToHeading(lane: number): { lat: number; lng: number } {
  switch (lane) {
    // Lane ids are approach lanes.
    // Example: South lane means vehicles approach from South and travel Northbound.
    case 0: return { lat: -1, lng: 0 };  // North approach -> Southbound travel
    case 1: return { lat: 0, lng: -1 };  // East approach -> Westbound travel
    case 2: return { lat: 1, lng: 0 };   // South approach -> Northbound travel
    case 3: return { lat: 0, lng: 1 };   // West approach -> Eastbound travel
    default: return { lat: 0, lng: 0 };
  }
}

// Incoming approach lane at downstream junction for a given travel heading.
// If vehicle travels North, it enters the next junction from South lane (2), etc.
function incomingLaneForHeading(heading: { lat: number; lng: number }): number {
  if (Math.abs(heading.lat) >= Math.abs(heading.lng)) {
    return heading.lat >= 0 ? 2 : 0;
  }
  return heading.lng >= 0 ? 3 : 1;
}

function chooseNextLaneForHeading(
  junctionId: string,
  heading: { lat: number; lng: number },
  visited: Set<string>,
): number | null {
  const junction = NETWORK.find((j) => j.id === junctionId);
  if (!junction) return null;

  let bestLane: number | null = null;
  let bestScore = -Infinity;

  for (const conn of junction.laneConnections) {
    if (visited.has(conn.neighborId)) continue;
    const neighbor = NETWORK.find((j) => j.id === conn.neighborId);
    if (!neighbor) continue;

    const dLat = neighbor.lat - junction.lat;
    const dLng = neighbor.lng - junction.lng;
    const mag = Math.sqrt(dLat * dLat + dLng * dLng);
    if (mag <= 0) continue;

    const ndLat = dLat / mag;
    const ndLng = dLng / mag;
    const score = ndLat * heading.lat + ndLng * heading.lng;

    if (score > bestScore) {
      bestScore = score;
      bestLane = conn.lane;
    }
  }

  if (bestScore <= 0) return null;
  return bestLane;
}

function buildEmergencyCorridorRequests(
  sims: Record<string, SimulationState>,
): {
  requests: Record<string, EmergencyCorridorRequest>;
  plans: Record<string, EmergencyCorridorPlan>;
} {
  const requests: Record<string, EmergencyCorridorRequest> = {};
  const plans: Record<string, EmergencyCorridorPlan> = {};

  for (const [sourceId, sim] of Object.entries(sims)) {
    if (!sim?.emergencyActive || sim.emergencyLane === null || sim.emergencyLane === undefined) continue;

    const heading = laneToHeading(sim.emergencyLane);
    const visited = new Set<string>([sourceId]);
    let currentId = sourceId;
    const hops: EmergencyCorridorHop[] = [];

    for (let hop = 1; hop <= CORRIDOR_MAX_HOPS; hop++) {
      const currentJunction = NETWORK.find((j) => j.id === currentId);
      if (!currentJunction) break;

      const chosenLane = chooseNextLaneForHeading(currentId, heading, visited);
      if (chosenLane === null) break;

      const conn = currentJunction.laneConnections.find((c) => c.lane === chosenLane);
      if (!conn) break;

      if (visited.has(conn.neighborId)) break;
      visited.add(conn.neighborId);

      if (!requests[conn.neighborId] || hop < requests[conn.neighborId].hop) {
        requests[conn.neighborId] = {
          sourceId,
          desiredLane: incomingLaneForHeading(heading),
          hop,
        };
      }

      hops.push({
        fromId: currentId,
        toId: conn.neighborId,
        outgoingLane: chosenLane,
        incomingLane: incomingLaneForHeading(heading),
        hop,
      });

      currentId = conn.neighborId;
    }

    plans[sourceId] = {
      sourceId,
      headingLane: sim.emergencyLane,
      hops,
    };
  }

  return { requests, plans };
}

function normalizeLane(value: unknown): number {
  const lane = Number(value);
  if (!Number.isFinite(lane)) return 0;
  if (lane === -1) return -1;
  return ((Math.round(lane) % 4) + 4) % 4;
}

function normalizeTrafficIntensity(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 4) {
    return [50, 50, 50, 50];
  }

  return value.slice(0, 4).map((item) => {
    const num = Number(item);
    if (!Number.isFinite(num)) return 50;
    return Math.max(0, Math.min(100, num));
  });
}

function normalizeSimulation(raw: Partial<SimulationState> | undefined, id: string, name: string): SimulationState {
  const trafficIntensity = normalizeTrafficIntensity(raw?.trafficIntensity);
  const countdownRaw = Number(raw?.countdown);
  const emergencyLaneRaw = raw?.emergencyLane === null || raw?.emergencyLane === undefined
    ? null
    : normalizeLane(raw.emergencyLane);
  const emergencyLane = emergencyLaneRaw === -1 ? null : emergencyLaneRaw;

  return {
    id,
    name,
    activeGreenLane: normalizeLane(raw?.activeGreenLane),
    countdown: Number.isFinite(countdownRaw) ? Math.max(1, Math.round(countdownRaw)) : 10,
    emergencyActive: !!raw?.emergencyActive,
    emergencyLane,
    corridorEmergencyActive: !!raw?.corridorEmergencyActive,
    corridorEmergencyLane: raw?.corridorEmergencyLane === null || raw?.corridorEmergencyLane === undefined
      ? null
      : normalizeLane(raw.corridorEmergencyLane),
    corridorEmergencySource: raw?.corridorEmergencySource ?? null,
    trafficIntensity,
    congestionLevel: Number.isFinite(Number(raw?.congestionLevel))
      ? Math.max(0, Math.min(100, Number(raw?.congestionLevel)))
      : trafficIntensity.reduce((sum, v) => sum + v, 0) / 4,
    relievingNeighbor: raw?.relievingNeighbor ?? null,
    neighborStates: Array.isArray(raw?.neighborStates) ? raw.neighborStates : [],
    coordinationRequests: Array.isArray(raw?.coordinationRequests) ? raw.coordinationRequests : [],
    coordinationActions: Array.isArray(raw?.coordinationActions) ? raw.coordinationActions : [],
    networkMetrics: raw?.networkMetrics ?? null,
    history: Array.isArray(raw?.history) ? raw!.history : [],
  };
}

export default function App() {
  const [simulations, setSimulations] = useState<Record<string, SimulationState>>({});
  const [localSimulations, setLocalSimulations] = useState<Record<string, SimulationState>>({});
  const [selectedJunctionId, setSelectedJunctionId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [modelPredictions, setModelPredictions] = useState<Record<string, ModelPredictionState>>({});
  const [laneDebugMetrics, setLaneDebugMetrics] = useState<LaneDebugMetrics[]>([]);
  const [isDebugPanelCollapsed, setIsDebugPanelCollapsed] = useState(true);
  const [isLinkDebugCollapsed, setIsLinkDebugCollapsed] = useState(true);
  const latestSimulationsRef = useRef<Record<string, SimulationState>>({});
  const lanePointerRef = useRef<Record<string, number>>({});
  const emergencyStateRef = useRef<Record<string, { active: boolean; resumePointer: number }>>({});
  const transitPacketsRef = useRef<TransitPacket[]>([]);
  const linkFlowDebugRef = useRef<Record<string, LinkFlowDebugRow>>({});
  const corridorPlansRef = useRef<Record<string, EmergencyCorridorPlan>>({});

  useEffect(() => {
    NETWORK.forEach((junction) => {
      if (lanePointerRef.current[junction.id] === undefined) {
        lanePointerRef.current[junction.id] = 0;
      }
    });
  }, []);

  useEffect(() => {
    (window as any).setLocalSimulations = setLocalSimulations;
    return () => {
      delete (window as any).setLocalSimulations;
    };
  }, []);

  useEffect(() => {
    latestSimulationsRef.current = localSimulations;
  }, [localSimulations]);

  // Sync from Local SQLite Database
  useEffect(() => {
    const fetchInitialState = async () => {
      try {
        const response = await fetch('/api/simulations');
        const sims = await response.json();

        // Initialize missing nodes and normalize current state upfront.
        const initializedSims: Record<string, SimulationState> = {};
        const missingInitializers: Promise<Response>[] = [];

        for (const j of NETWORK) {
          const existing = sims[j.id];
          if (!existing) {
            const initialState: SimulationState = {
              id: j.id,
              name: j.name,
              activeGreenLane: 0,
              countdown: 10,
              emergencyActive: false,
              emergencyLane: null,
              corridorEmergencyActive: false,
              corridorEmergencyLane: null,
              corridorEmergencySource: null,
              trafficIntensity: [50, 50, 50, 50],
              congestionLevel: 50,
              relievingNeighbor: null,
              neighborStates: [],
              coordinationRequests: [],
              coordinationActions: [],
              networkMetrics: null,
              history: []
            };

            initializedSims[j.id] = initialState;
            missingInitializers.push(
              fetch(`/api/simulations/${j.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(initialState)
              })
            );
          } else {
            initializedSims[j.id] = normalizeSimulation(existing, j.id, j.name);
          }

          if (lanePointerRef.current[j.id] === undefined) {
            lanePointerRef.current[j.id] = 0;
          }
        }

        // Persist any missing node defaults in parallel without blocking history aggregation.
        if (missingInitializers.length > 0) {
          Promise.allSettled(missingInitializers).catch(() => {});
        }

        // Fetch all node history in parallel.
        const historyEntries = await Promise.all(
          NETWORK.map(async (j) => {
            try {
              const historyRes = await fetch(`/api/history/${j.id}`);
              const history = await historyRes.json();
              return [j.id, Array.isArray(history) ? history : []] as const;
            } catch {
              return [j.id, []] as const;
            }
          })
        );

        for (const [junctionId, history] of historyEntries) {
          const normalizedHistory = history.map((entry: any) => ({
            time: String(entry?.time ?? ''),
            congestion: Number(entry?.congestion ?? 0),
          }));

          initializedSims[junctionId] = {
            ...initializedSims[junctionId],
            history: normalizedHistory,
          };
        }
        
        setSimulations(initializedSims);
        setLocalSimulations(initializedSims);
        setIsInitialized(true);
      } catch (err) {
        console.error("Failed to fetch initial state:", err);
        // Fallback to local only if server is down
        const fallback: Record<string, SimulationState> = {};
        NETWORK.forEach(j => {
          fallback[j.id] = normalizeSimulation(undefined, j.id, j.name);
          lanePointerRef.current[j.id] = 0;
        });
        setLocalSimulations(fallback);
        setIsInitialized(true);
      }
    };

    fetchInitialState();
  }, []);

  // Staggered ML prediction fetching (avoid thundering herd)
  // Each junction fetches ~1 second apart in a rotating pattern
  useEffect(() => {
    if (!isInitialized) return;

    let isMounted = true;
    const intervals: NodeJS.Timeout[] = [];

    NETWORK.forEach((junction, index) => {
      // Stagger each junction's fetch by 1 second to avoid all requests at once
      const staggerMs = (index * 1000) % 4000;
      const fetchIntervalMs = 4000;

      const fetchJunctionPrediction = async () => {
        const currentSimulations = latestSimulationsRef.current;
        const sim = currentSimulations[junction.id];
        if (!sim) return;

        try {
          const response = await fetch('/api/ml/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildModelInput(sim)),
          });

          if (!response.ok) {
            throw new Error(`Model request failed with ${response.status}`);
          }

          const data = await response.json();
          const timings = [data.green_1, data.green_2, data.green_3, data.green_4].map(clampGreenTime);

          if (!isMounted) return;

          setModelPredictions(prev => ({
            ...prev,
            [junction.id]: { timings, source: 'model', updatedAt: Date.now() } as ModelPredictionState
          }));
        } catch (error) {
          console.error(`Prediction error for ${junction.id}:`, error);
          if (!isMounted) return;

          setModelPredictions(prev => ({
            ...prev,
            [junction.id]: { 
              timings: fallbackTimings(sim), 
              source: 'fallback', 
              updatedAt: Date.now() 
            } as ModelPredictionState
          }));
        }
      };

      // Initial staggered fetch
      const initialTimeout = setTimeout(fetchJunctionPrediction, staggerMs);
      intervals.push(initialTimeout);

      // Recurring fetch at regular interval after stagger
      const recursiveInterval = setInterval(fetchJunctionPrediction, fetchIntervalMs);
      intervals.push(recursiveInterval as any);
    });

    return () => {
      isMounted = false;
      intervals.forEach(i => {
        typeof i === 'number' ? clearTimeout(i) : clearInterval(i);
      });
    };
  }, [isInitialized]);

  // Global Orchestration loop with neighbor awareness
  useEffect(() => {
    if (!isInitialized) return;

    const interval = setInterval(() => {
      setLocalSimulations(prev => {
        const next = { ...prev };
        const tickLinkStats: Record<string, LinkFlowDebugRow> = {};

        // Normalize upfront so in-transit arrivals can be applied safely before junction updates.
        NETWORK.forEach((junction) => {
          next[junction.id] = normalizeSimulation(next[junction.id], junction.id, junction.name);
        });

        // Move vehicles on links and deliver arrivals after their travel delay.
        const deliveredPackets: TransitPacket[] = [];
        for (const packet of transitPacketsRef.current) {
          packet.remainingTicks -= 1;
          if (packet.remainingTicks <= 0) {
            deliveredPackets.push(packet);
          }
        }

        transitPacketsRef.current = transitPacketsRef.current.filter((p) => p.remainingTicks > 0);

        for (const packet of deliveredPackets) {
          const k = linkKey(packet.fromId, packet.toId, packet.toLane);
          if (!tickLinkStats[k]) {
            tickLinkStats[k] = {
              key: k,
              fromId: packet.fromId,
              toId: packet.toId,
              toLane: packet.toLane,
              accepted: 0,
              blocked: 0,
              arrived: 0,
              inTransit: 0,
            };
          }
          tickLinkStats[k].arrived += packet.amount;

          const receiver = next[packet.toId];
          if (!receiver) continue;
          const nextIntensity = [...receiver.trafficIntensity];
          nextIntensity[packet.toLane] = Math.min(100, nextIntensity[packet.toLane] + packet.amount);
          next[packet.toId] = {
            ...receiver,
            trafficIntensity: nextIntensity,
            relievingNeighbor: packet.fromId,
          };
        }

        const corridorData = buildEmergencyCorridorRequests(next);
        const corridorRequests = corridorData.requests;
        corridorPlansRef.current = corridorData.plans;
        
        NETWORK.forEach(junction => {
          const sim = normalizeSimulation(next[junction.id], junction.id, junction.name);
          next[junction.id] = sim;

          let nextActiveLane = sim.activeGreenLane;
          let nextCountdown = sim.countdown - 1;
          let relievingNeighbor = null;
          const emergencyState = emergencyStateRef.current[junction.id] ?? {
            active: false,
            resumePointer: lanePointerRef.current[junction.id] ?? 0,
          };

          emergencyStateRef.current[junction.id] = emergencyState;

          const prediction = modelPredictions[junction.id];
          const timings = prediction?.timings?.length === 4
            ? prediction.timings
            : fallbackTimings(sim);
          const corridorRequest = corridorRequests[junction.id];
          const hasLocalEmergency = sim.emergencyActive && sim.emergencyLane !== null && sim.emergencyLane !== undefined;
          const hasCorridorEmergency = !hasLocalEmergency && !!corridorRequest;
          const effectiveEmergencyLane = hasLocalEmergency
            ? sim.emergencyLane
            : corridorRequest?.desiredLane ?? null;

          // Build neighbor awareness
          const neighborStates = buildNeighborStates(junction.id, next);

          // COORDINATION PHASE 1: Generate our own coordination request if needed
          const ourCoordinationRequest = generateCoordinationRequest(junction.id, sim, next);

          // COORDINATION PHASE 2: Collect all neighbor requests (neighbors asking us for help)
          const incomingRequests: CoordinationRequest[] = [];
          const incomingConnections = getIncomingConnectionsTo(junction.id);
          for (const { fromJunction } of incomingConnections) {
            const neighborRequest = generateCoordinationRequest(fromJunction, next[fromJunction], next);
            if (neighborRequest) {
              incomingRequests.push(neighborRequest);
            }
          }

          // COORDINATION PHASE 3: Evaluate how we can help neighbors
          const coordinationActions = evaluateCoordinationRequests(junction.id, sim, incomingRequests);

          if (effectiveEmergencyLane !== null && effectiveEmergencyLane !== undefined) {
            if (!emergencyState.active) {
              emergencyState.active = true;
              emergencyState.resumePointer = lanePointerRef.current[junction.id] ?? ((sim.activeGreenLane + 1 + 4) % 4);
            }

            const emergencyLane = effectiveEmergencyLane;
            const emergencyTiming = Math.max(
              hasCorridorEmergency ? CORRIDOR_MIN_GREEN_SECONDS : EMERGENCY_MIN_GREEN_SECONDS,
              clampGreenTime(timings[emergencyLane] ?? (hasCorridorEmergency ? CORRIDOR_MIN_GREEN_SECONDS : EMERGENCY_MIN_GREEN_SECONDS)),
            );
            const entryClearance = hasCorridorEmergency ? CORRIDOR_ENTRY_CLEARANCE_SECONDS : EMERGENCY_ENTRY_CLEARANCE_SECONDS;
            const extension = hasCorridorEmergency ? CORRIDOR_EXTENSION_SECONDS : EMERGENCY_EXTENSION_SECONDS;

            if (sim.activeGreenLane === emergencyLane) {
              nextActiveLane = emergencyLane;
              if (nextCountdown <= 0) {
                nextCountdown = extension;
              }
            } else if (sim.activeGreenLane === -1) {
              nextActiveLane = emergencyLane;
              nextCountdown = emergencyTiming;
            } else {
              nextActiveLane = -1;
              nextCountdown = entryClearance;
            }
          } else {
            if (emergencyState.active) {
              emergencyState.active = false;
              lanePointerRef.current[junction.id] = emergencyState.resumePointer;

              if (sim.activeGreenLane !== -1) {
                nextActiveLane = -1;
                nextCountdown = hasCorridorEmergency ? CORRIDOR_RECOVERY_CLEARANCE_SECONDS : EMERGENCY_RECOVERY_CLEARANCE_SECONDS;
              }
            }

            if (nextCountdown <= 0) {
              if (sim.activeGreenLane !== -1) {
                // Capture the next clockwise lane from the lane that actually just finished.
                lanePointerRef.current[junction.id] = (sim.activeGreenLane + 1) % 4;
                nextActiveLane = -1;
                nextCountdown = 3;
              } else {
                const nextLane = lanePointerRef.current[junction.id] ?? 0;
                nextActiveLane = nextLane;
                // Apply coordination adjustments to base timing
                const baseGreenTime = clampGreenTime(timings[nextLane]);
                nextCountdown = calculateCoordinationAdjustedTiming(baseGreenTime, nextLane, coordinationActions);
              }
            } else {
              relievingNeighbor = sim.relievingNeighbor;
            }
          }

          const currentIntensity = [...sim.trafficIntensity];
          for (let i = 0; i < 4; i++) {
            currentIntensity[i] = Math.min(100, currentIntensity[i] + 0.1 * simulationSpeed);
          }

          // Directional downstream backpressure:
          // if a neighbor is congested, the lane heading toward that neighbor should queue up.
          for (const conn of junction.laneConnections) {
            const neighbor = next[conn.neighborId];
            if (!neighbor) continue;
            if (neighbor.congestionLevel <= DOWNSTREAM_BACKPRESSURE_START) continue;

            const inferredLane = inferLaneTowardsNeighbor(junction.id, conn.neighborId);
            const pressureLane = inferredLane ?? conn.lane;
            const pressureRatio = Math.min(
              1,
              (neighbor.congestionLevel - DOWNSTREAM_BACKPRESSURE_START) / (100 - DOWNSTREAM_BACKPRESSURE_START),
            );
            const pressure = MAX_BACKPRESSURE_PER_TICK * pressureRatio * simulationSpeed;

            currentIntensity[pressureLane] = Math.min(100, currentIntensity[pressureLane] + pressure);
          }

          // Use proper lane connections instead of neighbors[greenLane]
          if (sim.activeGreenLane !== -1) {
            const greenLane = sim.activeGreenLane;
            const releasedFlow = Math.min(currentIntensity[greenLane], 2.5 * simulationSpeed);
            currentIntensity[greenLane] = Math.max(0, currentIntensity[greenLane] - releasedFlow);

            // Get the neighbor for this specific lane using proper mapping
            const laneConnection = getLaneConnectionForLane(junction.id, greenLane);
            if (laneConnection && next[laneConnection.neighborId]) {
              const neighborSim = { ...next[laneConnection.neighborId] };
              const neighborLane = laneConnection.targetIncomingLane;
              const neighborIntensity = [...neighborSim.trafficIntensity];
              // Traffic released here should appear at the neighbor's incoming lane,
              // but only after travel delay and respecting link/downstream capacity.
              const rawTransfer = releasedFlow * NEIGHBOR_TRANSFER_EFFICIENCY;
              const downstreamHeadroom = Math.max(0, 100 - neighborIntensity[neighborLane]);
              const linkLoad = transitPacketsRef.current
                .filter((p) => linkKey(p.fromId, p.toId, p.toLane) === linkKey(junction.id, laneConnection.neighborId, neighborLane))
                .reduce((sum, p) => sum + p.amount, 0);
              const linkHeadroom = Math.max(0, LINK_IN_TRANSIT_CAPACITY - linkLoad);
              const acceptedTransfer = Math.min(
                rawTransfer,
                LINK_TRANSFER_CAPACITY_PER_TICK * simulationSpeed,
                linkHeadroom,
                downstreamHeadroom,
              );
              const blockedTransfer = Math.max(0, rawTransfer - acceptedTransfer);

              const k = linkKey(junction.id, laneConnection.neighborId, neighborLane);
              if (!tickLinkStats[k]) {
                tickLinkStats[k] = {
                  key: k,
                  fromId: junction.id,
                  toId: laneConnection.neighborId,
                  toLane: neighborLane,
                  accepted: 0,
                  blocked: 0,
                  arrived: 0,
                  inTransit: 0,
                };
              }
              tickLinkStats[k].accepted += acceptedTransfer;
              tickLinkStats[k].blocked += blockedTransfer;

              if (acceptedTransfer > 0) {
                transitPacketsRef.current.push({
                  fromId: junction.id,
                  toId: laneConnection.neighborId,
                  toLane: neighborLane,
                  amount: acceptedTransfer,
                  remainingTicks: estimateTravelTicks(junction.id, laneConnection.neighborId),
                });
              }

              if (blockedTransfer > 0) {
                // Spillback: when downstream cannot receive, queue remains near the stop line.
                currentIntensity[greenLane] = Math.min(
                  100,
                  currentIntensity[greenLane] + blockedTransfer * SPILLBACK_RATIO,
                );
              }
              
              next[laneConnection.neighborId] = {
                ...neighborSim,
                trafficIntensity: neighborIntensity,
                relievingNeighbor: junction.id
              };
            }
          }

          // Congested junctions create spillover pressure into adjacent junctions.
          if (sim.congestionLevel > SPILLOVER_START_CONGESTION) {
            const overflowRatio = Math.min(1, (sim.congestionLevel - SPILLOVER_START_CONGESTION) / (100 - SPILLOVER_START_CONGESTION));
            const spillover = MAX_SPILLOVER_PER_TICK * overflowRatio * simulationSpeed;

            for (const conn of junction.laneConnections) {
              const neighborSim = next[conn.neighborId];
              if (!neighborSim) continue;

              const neighborIntensity = [...neighborSim.trafficIntensity];
              neighborIntensity[conn.targetIncomingLane] = Math.min(100, neighborIntensity[conn.targetIncomingLane] + spillover);

              next[conn.neighborId] = {
                ...neighborSim,
                trafficIntensity: neighborIntensity,
                relievingNeighbor: junction.id,
              };
            }
          }

          const updatedCongestion = currentIntensity.reduce((a, b) => a + b, 0) / 4;

          next[junction.id] = {
            ...sim,
            activeGreenLane: nextActiveLane,
            countdown: nextCountdown,
            corridorEmergencyActive: hasCorridorEmergency,
            corridorEmergencyLane: hasCorridorEmergency ? effectiveEmergencyLane : null,
            corridorEmergencySource: hasCorridorEmergency ? corridorRequest?.sourceId ?? null : null,
            congestionLevel: updatedCongestion,
            relievingNeighbor,
            neighborStates,
            coordinationRequests: ourCoordinationRequest ? [ourCoordinationRequest] : [],
            coordinationActions,
            trafficIntensity: currentIntensity,
            history: [...(sim.history || []), { 
              time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }), 
              congestion: Math.round(updatedCongestion) 
            }].slice(-30)
          };
        });
        
        // Calculate and distribute network metrics to all junctions
        const networkMetrics = calculateNetworkMetrics(next);
        Object.keys(next).forEach(junctionId => {
          next[junctionId] = {
            ...next[junctionId],
            networkMetrics
          };
        });

        // Capture in-transit load snapshot for link debug.
        for (const packet of transitPacketsRef.current) {
          const k = linkKey(packet.fromId, packet.toId, packet.toLane);
          if (!tickLinkStats[k]) {
            tickLinkStats[k] = {
              key: k,
              fromId: packet.fromId,
              toId: packet.toId,
              toLane: packet.toLane,
              accepted: 0,
              blocked: 0,
              arrived: 0,
              inTransit: 0,
            };
          }
          tickLinkStats[k].inTransit += packet.amount;
        }

        linkFlowDebugRef.current = tickLinkStats;
        
        return next;
      });
    }, 1000 / simulationSpeed);

    return () => clearInterval(interval);
  }, [isInitialized, simulationSpeed, modelPredictions]);

  // Reference to track what we've last synced (for delta detection)
  const lastSyncedRef = useRef<Record<string, Partial<SimulationState>>>({});

  /**
   * Intelligent sync: only sync critical state changes
   * @returns true if state differs from last sync
   */
  function hasStateChanged(current: SimulationState, lastSynced?: Partial<SimulationState>): boolean {
    if (!lastSynced) return true;
    
    // Monitor only critical control fields
    return (
      current.activeGreenLane !== lastSynced.activeGreenLane ||
      current.countdown !== lastSynced.countdown ||
      current.congestionLevel !== lastSynced.congestionLevel ||
      current.emergencyActive !== lastSynced.emergencyActive ||
      current.emergencyLane !== lastSynced.emergencyLane
    );
  }

  // Optimized sync to Local SQLite (Every 5 seconds, delta-based)
  useEffect(() => {
    if (!isInitialized) return;

    const syncInterval = setInterval(async () => {
      try {
        const pendingSyncs = NETWORK
          .filter(junction => {
            const localSim = localSimulations[junction.id];
            const lastSynced = lastSyncedRef.current[junction.id];
            return localSim && hasStateChanged(localSim, lastSynced);
          })
          .map(junction => ({
            id: junction.id,
            sim: localSimulations[junction.id]
          }));

        // Batch sync all changed junctions in parallel
        await Promise.all(
          pendingSyncs.map(async ({ id, sim }) => {
            try {
              // Only sync critical state + neighbor awareness (not full state)
              const syncPayload = {
                activeGreenLane: sim.activeGreenLane,
                countdown: sim.countdown,
                congestionLevel: sim.congestionLevel,
                emergencyActive: sim.emergencyActive,
                emergencyLane: sim.emergencyLane,
                trafficIntensity: sim.trafficIntensity,
                neighborStates: sim.neighborStates,
              };

              const response = await fetch(`/api/simulations/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(syncPayload)
              });

              if (response.ok) {
                // Mark as synced
                lastSyncedRef.current[id] = syncPayload;
                
                // Separately log history for analytics (non-blocking)
                fetch(`/api/history/${id}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    congestion: sim.congestionLevel,
                    activeLane: sim.activeGreenLane
                  })
                }).catch(() => {}); // ignore analytics errors
              }
            } catch (err) {
              console.error(`Sync error for ${id}:`, err);
            }
          })
        );
      } catch (err) {
        console.error("Batch sync error:", err);
      }
    }, 5000);

    return () => clearInterval(syncInterval);
  }, [localSimulations, isInitialized]);

  if (!isInitialized) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#050505] text-white font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <Activity className="w-12 h-12 text-[#F27D26] animate-pulse" />
          <p className="text-sm uppercase tracking-widest opacity-50">Initializing Network...</p>
        </motion.div>
      </div>
    );
  }

  const selectedSim = selectedJunctionId ? localSimulations[selectedJunctionId] : null;
  const selectedPrediction = selectedJunctionId ? modelPredictions[selectedJunctionId] : null;
  const selectedLaneMetrics = selectedJunctionId ? laneDebugMetrics : [];
  const payloadLaneCounts = selectedSim
    ? selectedSim.trafficIntensity.map((intensity) => laneIntensityToVehicleCount(intensity))
    : [];
  const predictedTimings = selectedPrediction?.timings ?? (selectedSim ? fallbackTimings(selectedSim) : [0, 0, 0, 0]);
  const selectedLinkRows = selectedSim
    ? Object.values(linkFlowDebugRef.current)
        .filter((row) => row.fromId === selectedSim.id || row.toId === selectedSim.id)
        .sort((a, b) => b.inTransit - a.inTransit)
    : [];
  const selectedCorridorPlans = selectedSim
    ? Object.values(corridorPlansRef.current)
        .filter((plan) => plan.sourceId === selectedSim.id || plan.hops.some((hop) => hop.toId === selectedSim.id || hop.fromId === selectedSim.id))
    : [];
  const junctionNameById = NETWORK.reduce<Record<string, string>>((acc, junction) => {
    acc[junction.id] = junction.name;
    return acc;
  }, {});

  return (
    <div className="h-screen w-screen bg-[#050505] text-white font-sans overflow-hidden relative">
      <AnimatePresence mode="wait">
        {!selectedJunctionId ? (
          <motion.div 
            key="map"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
          >
            <NetworkMap 
              simulations={localSimulations} 
              modelPredictions={modelPredictions}
              onSelectJunction={setSelectedJunctionId} 
            />
          </motion.div>
        ) : (
          <motion.div 
            key="sim"
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute inset-0"
          >
            {selectedSim && (
              <>
                <Simulation
                  simState={selectedSim}
                  simulationSpeed={simulationSpeed}
                  onLaneMetricsChange={setLaneDebugMetrics}
                />
                <ControlPanel 
                  simState={selectedSim} 
                  onBack={() => setSelectedJunctionId(null)}
                  simulationSpeed={simulationSpeed}
                  setSimulationSpeed={setSimulationSpeed}
                  predictionSource={selectedPrediction?.source ?? null}
                  predictionUpdatedAt={selectedPrediction?.updatedAt ?? null}
                />
                
                {/* Overlay HUD */}
                <div className="absolute top-8 left-8 pointer-events-none z-20">
                  <motion.div 
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    className="flex flex-col gap-1"
                  >
                    <h2 className="text-2xl font-black tracking-tighter uppercase leading-none">
                      {selectedSim.name}
                    </h2>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">Live Simulation Active</span>
                    </div>
                    {selectedSim.relievingNeighbor && (
                      <div className="mt-2 inline-flex items-center gap-2 bg-[#F27D26]/20 text-[#F27D26] px-3 py-1.5 rounded-lg border border-[#F27D26]/30">
                        <Activity className="w-4 h-4" />
                        <span className="text-[10px] uppercase font-bold tracking-widest">
                          Relieving Network Congestion
                        </span>
                      </div>
                    )}
                  </motion.div>
                </div>

                <motion.div
                  initial={{ x: 300, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  className="absolute top-24 right-4 md:top-8 md:right-[22rem] w-80 max-h-[calc(100vh-6rem)] flex flex-col bg-[#151619]/90 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl z-20 overflow-hidden"
                >
                  <div className="flex items-center justify-between p-6 border-b border-white/5 shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-[#F27D26]/20 rounded-xl">
                        <Activity className="w-5 h-5 text-[#F27D26]" />
                      </div>
                      <h3 className="text-sm font-bold uppercase tracking-widest">Lane Debug</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsDebugPanelCollapsed((prev) => !prev)}
                      className="p-2 hover:bg-white/5 rounded-full transition-colors group"
                      title={isDebugPanelCollapsed ? 'Expand' : 'Collapse'}
                    >
                      {isDebugPanelCollapsed ? (
                        <ChevronDown className="w-4 h-4 text-white/40 group-hover:text-white" />
                      ) : (
                        <ChevronUp className="w-4 h-4 text-white/40 group-hover:text-white" />
                      )}
                    </button>
                  </div>

                  <AnimatePresence initial={false}>
                    {!isDebugPanelCollapsed && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="px-6 pb-6 overflow-y-auto"
                      >
                        <div className="space-y-3 pt-6">
                          <div className="grid grid-cols-[70px_70px_70px_70px] gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
                            <div>Lane</div>
                            <div>Render</div>
                            <div>Payload</div>
                            <div>Green(s)</div>
                          </div>
                          {[0, 1, 2, 3].map((lane) => {
                            const runtime = selectedLaneMetrics.find((item) => item.lane === lane);
                            const renderLabel = runtime ? `${runtime.active}${runtime.retiring > 0 ? `(+${runtime.retiring})` : ''}` : '-';
                            const payload = payloadLaneCounts[lane] ?? 0;
                            const timing = Math.round(predictedTimings[lane] ?? 0);
                            const isGreen = selectedSim.activeGreenLane === lane;

                            return (
                              <div
                                key={lane}
                                className={`grid grid-cols-[70px_70px_70px_70px] gap-2 text-xs py-2 px-2 rounded-lg border ${isGreen ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-white/80 bg-white/5 border-white/10'}`}
                              >
                                <div>Lane {lane + 1}</div>
                                <div>{renderLabel}</div>
                                <div>{payload}</div>
                                <div>{timing}</div>
                              </div>
                            );
                          })}
                          <div className="pt-2 border-t border-white/5 text-[10px] uppercase tracking-widest text-white/40">
                            Render format: active(+retiring)
                          </div>

                          <div className="pt-3 mt-2 border-t border-white/10">
                            <div className="flex items-center justify-between">
                              <h4 className="text-[11px] font-bold uppercase tracking-widest text-white/70">Link Flow Debug</h4>
                              <button
                                type="button"
                                onClick={() => setIsLinkDebugCollapsed((prev) => !prev)}
                                className="p-1.5 hover:bg-white/5 rounded-full transition-colors group"
                                title={isLinkDebugCollapsed ? 'Expand link flow debug' : 'Collapse link flow debug'}
                              >
                                {isLinkDebugCollapsed ? (
                                  <ChevronDown className="w-3.5 h-3.5 text-white/40 group-hover:text-white" />
                                ) : (
                                  <ChevronUp className="w-3.5 h-3.5 text-white/40 group-hover:text-white" />
                                )}
                              </button>
                            </div>

                            <AnimatePresence initial={false}>
                              {!isLinkDebugCollapsed && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-3 space-y-2">
                                    <div className="grid grid-cols-[128px_44px_44px_44px_44px] gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
                                      <div>Link</div>
                                      <div>In</div>
                                      <div>Arr</div>
                                      <div>Acc</div>
                                      <div>Blk</div>
                                    </div>

                                    {selectedLinkRows.length === 0 ? (
                                      <div className="text-[11px] text-white/40 py-2">No active link flow for this junction.</div>
                                    ) : (
                                      selectedLinkRows.slice(0, 8).map((row) => (
                                        <div
                                          key={row.key}
                                          className="grid grid-cols-[128px_44px_44px_44px_44px] gap-2 text-[11px] py-1.5 px-2 rounded-lg border bg-white/5 border-white/10 text-white/80"
                                        >
                                          <div className="truncate" title={`${row.fromId} -> ${row.toId} (Lane ${row.toLane + 1})`}>
                                            {row.fromId === selectedSim.id
                                              ? `out->${junctionNameById[row.toId] ?? row.toId}`
                                              : `in<-${junctionNameById[row.fromId] ?? row.fromId}`}
                                          </div>
                                          <div>{row.inTransit.toFixed(1)}</div>
                                          <div>{row.arrived.toFixed(1)}</div>
                                          <div>{row.accepted.toFixed(1)}</div>
                                          <div className={row.blocked > 0 ? 'text-amber-300' : ''}>{row.blocked.toFixed(1)}</div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>

                          <div className="pt-3 mt-2 border-t border-white/10">
                            <h4 className="text-[11px] font-bold uppercase tracking-widest text-white/70">Emergency Corridor Debug</h4>
                            <div className="mt-3 space-y-2">
                              {selectedCorridorPlans.length === 0 ? (
                                <div className="text-[11px] text-white/40 py-1">No active emergency corridor touching this junction.</div>
                              ) : (
                                selectedCorridorPlans.slice(0, 3).map((plan) => (
                                  <div key={plan.sourceId} className="rounded-lg border border-white/10 bg-white/5 p-2">
                                    <div className="text-[10px] uppercase tracking-widest text-white/50">source</div>
                                    <div className="text-[11px] font-semibold text-white/85">{junctionNameById[plan.sourceId] ?? plan.sourceId}</div>
                                    <div className="mt-2 space-y-1">
                                      {plan.hops.length === 0 ? (
                                        <div className="text-[11px] text-white/45">No downstream hops planned.</div>
                                      ) : (
                                        plan.hops.map((hop) => (
                                          <div key={`${plan.sourceId}-${hop.hop}-${hop.toId}`} className="text-[11px] text-white/75">
                                            H{hop.hop}: {junctionNameById[hop.fromId] ?? hop.fromId} {'->'} {junctionNameById[hop.toId] ?? hop.toId} | out L{hop.outgoingLane + 1} {'->'} in L{hop.incomingLane + 1}
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

