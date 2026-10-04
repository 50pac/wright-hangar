import {
  AmbientLight, AnimationClip, AnimationMixer, CanvasTexture, Color, DirectionalLight, Group, HemisphereLight,
  Mesh, MeshBasicMaterial, NeutralToneMapping, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, ShadowMaterial,
  SkinnedMesh, SRGBColorSpace, Vector3, WebGLRenderer, type Material, type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CLIP_NAME, MODEL_URLS, VIEW_PRESETS, type StageLod, type StageParams } from './params';
import { classifyMaterial, type MaterialRole } from './materialRoles';
import { createStageMaterial } from './materials';
import { clipShouldAdvance, decorPose } from './motion';
import { FpsGuard } from './fpsGuard';

export type StageStats = {
  ready: boolean; error: string | null; lod: StageLod; view: string; still: boolean; paused: boolean; reduced: boolean;
  clipTime: number; clipDuration: number; decor: { scaleY: number; pitch: number; amplitudeFactor: number };
  timings: { fetchParseMs: number | null; firstFrameMs: number | null; transferBytes: number | null };
  info: { calls: number; triangles: number; geometries: number; textures: number };
  fps: number; guard: { enabled: boolean; switched: boolean };
  model: { meshes: number; skinnedMeshes: number; bones: number; clip: string | null; roles: Record<string, string>; unmapped: string[] };
  bounds: { min: number[]; max: number[] } | null;
  eyeScreen: { l: number[]; r: number[] } | null;
};

export type EngineHooks = {
  onPausedChange?: (paused: boolean) => void;
  onFpsSwitch?: () => void;
  onReady?: (lod: StageLod) => void;
  onError?: (message: string) => void;
};

