'use client';

/**
 * VrmAvatar — renders /model.vrm inside a React Three Fiber Canvas.
 *
 * Props:
 *   aiSpeaking – when true, modulates mouth ('aa' blend shape) and adds gentle speaking head nod.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';
import { LipSyncController, VisemeWeights, VRM_VOWELS } from '@/lib/lipSync';

// ─── Inner scene component ────────────────────────────────────────────────────
function VrmScene({
  aiSpeaking,
  lipSync,
}: {
  aiSpeaking: boolean;
  lipSync?: LipSyncController | null;
}) {
  const vrmRef = useRef<VRM | null>(null);
  const currentWeightsRef = useRef<VisemeWeights>({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
  const [vrm, setVrm] = useState<VRM | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      '/model.vrm',
      (gltf) => {
        if (!isMounted) return;
        const loadedVrm = gltf.userData.vrm as VRM | undefined;
        if (!loadedVrm) {
          console.warn('[VrmAvatar] GLTF loaded but no VRM instance found.');
          return;
        }

        // Clean up skeletons and vertices for performance
        VRMUtils.combineSkeletons(loadedVrm.scene);
        VRMUtils.removeUnnecessaryVertices(loadedVrm.scene);

        // VRM0 models face -Z by default; rotateVRM0 turns it 180 deg to face the camera (+Z)
        VRMUtils.rotateVRM0(loadedVrm);

        // The model's head bone is at Y = 1.614m and eyes at Y = 1.674m (peak of hair at 1.805m).
        // Setting Y to -1.65m brings the face, eyes, and mouth directly into origin (0, 0, 0).
        loadedVrm.scene.position.set(0, -1.65, 0);

        vrmRef.current = loadedVrm;
        setVrm(loadedVrm);
      },
      undefined,
      (err) => {
        console.error('[VrmAvatar] Failed to load /model.vrm:', err);
      }
    );

    return () => {
      isMounted = false;
      if (vrmRef.current) {
        VRMUtils.deepDispose(vrmRef.current.scene);
      }
    };
  }, []);

  // Animation loop using React Three Fiber's built-in frame state
  useFrame((state, delta) => {
    const activeVrm = vrmRef.current;
    if (!activeVrm) return;

    const elapsed = state.clock.getElapsedTime();

    // Update VRM spring bones, lookAt, and expressions
    activeVrm.update(delta);

    // Idle neck sway and speaking bob
    if (activeVrm.humanoid) {
      const neck = activeVrm.humanoid.getNormalizedBoneNode('neck');
      if (neck) {
        neck.rotation.y = Math.sin(elapsed * 0.5) * 0.04;
        neck.rotation.x = aiSpeaking ? Math.sin(elapsed * 8) * 0.025 : Math.sin(elapsed * 0.3) * 0.01;
      }

      // Very subtle shoulder breathing
      const spine = activeVrm.humanoid.getNormalizedBoneNode('spine');
      if (spine) {
        spine.rotation.z = Math.sin(elapsed * 0.6) * 0.012;
      }
    }

    // Auto-blink & multi-vowel mouth lip-sync
    if (activeVrm.expressionManager) {
      const blinkValue = elapsed % 4.5 < 0.15 ? 1 : 0;
      activeVrm.expressionManager.setValue('blink', blinkValue);

      const currentWeights = currentWeightsRef.current;
      let targetWeights: VisemeWeights;

      if (aiSpeaking && lipSync) {
        targetWeights = lipSync.getTargetWeights();
      } else if (aiSpeaking) {
        // Documented approximate fallback when aiSpeaking is true but no controller is supplied
        // (e.g. standalone test page). Cycles smoothly through vowel shapes.
        const cycle = (elapsed * 2.5) % 5;
        const vIndex = Math.floor(cycle);
        const subT = cycle - vIndex;
        const open = Math.sin(subT * Math.PI) * 0.55;
        targetWeights = {
          aa: vIndex === 0 ? open : 0,
          ih: vIndex === 1 ? open : 0,
          ou: vIndex === 2 ? open : 0,
          ee: vIndex === 3 ? open : 0,
          oh: vIndex === 4 ? open : 0,
        };
      } else {
        // Reset targets to zero when not speaking
        targetWeights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
      }

      // Smoothly interpolate each vowel weight towards its target using frame-rate independent damp
      // Smoothing lambda of 18 gives responsive transitions (~60ms) without stepping
      for (const v of VRM_VOWELS) {
        currentWeights[v] = THREE.MathUtils.damp(
          currentWeights[v],
          targetWeights[v],
          aiSpeaking ? 18 : 24,
          delta
        );
        if (!aiSpeaking && currentWeights[v] < 0.001) {
          currentWeights[v] = 0;
        }
        activeVrm.expressionManager.setValue(v, currentWeights[v]);
      }
    }
  });

  if (!vrm) return null;

  return <primitive object={vrm.scene} />;
}

// ─── Error Boundary ──────────────────────────────────────────────────────────
interface EBState { hasError: boolean }
class AvatarErrorBoundary extends React.Component<
  React.PropsWithChildren<{ fallback: React.ReactNode }>,
  EBState
> {
  constructor(props: React.PropsWithChildren<{ fallback: React.ReactNode }>) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): EBState { return { hasError: true }; }
  componentDidCatch(err: unknown) { console.warn('[VrmAvatar] Error in avatar tree:', err); }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

// ─── Loading Fallback ────────────────────────────────────────────────────────
function AvatarLoader() {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-2">
      <div className="w-8 h-8 rounded-full border-2 border-amber-400/40 border-t-amber-400 animate-spin" />
      <span className="text-[10px] text-stone-400">Loading avatar…</span>
    </div>
  );
}

// ─── Bot Fallback ────────────────────────────────────────────────────────────
function BotFallback() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-600 to-amber-700 flex items-center justify-center border-2 border-amber-500/30">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="10" x="3" y="11" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" x2="8" y1="16" y2="16" />
          <line x1="16" x2="16" y1="16" y2="16" />
        </svg>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export interface VrmAvatarProps {
  aiSpeaking?: boolean;
  lipSync?: LipSyncController | null;
}

export default function VrmAvatar({ aiSpeaking = false, lipSync }: VrmAvatarProps) {
  return (
    <AvatarErrorBoundary fallback={<BotFallback />}>
      <div className="relative w-full h-full overflow-hidden bg-slate-900">
        {/* Professional blurred office backdrop */}
        <div
          className="absolute inset-0 bg-cover bg-center pointer-events-none scale-105"
          style={{
            backgroundImage: "url('/office-bg.jpg')",
            filter: 'brightness(0.75) contrast(1.05) blur(1.5px)',
          }}
        />
        {/* Soft vignette overlay for depth separation */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-slate-900/30 pointer-events-none" />

        <Canvas
          shadows={false}
          gl={{ antialias: true, alpha: true }}
          style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', background: 'transparent' }}
          camera={{ fov: 28, near: 0.1, far: 20, position: [0, -0.03, 0.90] }}
        >
          {/* Soft natural illumination */}
          <ambientLight intensity={1.1} />
          {/* Key light on the face */}
          <directionalLight position={[0, 1.2, 1.5]} intensity={1.3} />
          {/* Warm ambient rim lights matching office interior */}
          <directionalLight position={[-1.2, 0.8, 0.8]} intensity={0.6} color="#ffe8cc" />
          <directionalLight position={[1.2, 0.6, 1.0]} intensity={0.5} />

          <VrmScene aiSpeaking={aiSpeaking} lipSync={lipSync} />
        </Canvas>
      </div>
    </AvatarErrorBoundary>
  );
}
