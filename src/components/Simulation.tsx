import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, Stars, Float, Html, Text } from '@react-three/drei';
import { Road } from './Road';
import { TrafficLight } from './TrafficLight';
import { Vehicle, VehicleType, TurnDirection } from './Vehicle';
import { laneIntensityToVehicleCount, LaneDebugMetrics, SimulationState } from '../types';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

interface SimulationProps {
  simState: SimulationState | null;
  simulationSpeed: number;
  onLaneMetricsChange?: (metrics: LaneDebugMetrics[]) => void;
}

export function Simulation({ simState, simulationSpeed, onLaneMetricsChange }: SimulationProps) {
  // Define lane positions and rotations
  // 0: North, 1: East, 2: South, 3: West
  const lanes = useMemo(() => [
    { id: 0, name: 'North Lane', position: [0, 0, -10], rotation: [0, 0, 0], labelPos: [4, 0.1, -15], labelRot: [-Math.PI / 2, 0, 0] },
    { id: 1, name: 'East Lane', position: [10, 0, 0], rotation: [0, -Math.PI / 2, 0], labelPos: [15, 0.1, 4], labelRot: [-Math.PI / 2, 0, 0] },
    { id: 2, name: 'South Lane', position: [0, 0, 10], rotation: [0, Math.PI, 0], labelPos: [-4, 0.1, 15], labelRot: [-Math.PI / 2, 0, 0] },
    { id: 3, name: 'West Lane', position: [-10, 0, 0], rotation: [0, Math.PI / 2, 0], labelPos: [-15, 0.1, -4], labelRot: [-Math.PI / 2, 0, 0] },
  ], []);

  return (
    <div className="absolute inset-0 w-full h-full border-4 border-red-500/20">
      <Canvas camera={{ position: [20, 20, 20], fov: 50 }}>
        <Suspense fallback={
          <Html center>
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-4 border-[#F27D26] border-t-transparent rounded-full animate-spin" />
              <p className="text-[10px] uppercase font-bold tracking-widest text-white/40">Loading 3D Scene...</p>
            </div>
          </Html>
        }>
          <OrbitControls 
            enablePan={false} 
            maxPolarAngle={Math.PI / 2.1} 
            minDistance={10} 
            maxDistance={50} 
          />
          
          <color attach="background" args={['#050505']} />
          
          <ambientLight intensity={0.5} />
          <directionalLight 
            position={[10, 20, 10]} 
            intensity={1.5} 
            castShadow 
            shadow-mapSize={[1024, 1024]}
          />

          {/* Road Network */}
          <Road />

          {/* Traffic Lights & Labels */}
          {lanes.map((lane) => (
            <group key={lane.id}>
              <TrafficLight 
                position={lane.position as [number, number, number]} 
                rotation={lane.rotation as [number, number, number]}
                isGreen={simState?.activeGreenLane === lane.id}
                countdown={simState?.countdown ?? null}
              />
              <Text
                position={lane.labelPos as [number, number, number]}
                rotation={lane.labelRot as [number, number, number]}
                fontSize={2.5}
                color="#F27D26"
                anchorX="center"
                anchorY="middle"
                fillOpacity={0.6}
              >
                {lane.name}
              </Text>
            </group>
          ))}

          {/* Vehicles */}
          {simState && (
            <VehicleManager 
              simState={simState}
              simulationSpeed={simulationSpeed}
              onLaneMetricsChange={onLaneMetricsChange}
            />
          )}

          {/* Decorative Buildings */}
          <Buildings />
        </Suspense>
      </Canvas>
    </div>
  );
}

function VehicleManager({
  simState,
  simulationSpeed,
  onLaneMetricsChange,
}: {
  simState: SimulationState;
  simulationSpeed: number;
  onLaneMetricsChange?: (metrics: LaneDebugMetrics[]) => void;
}) {
  type SpawnedVehicle = {
    id: string;
    lane: number;
    initialOffset: number;
    color: string;
    type: VehicleType;
    turnDirection: TurnDirection;
    retireOnExit?: boolean;
    isEmergency?: boolean;
  };

  const COLOR_PALETTE = ['#F27D26', '#3b82f6', '#ef4444', '#10b981', '#ffffff'];
  const VEHICLE_TYPES: VehicleType[] = ['car', 'car', 'car', 'truck', 'bus', 'bike'];
  const TURN_DIRECTIONS: TurnDirection[] = ['straight', 'straight', 'left', 'right', 'uturn'];
  const VEHICLE_SPACING = 8;

  const [vehicles, setVehicles] = useState<SpawnedVehicle[]>([]);
  const laneSpawnCounters = useRef<number[]>([0, 0, 0, 0]);
  const vehiclePositions = useRef<Record<string, { lane: number, offset: number, pos: THREE.Vector3, dir: THREE.Vector3, isStopped: boolean }>>({});
  const seededJunctionRef = useRef<string | null>(null);

  const makeVehicle = useCallback((lane: number, initialOffset: number): SpawnedVehicle => {
    const sequence = laneSpawnCounters.current[lane]++;
    return {
      id: `${lane}-${sequence}`,
      lane,
      initialOffset,
      color: COLOR_PALETTE[(lane + sequence) % COLOR_PALETTE.length],
      type: VEHICLE_TYPES[(lane * 7 + sequence * 3) % VEHICLE_TYPES.length],
      turnDirection: TURN_DIRECTIONS[(lane * 11 + sequence * 5) % TURN_DIRECTIONS.length],
    };
  }, []);

  const getVehicleProgress = useCallback((vehicle: SpawnedVehicle) => {
    const runtimeOffset = vehiclePositions.current[vehicle.id]?.offset;
    if (typeof runtimeOffset === 'number') {
      return runtimeOffset;
    }
    return -50 - vehicle.initialOffset;
  }, []);

  useEffect(() => {
    if (seededJunctionRef.current === simState.id) return;

    setVehicles((prev) => {
      const nonEmergencyExists = prev.some((vehicle) => !vehicle.isEmergency);
      if (nonEmergencyExists) {
        seededJunctionRef.current = simState.id;
        return prev;
      }

      const desiredPerLane = simState.trafficIntensity.map((intensity) => laneIntensityToVehicleCount(intensity));
      const seeded: SpawnedVehicle[] = [];

      for (let lane = 0; lane < 4; lane++) {
        const queueCount = Math.min(3, desiredPerLane[lane]);

        for (let i = 0; i < queueCount; i++) {
          // Put seeded vehicles close to stop line so each approach looks populated immediately.
          const desiredProgress = 42 - i * VEHICLE_SPACING;
          const initialOffset = -50 - desiredProgress;

          seeded.push({
            id: `seed-${simState.id}-${lane}-${i}`,
            lane,
            initialOffset,
            color: COLOR_PALETTE[(lane + i) % COLOR_PALETTE.length],
            type: VEHICLE_TYPES[(lane * 7 + i * 3) % VEHICLE_TYPES.length],
            turnDirection: 'straight',
          });
        }
      }

      seededJunctionRef.current = simState.id;
      return [...prev, ...seeded];
    });
  }, [simState.id, simState.trafficIntensity]);

  useEffect(() => {
    const desiredPerLane = simState.trafficIntensity.map((intensity) => laneIntensityToVehicleCount(intensity));
    const effectiveEmergencyActive = simState.emergencyActive || simState.corridorEmergencyActive;
    const effectiveEmergencyLane = simState.emergencyActive
      ? simState.emergencyLane
      : simState.corridorEmergencyLane;

    setVehicles((prev) => {
      const emergencyVehicle = prev.find((vehicle) => vehicle.isEmergency);
      let next = prev.filter((vehicle) => !vehicle.isEmergency);
      let hasChanges = false;

      for (let lane = 0; lane < 4; lane++) {
        const laneVehicles = next.filter((vehicle) => vehicle.lane === lane);
        const laneRetiring = laneVehicles.filter((vehicle) => vehicle.retireOnExit);
        const laneActive = laneVehicles.filter((vehicle) => !vehicle.retireOnExit);
        const desired = desiredPerLane[lane];

        if (laneActive.length < desired) {
          let needed = desired - laneActive.length;

          if (laneRetiring.length > 0) {
            const restoreIds = laneRetiring
              .slice()
              .sort((a, b) => getVehicleProgress(a) - getVehicleProgress(b))
              .slice(0, needed)
              .map((vehicle) => vehicle.id);
            const restoreSet = new Set(restoreIds);

            if (restoreIds.length > 0) {
              next = next.map((vehicle) => {
                if (restoreSet.has(vehicle.id) && vehicle.retireOnExit) {
                  hasChanges = true;
                  return { ...vehicle, retireOnExit: false };
                }
                return vehicle;
              });
              needed -= restoreIds.length;
            }
          }

          if (needed > 0) {
            let nextOffset = laneVehicles.length * VEHICLE_SPACING;
            for (let i = 0; i < needed; i++) {
              next.push(makeVehicle(lane, nextOffset));
              nextOffset += VEHICLE_SPACING;
              hasChanges = true;
            }
          }
        } else if (laneActive.length > desired) {
          const toRetire = laneActive.length - desired;
          const retireIds = laneActive
            .slice()
            .sort((a, b) => getVehicleProgress(b) - getVehicleProgress(a))
            .slice(0, toRetire)
            .map((vehicle) => vehicle.id);
          const retireSet = new Set(retireIds);

          if (retireIds.length > 0) {
            next = next.map((vehicle) => {
              if (retireSet.has(vehicle.id) && !vehicle.retireOnExit) {
                hasChanges = true;
                return { ...vehicle, retireOnExit: true };
              }
              return vehicle;
            });
          }
        }
      }

      if (effectiveEmergencyActive && effectiveEmergencyLane !== null) {
        if (!emergencyVehicle || emergencyVehicle.lane !== effectiveEmergencyLane) {
          next.push({
            id: 'emergency',
            lane: effectiveEmergencyLane,
            initialOffset: -10,
            isEmergency: true,
            color: '#ff0000',
            type: 'truck',
            turnDirection: 'straight',
          });
          hasChanges = true;
        } else {
          next.push(emergencyVehicle);
        }
      } else if (emergencyVehicle) {
        hasChanges = true;
      }

      return hasChanges ? next : prev;
    });
  }, [
    getVehicleProgress,
    makeVehicle,
    simState.emergencyActive,
    simState.emergencyLane,
    simState.corridorEmergencyActive,
    simState.corridorEmergencyLane,
    simState.trafficIntensity,
  ]);

  const handleVehicleExit = useCallback((vehicleId: string) => {
    setVehicles((prev) => prev.filter((vehicle) => vehicle.id !== vehicleId));
  }, []);

  useEffect(() => {
    if (!onLaneMetricsChange) return;

    const targets = simState.trafficIntensity.map((intensity) => laneIntensityToVehicleCount(intensity));
    const metrics: LaneDebugMetrics[] = [0, 1, 2, 3].map((lane) => {
      const laneVehicles = vehicles.filter((vehicle) => vehicle.lane === lane && !vehicle.isEmergency);
      const retiring = laneVehicles.filter((vehicle) => vehicle.retireOnExit).length;
      const active = laneVehicles.length - retiring;

      return {
        lane,
        target: targets[lane],
        active,
        retiring,
      };
    });

    onLaneMetricsChange(metrics);
  }, [onLaneMetricsChange, simState.trafficIntensity, vehicles]);

  return (
    <>
      {vehicles.map((v) => (
        <Vehicle 
          key={v.id} 
          id={v.id}
          lane={v.lane} 
          initialOffset={v.initialOffset} 
          color={v.color} 
          isEmergency={v.isEmergency}
          isGreen={simState.activeGreenLane === v.lane}
          vehiclePositions={vehiclePositions}
          type={v.type}
          turnDirection={v.turnDirection}
          simulationSpeed={simulationSpeed}
          retireOnExit={v.retireOnExit}
          onExit={handleVehicleExit}
        />
      ))}
    </>
  );
}

function Buildings() {
  return (
    <group>
      {/* Simple low-poly buildings */}
      <mesh position={[-15, 5, -15]} castShadow receiveShadow>
        <boxGeometry args={[8, 10, 8]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh position={[15, 8, -15]} castShadow receiveShadow>
        <boxGeometry args={[10, 16, 10]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      <mesh position={[-15, 6, 15]} castShadow receiveShadow>
        <boxGeometry args={[12, 12, 12]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh position={[15, 4, 15]} castShadow receiveShadow>
        <boxGeometry args={[8, 8, 8]} />
        <meshStandardMaterial color="#222" />
      </mesh>
    </group>
  );
}