type Tokens = { bg0: string; bg1: string; bg2: string; floor: string };
export function readTokens(): Tokens {
  const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const v = (name: string, fallback: string) => css?.getPropertyValue(name).trim() || fallback;
  // R2 design-system tokens: ink-0/1/2 (background) and bone-3 (floor pool of light).
  return { bg0: v('--ink-0', '#0E0D0B'), bg1: v('--ink-1', '#17140F'), bg2: v('--ink-2', '#221E17'), floor: v('--bone-3', '#8B826F') };
}

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
  readonly camera = new PerspectiveCamera(30, 1, 0.05, 50);
  readonly controls: OrbitControls;
  private readonly wrapper = new Group();
  private readonly guard = new FpsGuard();
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly floorGroup = new Group();
  private mixer: AnimationMixer | null = null;
  private clip: AnimationClip | null = null;
  private model: Object3D | null = null;
  private lod: StageLod | null = null;
  private loadToken = 0;
  private animTime = 0;
  private decorTime = 0;
  private paused: boolean;
  private reduced = false;
  private lastNow = 0;
  private disposed = false;
  private fpsSwitched = false;
  private resizeObserver: ResizeObserver;
  private readonly eyes: Object3D[] = [];
  readonly stats: StageStats;

  constructor(private readonly host: HTMLElement, private readonly params: StageParams, private readonly hooks: EngineHooks = {}) {
    this.paused = params.still;
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

    const tokens = readTokens();
    host.style.background = params.silhouette ? '#000' : `radial-gradient(ellipse 70% 65% at 50% 58%, ${tokens.bg2} 0%, ${tokens.bg1} 55%, ${tokens.bg0} 100%)`;

    this.scene.add(this.wrapper);
    if (!params.silhouette) this.buildStageSet(tokens);

    const preset = VIEW_PRESETS[params.view];
    this.camera.position.set(...preset.position);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...preset.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.2; this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.enablePan = false;
    this.controls.update();

    this.stats = {
      ready: false, error: null, lod: params.lod, view: params.view, still: params.still, paused: this.paused, reduced: false,
      clipTime: 0, clipDuration: 0, decor: { scaleY: 1, pitch: 0, amplitudeFactor: 1 },
      timings: { fetchParseMs: null, firstFrameMs: null, transferBytes: null },
      info: { calls: 0, triangles: 0, geometries: 0, textures: 0 }, fps: 0,
      guard: { enabled: params.fpsGuard && !params.silhouette, switched: false },
      model: { meshes: 0, skinnedMeshes: 0, bones: 0, clip: null, roles: {}, unmapped: [] }, bounds: null, eyeScreen: null,
    };
    if (params.debug || import.meta.env?.DEV) (window as unknown as { __baymaxStage?: StageStats }).__baymaxStage = this.stats;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.renderer.setAnimationLoop(this.frame);
  }

  private buildStageSet(tokens: Tokens) {
    const env = new PMREMGenerator(this.renderer);
    this.scene.environment = env.fromScene(new RoomEnvironment(), 0.04).texture;
    env.dispose();
    // Cool sky / warm-neutral ground hemisphere → shadows fall towards blue, not grey.
    this.scene.add(new HemisphereLight(new Color('#B3C7FF'), new Color('#44506F'), 1.05));
    this.scene.add(new AmbientLight(new Color('#C4D3FF'), 0.18));
    const key = new DirectionalLight(new Color('#FFF6EA'), 2.4);
    key.position.set(1.8, 2.8, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -1.4, right: 1.4, top: 1.6, bottom: -1.2, near: 0.5, far: 8 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 4;
    this.scene.add(key);
    const rim = new DirectionalLight(new Color('#BFD4FF'), 1.1);
    rim.position.set(-2.2, 1.8, -2.4);
    this.scene.add(rim);

    // Soft pool of light on the floor so the shadow reads against the dark R2 background.
    const pool = new Mesh(new PlaneGeometry(4.2, 4.2), new MeshBasicMaterial({
      map: radialTexture([[0, 'rgba(255,255,255,0.55)'], [0.55, 'rgba(255,255,255,0.14)'], [1, 'rgba(255,255,255,0)']]),
      color: new Color(tokens.floor), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.55,
    }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.0004; pool.renderOrder = 0;
    const shadowCatcher = new Mesh(new PlaneGeometry(6, 6), new ShadowMaterial({ color: new Color('#101a33'), opacity: 0.5, depthWrite: false }));
    shadowCatcher.rotation.x = -Math.PI / 2; shadowCatcher.position.y = 0.0008; shadowCatcher.receiveShadow = true; shadowCatcher.renderOrder = 1;
    const contact = new Mesh(new PlaneGeometry(0.8, 0.5), new MeshBasicMaterial({
      map: radialTexture([[0, 'rgba(8,14,30,0.62)'], [0.5, 'rgba(8,14,30,0.25)'], [1, 'rgba(8,14,30,0)']]),
      transparent: true, depthWrite: false, toneMapped: false,
    }));
    contact.rotation.x = -Math.PI / 2; contact.position.set(0, 0.0012, 0.02); contact.renderOrder = 2;
    this.floorGroup.add(pool, shadowCatcher, contact);
    this.scene.add(this.floorGroup);
  }

  private resize = () => {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
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
      // first frame after the model is in the scene
      this.renderOnce();
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
    const roles: Record<string, string> = {}; const unmapped: string[] = [];
    let meshes = 0, skinned = 0; const bones = new Set<string>();
    this.eyes.length = 0;
    scene.traverse(o => {
      const mesh = o as Mesh;
      if ((o as { isBone?: boolean }).isBone) bones.add(o.name);
      if (!mesh.isMesh) return;
      meshes++; if ((mesh as SkinnedMesh).isSkinnedMesh) skinned++;
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
    this.stats.model = { meshes, skinnedMeshes: skinned, bones: bones.size, clip: null, roles, unmapped };

    this.clip = clips.find(c => c.name === CLIP_NAME) ?? null;
    this.mixer = new AnimationMixer(scene);
    if (this.clip) {
      const action = this.mixer.clipAction(this.clip); action.play();
      this.stats.model.clip = this.clip.name; this.stats.clipDuration = this.clip.duration;
      this.mixer.setTime(this.reduced || this.params.still ? 0 : this.animTime % this.clip.duration);
    }
    scene.updateMatrixWorld(true);
    const box = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
    scene.traverse(o => { const m = o as SkinnedMesh; if (m.isSkinnedMesh) m.skeleton.update(); });
    this.stats.bounds = this.measureBounds(scene, box);
  }

  private measureBounds(scene: Object3D, box: { min: Vector3; max: Vector3 }) {
    const v = new Vector3();
    scene.traverse(o => {
      const m = o as SkinnedMesh; if (!m.isSkinnedMesh) return;
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 7) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); box.min.min(v); box.max.max(v); }
    });
    return { min: box.min.toArray().map(n => +n.toFixed(4)), max: box.max.toArray().map(n => +n.toFixed(4)) };
  }

  private renderOnce() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const i = this.renderer.info;
    this.stats.info = { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min(Math.max((now - (this.lastNow || now)) / 1000, 0), 0.1); this.lastNow = now;
    const advance = clipShouldAdvance({ reduced: this.reduced, still: this.params.still, paused: this.paused });
    if (advance) this.animTime += dt;
    if (!this.paused && !this.params.still) this.decorTime += dt; // decorative breath keeps running (at reduced amplitude) under reduced motion
    if (this.mixer && this.clip) {
      const t = this.reduced || this.params.still ? 0 : this.animTime % this.clip.duration;
      this.mixer.setTime(t); this.stats.clipTime = t;
    }
    const pose = decorPose(this.decorTime, { reduced: this.reduced, still: this.params.still });
    this.wrapper.scale.y = pose.scaleY; this.wrapper.rotation.x = pose.pitch; this.stats.decor = { ...pose };
    this.renderOnce();
    if (this.eyes.length >= 2) this.stats.eyeScreen = { l: this.project(this.eyes[0]), r: this.project(this.eyes[1]) };
    if (this.stats.ready && this.stats.guard.enabled) {
      const r = this.guard.tick(performance.now()); this.stats.fps = +r.fps.toFixed(2);
      if (r.trigger && this.lod === 'full') { this.fpsSwitched = true; this.stats.guard.switched = true; this.hooks.onFpsSwitch?.(); }
    }
  };

  private project(o: Object3D) {
    const m = o as SkinnedMesh; const v = new Vector3();
    m.geometry.computeBoundingBox(); const c = new Vector3(); m.geometry.boundingBox!.getCenter(c);
    // skinned: use the skeleton's rest transform via getVertexPosition on the vertex nearest the box centre
    const pos = m.geometry.getAttribute('position'); let best = 0, bd = Infinity; const t = new Vector3();
    for (let i = 0; i < pos.count; i += 3) { t.fromBufferAttribute(pos, i); const d = t.distanceToSquared(c); if (d < bd) { bd = d; best = i; } }
    m.getVertexPosition(best, v); v.applyMatrix4(m.matrixWorld).project(this.camera);
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    return [Math.round((v.x * 0.5 + 0.5) * w), Math.round((-v.y * 0.5 + 0.5) * h)];
  }

  get guardSwitched() { return this.fpsSwitched; }

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
