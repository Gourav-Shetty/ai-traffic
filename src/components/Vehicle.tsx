import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type VehicleType = 'car' | 'truck' | 'bus' | 'bike';
export type TurnDirection = 'straight' | 'left' | 'right' | 'uturn';

interface VehicleProps {
  id: string;
  lane: number;
  initialOffset: number;
  color: string;
  isEmergency?: boolean;
  isGreen: boolean;
  vehiclePositions: React.MutableRefObject<Record<string, { lane: number, offset: number, pos: THREE.Vector3, dir: THREE.Vector3, isStopped: boolean }>>;
  type: VehicleType;
  turnDirection: TurnDirection;
  simulationSpeed: number;
  retireOnExit?: boolean;
  onExit?: (id: string) => void;
}

function getLocalPose(offset: number, turnDirection: TurnDirection) {
  const LANE = -1.5; // Left lane for LHT
  const INTERSECTION_START = 47;

  if (turnDirection === 'left') {
    // Small arc for LHT left turn
    const radius = 1.5;
    const arcLen = (Math.PI / 2) * radius;
    if (offset < INTERSECTION_START) return { x: LANE, z: -50 + offset, heading: 0 };
    if (offset > INTERSECTION_START + arcLen) return { x: -3 - (offset - (INTERSECTION_START + arcLen)), z: -1.5, heading: -Math.PI / 2 };
    const angle = (offset - INTERSECTION_START) / radius;
    return { 
      x: -3 + radius * Math.cos(angle), 
      z: -3 + radius * Math.sin(angle), 
      heading: -angle 
    };
  }
  
  if (turnDirection === 'right') {
    // Large arc for LHT right turn
    const radius = 4.5;
    const arcLen = (Math.PI / 2) * radius;
    if (offset < INTERSECTION_START - 3) return { x: LANE, z: -50 + offset, heading: 0 };
    if (offset > INTERSECTION_START - 3 + arcLen) return { x: 3 + (offset - (INTERSECTION_START - 3 + arcLen)), z: 1.5, heading: Math.PI / 2 };
    const angle = Math.PI - (offset - (INTERSECTION_START - 3)) / radius;
    return { 
      x: 3 + radius * Math.cos(angle), 
      z: -3 + radius * Math.sin(angle), 
      heading: Math.PI - angle 
    };
  }
  
  if (turnDirection === 'uturn') {
    const radius = 1.5;
    const arcLen = Math.PI * radius;
    if (offset < INTERSECTION_START + 3) return { x: LANE, z: -50 + offset, heading: 0 };
    if (offset > INTERSECTION_START + 3 + arcLen) return { x: 1.5, z: 3 - (offset - (INTERSECTION_START + 3 + arcLen)), heading: Math.PI };
    const angle = (offset - (INTERSECTION_START + 3)) / radius;
    return { 
      x: radius * Math.cos(angle), 
      z: 3 + radius * Math.sin(angle), 
      heading: angle 
    };
  }
  
  // straight
  return { x: LANE, z: -50 + offset, heading: 0 };
}

