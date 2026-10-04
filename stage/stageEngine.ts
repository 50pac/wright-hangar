import {
  AmbientLight, AnimationClip, AnimationMixer, CanvasTexture, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  NeutralToneMapping, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Quaternion, Scene, ShadowMaterial,
  KeyframeTrack, SkinnedMesh, SRGBColorSpace, Vector3, WebGLRenderer, type Material, type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAMERA_FOV, CLIP_NAME, MODEL_URLS, TARGET, cameraDistance, cameraPosition, type StageLod, type StageParams } from './params';
import { HIDDEN_MESH_PATTERN, classifyMaterial, type MaterialRole } from './materialRoles';
import { createStageMaterial } from './materials';
import { clipShouldAdvance, decorPose } from './motion';
import { FpsGuard } from './fpsGuard';

export type StageStats = {
  ready: boolean; error: string | null; lod: StageLod; view: string; still: boolean; fixedClipFraction: number | null; paused: boolean; reduced: boolean;
  clipTime: number; clipDuration: number; decor: { scaleY: number; leanRad: number; headTiltRad: number; amplitudeFactor: number };
  headBone: { found: boolean; animatedByClip: boolean; tiltAppliedDeg: number };
  wrapper: { leanDeg: number };
  timings: { fetchParseMs: number | null; firstFrameMs: number | null; transferBytes: number | null };
  info: { calls: number; triangles: number; geometries: number; textures: number };
  fps: number; guard: { enabled: boolean; switched: boolean };
  canvas: { width: number; height: number; cameraDistance: number; fov: number };
  model: { meshes: number; skinnedMeshes: number; bones: number; clip: string | null; roles: Record<string, string>; unmapped: string[]; hidden: string[] };
  bounds: { min: number[]; max: number[] } | null;
  eyeScreen: { l: number[]; r: number[] } | null;
};

export type EngineHooks = {
  onPausedChange?: (paused: boolean) => void;
  onFpsSwitch?: () => void;
  onReady?: (lod: StageLod) => void;
  onError?: (message: string) => void;
};

function radialTexture(stops: [number, string][], size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(c); tex.colorSpace = SRGBColorSpace; return tex;
}

