/**
 * LaneConnection maps a specific lane (0-3) to a neighbor junction and the incoming lane.
 * Example: lane 0 (North) -> neighbor node-2, incoming lane 2 (South)
 */
export interface LaneConnection {
  lane: number;               // 0=North, 1=East, 2=South, 3=West
  neighborId: string;         // target junction
  targetIncomingLane: number; // which lane this traffic enters on target
}

export interface JunctionDef {
  id: string;
  name: string;
  lat: number;
  lng: number;
  laneConnections: LaneConnection[]; // proper lane->neighbor mapping
  neighbors: string[]                // legacy: list of all adjacent junctions
}

/**
 * Lane indices are cardinal directions (clockwise from North):
 * 0 = North (up)
 * 1 = East (right)
 * 2 = South (down)
 * 3 = West (left)
 */
export const NETWORK: JunctionDef[] = [
  {
    id: 'node-1',
    name: 'Junction 1',
    lat: 12.929583,
    lng: 77.615111,
    neighbors: ['node-2'],
    laneConnections: [
      { lane: 2, neighborId: 'node-2', targetIncomingLane: 0 }, // S->node-2(N)
    ]
  },
  {
    id: 'node-2',
    name: 'Junction 2',
    lat: 12.917361,
    lng: 77.622833,
    neighbors: ['node-1', 'node-3', 'node-4', 'node-5'],
    laneConnections: [
      { lane: 0, neighborId: 'node-1', targetIncomingLane: 2 }, // N->node-1(S)
      { lane: 1, neighborId: 'node-5', targetIncomingLane: 3 }, // E->node-5(W)
      { lane: 2, neighborId: 'node-3', targetIncomingLane: 0 }, // S->node-3(N)
      { lane: 3, neighborId: 'node-4', targetIncomingLane: 1 }, // W->node-4(E)
    ]
  },
  {
    id: 'node-3',
    name: 'Junction 3',
    lat: 12.916777,
    lng: 77.600138,
    neighbors: ['node-2'],
    laneConnections: [
      { lane: 0, neighborId: 'node-2', targetIncomingLane: 2 }, // N->node-2(S)
    ]
  },
  {
    id: 'node-4',
    name: 'Junction 4',
    lat: 12.907111,
    lng: 77.628750,
    neighbors: ['node-2'],
    laneConnections: [
      { lane: 1, neighborId: 'node-2', targetIncomingLane: 3 }, // E->node-2(W)
    ]
  },
  {
    id: 'node-5',
    name: 'Junction 5',
    lat: 12.916555,
    lng: 77.632333,
    neighbors: ['node-2'],
    laneConnections: [
      { lane: 3, neighborId: 'node-2', targetIncomingLane: 1 }, // W->node-2(E)
    ]
  },
];

/**
 * NeighborState tracks upstream junction status for coordination
 */
export interface NeighborState {
  junctionId: string;
  incomingLane: number;        // which lane is sending traffic to us
  neighborCongestion: number;  // their congestion level
  neighborActiveGreen: number; // their current green lane (-1 for all-red)
  neighborRelieves: boolean;   // true if their green is pointing at us
}

/**
 * CoordinationRequest tracks when a junction needs help from neighbors
 */
export interface CoordinationRequest {
  junctionId: string;          // the junction requesting help
  requiredCongestion: number;  // their congestion level (>60%)
  preferredLanes: number[];    // which incoming lanes should help (0-3)
  urgency: 'mild' | 'moderate' | 'severe'; // how much help needed
}

/**
 * CoordinationAction tracks which junctions we're helping and how
 */
export interface CoordinationAction {
  helpingJunctionId: string;   // who we're helping
  lane: number;                // which of our outgoing lanes (0-3)
  extensionSeconds: number;    // how many extra seconds we'll give them
  reason: string;              // debug: why we're doing this
}

/**
 * NetworkMetrics aggregates system-wide traffic information
 */
export interface NetworkMetrics {
  avgCongestion: number;
  maxCongestion: number;
  junctionsInCongestion: number; // >50%
  networkCapacity: number;       // avg traffic intensity
  lastUpdated: number;
}

export interface SimulationState {
  id: string;
  name: string;
  activeGreenLane: number;
  countdown: number;
  emergencyActive: boolean;
  emergencyLane: number | null;
  corridorEmergencyActive: boolean;
  corridorEmergencyLane: number | null;
  corridorEmergencySource: string | null;
  trafficIntensity: number[];
  congestionLevel: number;
  relievingNeighbor: string | null;
  neighborStates: NeighborState[];      // tracks upstream junction status
  coordinationRequests: CoordinationRequest[]; // NEW: neighbors asking for help
  coordinationActions: CoordinationAction[];   // NEW: how we're helping neighbors
  networkMetrics: NetworkMetrics | null;
  history: { time: string; congestion: number }[];
}

export type PredictionSource = 'model' | 'fallback';

export interface ModelPredictionState {
  timings: number[];
  source: PredictionSource;
  updatedAt: number;
}

export interface LaneDebugMetrics {
  lane: number;
  target: number;
  active: number;
  retiring: number;
}

export const INTENSITY_UNITS_PER_VEHICLE = 10;

export function laneIntensityToVehicleCount(intensity: number): number {
  return Math.max(0, Math.floor(intensity / INTENSITY_UNITS_PER_VEHICLE));
}

/**
 * Get all lane connections originating from a junction
 * Useful for distributing traffic to neighbors
 */
export function getLaneConnectionsFrom(junctionId: string): LaneConnection[] {
  const junction = NETWORK.find(j => j.id === junctionId);
  return junction?.laneConnections ?? [];
}

/**
 * Get the lane connection for a specific outgoing lane
 */
export function getLaneConnectionForLane(junctionId: string, lane: number): LaneConnection | undefined {
  return getLaneConnectionsFrom(junctionId).find(conn => conn.lane === lane);
}

/**
 * Get all incoming connections to a junction (reverse mapping)
 * Used to understand which neighbors feed traffic to us
 */
export function getIncomingConnectionsTo(junctionId: string): Array<{ fromJunction: string; fromLane: number; toIncomingLane: number }> {
  const incoming: Array<{ fromJunction: string; fromLane: number; toIncomingLane: number }> = [];
  
  for (const junction of NETWORK) {
    for (const conn of junction.laneConnections) {
      if (conn.neighborId === junctionId) {
        incoming.push({
          fromJunction: junction.id,
          fromLane: conn.lane,
          toIncomingLane: conn.targetIncomingLane
        });
      }
    }
  }
  
  return incoming;
}

// ============ COORDINATION CONSTANTS ============

/** Congestion threshold above which a junction may request help from neighbors */
export const COORDINATION_CONGESTION_THRESHOLD = 60;

/** How much to extend green time when helping a neighbor (seconds) */
export const COORDINATION_MILD_EXTENSION = 3;
export const COORDINATION_MODERATE_EXTENSION = 6;
export const COORDINATION_SEVERE_EXTENSION = 10;

/** How long to monitor a neighbor before stopping help (ticks) */
export const COORDINATION_MONITOR_DURATION = 15;

/** Max total extension across all coordination actions (percent of single green duration) */
export const COORDINATION_MAX_TOTAL_EXTENSION_PERCENT = 25;