function VehicleMesh({ type, color, isEmergency }: { type: VehicleType, color: string, isEmergency?: boolean }) {
  return (
    <group>
      {type === 'bike' && (
        <group>
          <mesh position={[0, 0.3, 0]} castShadow>
            <boxGeometry args={[0.2, 0.4, 1.2]} />
            <meshStandardMaterial color={color} />
          </mesh>
          <mesh position={[0, 0.7, -0.2]} castShadow>
            <boxGeometry args={[0.3, 0.5, 0.3]} />
            <meshStandardMaterial color="#222" />
          </mesh>
          {/* Wheels */}
          <mesh position={[0, 0.15, 0.5]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.15, 0.15, 0.1]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <mesh position={[0, 0.15, -0.5]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.15, 0.15, 0.1]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        </group>
      )}
      
      {type === 'truck' && (
        <group>
          <mesh position={[0, 0.6, 1.2]} castShadow>
            <boxGeometry args={[1.4, 1.2, 1.5]} />
            <meshStandardMaterial color={color} />
          </mesh>
          <mesh position={[0, 0.8, -1.2]} castShadow>
            <boxGeometry args={[1.5, 1.6, 3.5]} />
            <meshStandardMaterial color="#e5e7eb" />
          </mesh>
          {/* Wheels */}
          {[-2.2, -1.2, 1.2].map(z => (
            <group key={z}>
              <mesh position={[0.8, 0.2, z]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.25, 0.25, 0.3]} />
                <meshStandardMaterial color="#111" />
              </mesh>
              <mesh position={[-0.8, 0.2, z]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.25, 0.25, 0.3]} />
                <meshStandardMaterial color="#111" />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {type === 'bus' && (
        <group>
          <mesh position={[0, 0.8, 0]} castShadow>
            <boxGeometry args={[1.6, 1.6, 5]} />
            <meshStandardMaterial color={color} />
          </mesh>
          <mesh position={[0, 1, 0]} castShadow>
            <boxGeometry args={[1.65, 0.6, 4.8]} />
            <meshStandardMaterial color="#333" />
          </mesh>
          {/* Wheels */}
          {[-1.5, 1.5].map(z => (
            <group key={z}>
              <mesh position={[0.8, 0.2, z]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.25, 0.25, 0.3]} />
                <meshStandardMaterial color="#111" />
              </mesh>
              <mesh position={[-0.8, 0.2, z]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.25, 0.25, 0.3]} />
                <meshStandardMaterial color="#111" />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {type === 'car' && (
        <group>
          <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.2, 0.6, 2.5]} />
            <meshStandardMaterial color={color} />
          </mesh>
          <mesh position={[0, 0.8, -0.2]} castShadow>
            <boxGeometry args={[1, 0.5, 1.2]} />
            <meshStandardMaterial color="#333" />
          </mesh>
          {/* Wheels */}
          {[-0.8, 0.8].map(z => (
            <group key={z}>
              <mesh position={[0.6, 0.2, z]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.2, 0.2, 0.2]} />
                <meshStandardMaterial color="#111" />
              </mesh>
              <mesh position={[-0.6, 0.2, z]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.2, 0.2, 0.2]} />
                <meshStandardMaterial color="#111" />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {/* Emergency Lights */}
      {isEmergency && (
        <group position={[0, type === 'car' ? 1.1 : 1.7, -0.2]}>
          <mesh>
            <boxGeometry args={[0.8, 0.2, 0.2]} />
            <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={5} />
          </mesh>
          <pointLight color="#ff0000" intensity={2} distance={5} />
        </group>
      )}

      {/* Headlights */}
      <group position={[0, 0.3, type === 'bike' ? 0.6 : type === 'truck' ? 2.0 : type === 'bus' ? 2.5 : 1.25]}>
        <mesh position={[type === 'bike' ? 0 : 0.4, 0, 0]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshStandardMaterial color="white" emissive="white" emissiveIntensity={2} />
        </mesh>
        {type !== 'bike' && (
          <mesh position={[-0.4, 0, 0]}>
            <sphereGeometry args={[0.1, 8, 8]} />
            <meshStandardMaterial color="white" emissive="white" emissiveIntensity={2} />
          </mesh>
        )}
      </group>
    </group>
  );
}

export function Vehicle({ id, lane, initialOffset, color, isEmergency, isGreen, vehiclePositions, type, turnDirection, simulationSpeed, retireOnExit = false, onExit }: VehicleProps) {
  const meshRef = useRef<THREE.Group>(null);
  const speed = useRef((isEmergency ? 0.25 : type === 'bike' ? 0.08 : type === 'truck' ? 0.06 : 0.1) + Math.random() * 0.03);
  const currentOffset = useRef(-50 - initialOffset); // Start behind the intersection
  const isStoppedRef = useRef(false);
  const hasExitedRef = useRef(false);

  // Initial rotation based on lane (to align the local coordinate system)
  // 0: North, 1: East, 2: South, 3: West
  const laneConfig = useMemo(() => {
    switch (lane) {
      case 0: return { rot: [0, 0, 0] };
      case 1: return { rot: [0, -Math.PI / 2, 0] };
      case 2: return { rot: [0, Math.PI, 0] };
      case 3: return { rot: [0, Math.PI / 2, 0] };
      default: return { rot: [0, 0, 0] };
    }
  }, [lane]);

  useEffect(() => {
    return () => {
      delete vehiclePositions.current[id];
    };
  }, [id, vehiclePositions]);

  useFrame((_state, delta) => {
    if (!meshRef.current) return;

    // Update shared state with current world position
    const worldPos = new THREE.Vector3();
    const worldDir = new THREE.Vector3(0, 0, 1);
    meshRef.current.getWorldPosition(worldPos);
    worldDir.applyQuaternion(meshRef.current.getWorldQuaternion(new THREE.Quaternion()));
    
    vehiclePositions.current[id] = { 
      lane, 
      offset: currentOffset.current, 
      pos: worldPos, 
      dir: worldDir,
      isStopped: isStoppedRef.current
    };

    let shouldStop = false;

    // Stop line is at offset 46 (intersection is at 50)
    const distanceToStopLine = 46 - currentOffset.current;
    
    const isInIntersection = currentOffset.current > 46;
    const isEmergencyVehicle = isEmergency === true;
    
    // Stop if red light and close to stop line
    // Emergency vehicles ignore red lights (though the system should make them green)
    if (!isGreen && distanceToStopLine > 0 && distanceToStopLine < 5 && !isEmergencyVehicle) {
      shouldStop = true;
    }

    // Selective Phasing: Only queue before the intersection
    // Once in the intersection (offset > 46), vehicles phase through everything to prevent deadlocks
    // Emergency vehicles ignore collisions entirely
    if (!isInIntersection && !isEmergencyVehicle) {
      const safeDistance = type === 'truck' || type === 'bus' ? 7 : type === 'bike' ? 3 : 5;
      
      for (const [otherId, otherData] of Object.entries(vehiclePositions.current)) {
        if (otherId !== id && otherData.pos) {
          const toOther = new THREE.Vector3().subVectors(otherData.pos, worldPos);
          const distance = toOther.length();
          
          if (distance < safeDistance) {
            toOther.normalize();
            const dot = worldDir.dot(toOther);
            
            // If the other vehicle is in front of us and is currently stopped
            // We've removed the distance < 2 check here to prevent "both stop" deadlocks
            if (dot > 0.5 && otherData.isStopped) {
              shouldStop = true;
              break;
            }
          }
        }
      }
    }

    // Vehicles in intersection never report as "stopped" to those behind them
    // This ensures that as soon as the first car moves into the junction, 
    // the car behind it sees it as "moving" and follows.
    // Also, if they are moving, they should NOT report as stopped even if they are close to someone.
    isStoppedRef.current = shouldStop && !isInIntersection && !isEmergencyVehicle;

    // Movement logic
    if (!shouldStop) {
      currentOffset.current += speed.current * delta * 60 * simulationSpeed;
      if (currentOffset.current > 150) {
        if (retireOnExit || isEmergency) {
          if (!hasExitedRef.current) {
            hasExitedRef.current = true;
            onExit?.(id);
          }
          return;
        }

        currentOffset.current = -50 - Math.random() * 10;
        if (hasExitedRef.current) {
          hasExitedRef.current = false;
        }
      }
    }

    const pose = getLocalPose(currentOffset.current, turnDirection);
    meshRef.current.position.set(pose.x, 0, pose.z);
    meshRef.current.rotation.y = pose.heading;
  });

  return (
    <group rotation={laneConfig.rot as [number, number, number]}>
      <group ref={meshRef}>
        <VehicleMesh type={type} color={color} isEmergency={isEmergency} />
      </group>
    </group>
  );
}