export class StageEngine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.05, 50);
  readonly controls: OrbitControls;
  private readonly wrapper = new Group();
  private readonly guard = new FpsGuard();
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private mixer: AnimationMixer | null = null;
  private clip: AnimationClip | null = null;
  private model: Object3D | null = null;
  private headBone: Object3D | null = null;
  private headInterp: { evaluate(t: number): ArrayLike<number> } | null = null;
  private headRest = new Quaternion();
  private lod: StageLod | null = null;
  private loadToken = 0;
  private animTime = 0;
  private decorTime = 0;
  private paused: boolean;
  private reduced = false;
  private userMoved = false;
  private lastNow = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private readonly eyes: Object3D[] = [];
  private readonly fixedFraction: number | null;
  readonly stats: StageStats;

  constructor(private readonly host: HTMLElement, private readonly params: StageParams, private readonly hooks: EngineHooks = {}) {
    this.fixedFraction = params.t ?? (params.still ? 0 : null);
    this.paused = this.fixedFraction !== null;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, params.silhouette ? 1 : 0);
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.setAttribute('data-stage-canvas', '');
    if (params.silhouette) host.style.background = '#000';

    this.scene.add(this.wrapper);
    if (!params.silhouette) this.buildStageSet();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...TARGET);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.enablePan = false;
    // On the page shell the wheel / touch drag must keep scrolling the page; zoom is only for the bare stage.
    this.controls.enableZoom = params.bare;
    if (!params.bare) this.renderer.domElement.style.touchAction = 'pan-y';
    this.controls.addEventListener('start', () => { this.userMoved = true; });

    this.stats = {
      ready: false, error: null, lod: params.lod, view: params.view, still: params.still, fixedClipFraction: this.fixedFraction, paused: this.paused, reduced: false,
      clipTime: 0, clipDuration: 0, decor: { scaleY: 1, leanRad: 0, headTiltRad: 0, amplitudeFactor: 1 }, headBone: { found: false, animatedByClip: false, tiltAppliedDeg: 0 }, wrapper: { leanDeg: 0 },
      timings: { fetchParseMs: null, firstFrameMs: null, transferBytes: null },
      info: { calls: 0, triangles: 0, geometries: 0, textures: 0 }, fps: 0,
      guard: { enabled: params.fpsGuard && !params.silhouette, switched: false },
      canvas: { width: 0, height: 0, cameraDistance: 0, fov: CAMERA_FOV },
      model: { meshes: 0, skinnedMeshes: 0, bones: 0, clip: null, roles: {}, unmapped: [], hidden: [] }, bounds: null, eyeScreen: null,
    };
    if (params.debug || import.meta.env?.DEV) (window as unknown as { __baymaxStage?: StageStats }).__baymaxStage = this.stats;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.renderer.setAnimationLoop(this.frame);
  }

  /** Soft studio: warm key from the upper left, cool blue fill from the right, cool sky bounce, floor shadow + contact blob. */
  private buildStageSet() {
    const env = new PMREMGenerator(this.renderer);
    this.scene.environment = env.fromScene(new RoomEnvironment(), 0.04).texture;
    env.dispose();
    this.scene.add(new HemisphereLight(new Color('#C9D8FF'), new Color('#A39C94'), 0.85));
    this.scene.add(new AmbientLight(new Color('#C4D3FF'), 0.1));
    const key = new DirectionalLight(new Color('#FFF1E0'), 1.9);
    key.position.set(-2.2, 3.0, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 1.7, bottom: -1.3, near: 0.5, far: 9 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 5;
    this.scene.add(key);
    const fill = new DirectionalLight(new Color('#8DB0FF'), 0.95);
    fill.position.set(2.8, 0.9, 1.8);
    this.scene.add(fill);
    const rim = new DirectionalLight(new Color('#BFD4FF'), 0.8);
    rim.position.set(2.0, 1.8, -2.6);
    this.scene.add(rim);

    const shadowCatcher = new Mesh(new PlaneGeometry(6, 6), new ShadowMaterial({ color: new Color('#53638C'), opacity: 0.3, depthWrite: false }));
    shadowCatcher.rotation.x = -Math.PI / 2; shadowCatcher.position.y = 0.0008; shadowCatcher.receiveShadow = true; shadowCatcher.renderOrder = 1;
    const contact = new Mesh(new PlaneGeometry(0.86, 0.54), new MeshBasicMaterial({
      map: radialTexture([[0, 'rgba(58,72,108,0.50)'], [0.5, 'rgba(58,72,108,0.22)'], [1, 'rgba(58,72,108,0)']]),
      transparent: true, depthWrite: false, toneMapped: false,
    }));
    contact.rotation.x = -Math.PI / 2; contact.position.set(0, 0.0012, 0.02); contact.renderOrder = 2;
    this.scene.add(shadowCatcher, contact);
  }

  private placeCamera() {
    const d = cameraDistance(this.camera.aspect);
    this.camera.position.set(...cameraPosition(this.params.view, d));
    this.camera.lookAt(...TARGET);
    this.controls.minDistance = d * 0.5; this.controls.maxDistance = d * 2.2;
    this.stats && (this.stats.canvas.cameraDistance = +d.toFixed(4));
  }

  private resize = () => {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (!this.userMoved) { this.placeCamera(); this.controls.update(); }
    if (this.stats) { this.stats.canvas.width = w; this.stats.canvas.height = h; }
  };

  private onVisibility = () => { this.guard.reset(performance.now()); this.lastNow = performance.now(); };

  get isPaused() { return this.paused; }
  get currentLod() { return this.lod; }
  setPaused(p: boolean) {
    if (this.paused === p) return;
    this.paused = p; this.stats.paused = p; this.hooks.onPausedChange?.(p);
  }
  togglePaused() { this.setPaused(!this.paused); }
  setReduced(r: boolean) {
    this.reduced = r; this.stats.reduced = r;
    this.controls.enableDamping = !r;
    if (r) { this.animTime = 0; this.mixer?.setTime(0); }
  }

  private clipTimeNow() {
    if (!this.clip) return 0;
    if (this.reduced) return 0;
    if (this.fixedFraction !== null) return this.fixedFraction * this.clip.duration;
    return this.animTime % this.clip.duration;
  }

  async loadModel(lod: StageLod) {
    if (this.lod === lod || this.disposed) return;
    this.lod = lod; this.stats.lod = lod; this.stats.ready = false;
    const token = ++this.loadToken;
    const t0 = performance.now();
    try {
      const gltf = await this.loader.loadAsync(MODEL_URLS[lod]);
      if (this.disposed || token !== this.loadToken) return;
      const t1 = performance.now();
      this.stats.timings.fetchParseMs = Math.round(t1 - t0);
      const entry = performance.getEntriesByType('resource').filter(e => e.name.endsWith(MODEL_URLS[lod])).pop() as PerformanceResourceTiming | undefined;
      this.stats.timings.transferBytes = entry ? entry.transferSize || entry.encodedBodySize : null;
      this.swapModel(gltf.scene, gltf.animations);
      this.guard.reset(performance.now());
      this.applyPose(); this.renderOnce();
      this.renderer.getContext().finish();
      this.stats.timings.firstFrameMs = Math.round(performance.now() - t0);
      this.stats.ready = true;
      this.hooks.onReady?.(lod);
    } catch (e) {
      if (token !== this.loadToken) return;
      const msg = e instanceof Error ? e.message : String(e);
      this.stats.error = msg; this.hooks.onError?.(msg);
    }
  }

  private swapModel(scene: Object3D, clips: AnimationClip[]) {
    if (this.model) {
      this.wrapper.remove(this.model);
      this.model.traverse(o => { const m = o as Mesh; if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose()); } });
      this.mixer?.stopAllAction();
    }
    const roles: Record<string, string> = {}; const unmapped: string[] = []; const hidden: string[] = [];
    let meshes = 0, skinned = 0; const bones = new Set<string>();
    this.eyes.length = 0;
    scene.traverse(o => {
      const mesh = o as Mesh;
      if ((o as { isBone?: boolean }).isBone) bones.add(o.name);
      if (!mesh.isMesh) return;
      meshes++; if ((mesh as SkinnedMesh).isSkinnedMesh) skinned++;
      if (HIDDEN_MESH_PATTERN.test(mesh.name)) { mesh.visible = false; hidden.push(mesh.name); }
      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material;
      const role: MaterialRole | null = classifyMaterial(src.name, mesh.name);
      if (!role) { unmapped.push(`${mesh.name}/${src.name}`); } else {
        roles[mesh.name] = `${src.name} → ${role}`;
        const next = createStageMaterial(role, src.name);
        src.dispose(); mesh.material = next;
        mesh.castShadow = role !== 'eye'; mesh.receiveShadow = role === 'body' || role === 'chestCover';
        if (role === 'eye' && mesh.name.toLowerCase() !== 'eye_line') this.eyes.push(mesh);
      }
      mesh.frustumCulled = false; // skinned bind-pose bounds don't follow the arms
    });
    if (this.params.silhouette) {
      const flat = new MeshBasicMaterial({ color: 0xffffff });
      scene.traverse(o => { const m = o as Mesh; if (m.isMesh) m.material = flat; });
    }
    this.model = scene; this.wrapper.add(scene);
    this.stats.model = { meshes, skinnedMeshes: skinned, bones: bones.size, clip: null, roles, unmapped, hidden };

    this.clip = clips.find(c => c.name === CLIP_NAME) ?? null;
    this.mixer = new AnimationMixer(scene);
    if (this.clip) {
      this.mixer.clipAction(this.clip).play();
      this.stats.model.clip = this.clip.name; this.stats.clipDuration = this.clip.duration;
      this.mixer.setTime(this.clipTimeNow());
    }
    // Independent head bone → the head tilt is added on the bone (on top of the clip) instead of the whole body.
    this.headBone = scene.getObjectByName('Bone_Head') ?? null;
    this.stats.headBone = { found: !!this.headBone, animatedByClip: !!this.clip?.tracks.some(t => t.name.startsWith('Bone_Head.')), tiltAppliedDeg: 0 };
    this.headInterp = null;
    const headTrack = this.clip?.tracks.find(t => t.name === 'Bone_Head.quaternion') as (KeyframeTrack & { createInterpolant(): { evaluate(t: number): ArrayLike<number> } }) | undefined;
    if (headTrack) this.headInterp = headTrack.createInterpolant();
    if (this.headBone && !headTrack) this.headRest.copy(this.headBone.quaternion);
    scene.updateMatrixWorld(true);
    scene.traverse(o => { const m = o as SkinnedMesh; if (m.isSkinnedMesh) m.skeleton.update(); });
    this.stats.bounds = this.measureBounds(scene);
  }

  private measureBounds(scene: Object3D) {
    const v = new Vector3(); const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    scene.traverse(o => {
      const m = o as SkinnedMesh; if (!m.isSkinnedMesh) return;
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 7) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); min.min(v); max.max(v); }
    });
    return { min: min.toArray().map(n => +n.toFixed(4)), max: max.toArray().map(n => +n.toFixed(4)) };
  }

  private readonly qA = new Quaternion(); private readonly qB = new Quaternion(); private readonly qC = new Quaternion(); private readonly qD = new Quaternion(); private readonly zAxis = new Vector3(0, 0, 1);

  /** Clip → wrapper (lean, breath) → head bone tilt. Order matters: the mixer rewrites bone values every frame, the tilt is re-applied on top. */
  private applyPose() {
    if (this.mixer && this.clip) { const t = this.clipTimeNow(); this.mixer.setTime(t); this.stats.clipTime = t; }
    const frozen = this.paused || this.fixedFraction !== null;
    const pose = decorPose(this.decorTime, { reduced: this.reduced, frozen });
    this.wrapper.scale.y = pose.scaleY; this.wrapper.rotation.x = pose.leanRad; // +x rotation tips the top towards +Z (the model's front)
    this.stats.decor = { ...pose }; this.stats.wrapper.leanDeg = +((this.wrapper.rotation.x * 180) / Math.PI).toFixed(3);
    const head = this.headBone;
    if (head?.parent) {
      // The mixer only writes a bone when its sampled value changes, so re-derive the clip's own head rotation every frame
      // and tilt on top of that (otherwise the tilt would accumulate frame after frame).
      if (this.headInterp) head.quaternion.fromArray(this.headInterp.evaluate(this.clipTimeNow()) as number[]); else head.quaternion.copy(this.headRest);
      this.wrapper.updateMatrixWorld(true);
      head.parent.getWorldQuaternion(this.qA);                   // parent world rotation P (clip + lean already applied)
      this.wrapper.getWorldQuaternion(this.qB);                  // body (lean) rotation W
      // local' = P⁻¹ · W · Rz(tilt) · W⁻¹ · P · local   (roll about the model's own front axis)
      this.qC.setFromAxisAngle(this.zAxis, pose.headTiltRad);
      const world = this.qB.clone().multiply(this.qC).multiply(this.qB.clone().invert());
      const local = this.qA.clone().invert().multiply(world).multiply(this.qA);
      const before = this.qD.copy(head.quaternion);
      head.quaternion.premultiply(local);
      this.stats.headBone.tiltAppliedDeg = +((2 * Math.acos(Math.min(1, Math.abs(before.dot(head.quaternion)))) * 180) / Math.PI).toFixed(3);
    }
  }

  private renderOnce() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const i = this.renderer.info;
    this.stats.info = { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min(Math.max((now - (this.lastNow || now)) / 1000, 0), 0.5); this.lastNow = now;
    if (clipShouldAdvance({ reduced: this.reduced, fixed: this.fixedFraction !== null, paused: this.paused })) this.animTime += dt;
    if (!this.paused && this.fixedFraction === null) this.decorTime += dt; // breath keeps running (at reduced amplitude) under reduced motion
    this.applyPose();
    this.renderOnce();
    if (this.eyes.length >= 2) this.stats.eyeScreen = { l: this.project(this.eyes[0]), r: this.project(this.eyes[1]) };
    if (this.stats.ready && this.stats.guard.enabled) {
      const r = this.guard.tick(performance.now()); this.stats.fps = +r.fps.toFixed(2);
      if (r.trigger && this.lod === 'full') { this.stats.guard.switched = true; this.hooks.onFpsSwitch?.(); }
    }
  };

  private project(o: Object3D) {
    const m = o as SkinnedMesh; const v = new Vector3(); const c = new Vector3();
    m.geometry.computeBoundingBox(); m.geometry.boundingBox!.getCenter(c);
    const pos = m.geometry.getAttribute('position'); let best = 0, bd = Infinity; const t = new Vector3();
    for (let i = 0; i < pos.count; i += 3) { t.fromBufferAttribute(pos, i); const d = t.distanceToSquared(c); if (d < bd) { bd = d; best = i; } }
    m.getVertexPosition(best, v); v.applyMatrix4(m.matrixWorld).project(this.camera);
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    return [Math.round((v.x * 0.5 + 0.5) * w), Math.round((-v.y * 0.5 + 0.5) * h)];
  }

  dispose() {
    this.disposed = true; this.loadToken++;
    this.renderer.setAnimationLoop(null);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse(o => {
      const m = o as Mesh; if (!m.isMesh) return;
      m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => { (x as MeshBasicMaterial).map?.dispose(); x.dispose(); });
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    const w = window as unknown as { __baymaxStage?: StageStats };
    if (w.__baymaxStage === this.stats) delete w.__baymaxStage;
  }
}
