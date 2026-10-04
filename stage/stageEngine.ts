import {
  ACESFilmicToneMapping, AnimationClip, AnimationMixer, CanvasTexture, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  PerspectiveCamera, PMREMGenerator, PointLight, Quaternion, RingGeometry, Scene, ShaderMaterial, SphereGeometry,
  KeyframeTrack, SkinnedMesh, SRGBColorSpace, Vector3, WebGLRenderer, type Material, type MeshPhysicalMaterial, type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAMERA_FOV, CLIP_NAME, MODEL_HEIGHT, MODEL_URLS, TARGET, cameraDistance, cameraPosition, type StageLod, type StageParams } from './params';
import { THEME_LOOK, layoutFor, type StageLayout, type ThemeLook } from './themes';
import { FINAL_VALUES, type IntroValues } from './intro';
import { HIDDEN_MESH_PATTERN, classifyMaterial, type MaterialRole } from './materialRoles';
import { createStageMaterial } from './materials';
import { clipShouldAdvance, decorPose } from './motion';
import { FpsGuard } from './fpsGuard';

/** Planet placement in world units (model height 1, stands on y=0, faces +z); camera shares it. */
const PLANET = { x: -0.45, y: 0.5, z: -2.5 };
const PLANET_R = 0.62;

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
  chip: number[] | null; theme: string; intro: { warm: number; push: number; plate: number };
  planet: { screen: { x: number; y: number; r: number } | null; world?: { centre: number[]; ringNearestZ: number }; ringPoly?: number[][] };
};

/** Screen-space anchors (px, relative to the canvas): chest light (x, y), canvas size (w, h), feet centre and top of the head. */
export type ChipFrame = { x: number; y: number; w: number; h: number; foot: { x: number; y: number }; top: { x: number; y: number } };

export type EngineHooks = {
  onPausedChange?: (paused: boolean) => void;
  onFpsSwitch?: () => void;
  onReady?: (lod: StageLod) => void;
  onError?: (message: string) => void;
  /** Called every rendered frame with the screen position (px, relative to the canvas) of the chest light, the feet and the top of the head. */
  onFrame?: (chip: ChipFrame) => void;
};

export class StageEngine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.05, 50);
  readonly controls: OrbitControls;
  private readonly wrapper = new Group();
  private readonly look: ThemeLook;
  private hemi!: HemisphereLight; private rimLight!: DirectionalLight; private fillLight!: DirectionalLight; private warmLight!: PointLight; private planetGroup: Group | null = null;
  private planetMat: ShaderMaterial | null = null; private ringMat: ShaderMaterial | null = null;
  private readonly bodyMats: { mat: MeshPhysicalMaterial; base: number }[] = [];
  private iv: IntroValues = FINAL_VALUES;
  private chipLocal = new Vector3(0, 0.62, 0.2);
  /** The chest recess surface itself (the light hangs `offsetZ` in front of it); the CSS halo and the intro spark are centred here. */
  private readonly chestLocal = new Vector3(0, 0.62, 0);
  private readonly footLocal = new Vector3(0, 0, 0.02); private readonly topLocal = new Vector3(0, MODEL_HEIGHT, 0);
  private readonly tmpV = new Vector3();
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
    this.look = THEME_LOOK[params.theme];
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.look.exposure;
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
      chip: null, theme: params.theme, intro: { warm: 1, push: 1, plate: 1 }, planet: { screen: null },
    };
    if (params.debug || import.meta.env?.DEV) { const w = window as unknown as { __baymaxStage?: StageStats; __baymaxEngine?: StageEngine }; w.__baymaxStage = this.stats; w.__baymaxEngine = this; }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.renderer.setAnimationLoop(this.frame);
  }

  /**
   * Night scene: cold hemisphere + cold rim from the back right, one warm point light hanging in front of the chest chip
   * (the only warm source), dim IBL so the body keeps volume. Theme B swaps the balance (cool rim leads, warm chip is small) and drops the planet.
   */
  private buildStageSet() {
    const L = this.look;
    const env = new PMREMGenerator(this.renderer);
    this.scene.environment = env.fromScene(new RoomEnvironment(), 0.04).texture;
    env.dispose();
    this.hemi = new HemisphereLight(new Color(L.hemi.sky), new Color(L.hemi.ground), L.hemi.intensity);
    this.scene.add(this.hemi);
    this.rimLight = new DirectionalLight(new Color(L.rim.color), L.rim.intensity);
    this.rimLight.position.set(2.2, 1.6, -2.4);
    this.scene.add(this.rimLight);
    this.fillLight = new DirectionalLight(new Color(L.fill.color), L.fill.intensity);
    this.fillLight.position.set(-2.0, 1.4, 3.0);
    this.scene.add(this.fillLight);
    this.warmLight = new PointLight(new Color(L.warm.color), L.warm.intensity, L.warm.distance, L.warm.decay);
    this.warmLight.position.copy(this.chipLocal);
    this.wrapper.add(this.warmLight); // follows the lean / breath of the body
    if (L.planet) this.buildPlanet();
  }

  /**
   * Low-poly planet + ring behind the figure, procedural gradient #c9a27a → #5a3d2b → #120d0a; shares the camera, so it parallaxes when orbiting.
   * Depth: the planet sits well behind Baymax (ring's nearest point stays behind his back), the ring's far half is hidden by the ball
   * (depth test), its near half crosses in front of the ball, and the ball casts a shadow on the ring; the ring also darkens towards the ball.
   */
  private buildPlanet() {
    const g = new Group();
    this.planetMat = new ShaderMaterial({
      transparent: true,
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec2 vUv; void main(){ vN = normalize(normalMatrix * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vN; varying vec2 vUv; uniform float uOpacity;
        void main(){
          float l = clamp(dot(normalize(vN), normalize(vec3(-0.55, 0.3, 0.78))) * 0.5 + 0.5, 0.0, 1.0);
          vec3 lit = vec3(0.788, 0.635, 0.478), mid = vec3(0.353, 0.239, 0.169), dark = vec3(0.071, 0.051, 0.039);
          vec3 c = l > 0.5 ? mix(mid, lit, (l - 0.5) * 2.0) : mix(dark, mid, l * 2.0);
          float band = 0.5 + 0.5 * sin(vUv.y * 38.0 + sin(vUv.y * 11.0) * 1.6);
          c *= 0.9 + 0.12 * band;
          gl_FragColor = vec4(c, uOpacity);
        }`,
    });
    const ball = new Mesh(new SphereGeometry(PLANET_R, 40, 28), this.planetMat); ball.renderOrder = 1;
    const c = document.createElement('canvas'); c.width = 512; c.height = 4;
    const cx = c.getContext('2d')!; const grad = cx.createLinearGradient(0, 0, 512, 0);
    [[0, 'rgba(201,162,122,0)'], [0.08, 'rgba(201,162,122,.55)'], [0.3, 'rgba(201,162,122,.85)'], [0.42, 'rgba(90,61,43,.35)'], [0.5, 'rgba(201,162,122,.7)'], [0.75, 'rgba(160,126,92,.55)'], [0.92, 'rgba(90,61,43,.25)'], [1, 'rgba(90,61,43,0)']]
      .forEach(([o, col]) => grad.addColorStop(o as number, col as string));
    cx.fillStyle = grad; cx.fillRect(0, 0, 512, 4);
    const ringTex = new CanvasTexture(c); // raw sRGB values, sampled and written as is (no colour-space conversion)
    const ringGeo = new RingGeometry(0.86, 1.55, 96, 1);
    const uv = ringGeo.getAttribute('uv'), pos = ringGeo.getAttribute('position');
    for (let i = 0; i < uv.count; i++) { const r = Math.hypot(pos.getX(i), pos.getY(i)); uv.setXY(i, (r - 0.86) / (1.55 - 0.86), 0.5); }
    this.ringMat = new ShaderMaterial({
      transparent: true, side: DoubleSide, depthWrite: false,
      uniforms: { uMap: { value: ringTex }, uOpacity: { value: 0 }, uCenter: { value: new Vector3() }, uLight: { value: new Vector3(-0.5, 0.3, 0.8) }, uR: { value: PLANET_R } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }',
      fragmentShader: `varying vec2 vUv; varying vec3 vW; uniform sampler2D uMap; uniform float uOpacity, uR; uniform vec3 uCenter, uLight;
        void main(){
          vec4 t = texture2D(uMap, vUv);
          float nearBall = mix(0.4, 1.0, smoothstep(0.0, 0.4, vUv.x));          // darker close to the planet
          vec3 s = vW - uCenter; vec3 L = normalize(uLight); float along = dot(s, L);
          float perp = length(s - L * along);
          float shadow = along < 0.0 ? 1.0 - smoothstep(uR * 0.85, uR * 1.08, perp) : 0.0;  // the ball's shadow falls on the ring behind it
          gl_FragColor = vec4(t.rgb * nearBall * (1.0 - 0.72 * shadow), t.a * uOpacity * 0.9);
        }`,
    });
    const ring = new Mesh(ringGeo, this.ringMat); ring.renderOrder = 2; ring.rotation.x = -Math.PI / 2 + 0.38; ring.rotation.z = 0.18;
    g.add(ball, ring);
    g.rotation.z = -0.1;
    this.planetGroup = g; this.scene.add(g);
  }

  /** Planet centre: on the depth plane of its nominal world position, at the screen spot the layout asks for. */
  private placePlanet() {
    const g = this.planetGroup; if (!g) return;
    g.scale.setScalar(this.layout.planetScale);
    const at = this.layout.planetAt;
    const base = new Vector3(PLANET.x + this.tune.planetX, PLANET.y + this.tune.planetY, PLANET.z + this.tune.planetZ);
    if (!at) { g.position.copy(base); return; }
    this.camera.updateMatrixWorld(true);
    const fwd = new Vector3(); this.camera.getWorldDirection(fwd);
    const depth = base.clone().sub(this.camera.position).dot(fwd);
    const dir = new Vector3(at[0] * 2 - 1, 1 - at[1] * 2, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    g.position.copy(this.camera.position).addScaledVector(dir, depth / dir.dot(fwd));
  }

  private layout: StageLayout = layoutFor('a', 1.6, true);
  private placeCamera() {
    const d = cameraDistance(this.camera.aspect, CAMERA_FOV, this.layout.fill, this.layout.halfWidth) * (1 + 0.06 * (1 - this.iv.push));
    this.camera.position.set(...cameraPosition(this.params.view, d));
    this.camera.lookAt(...TARGET);
    this.controls.minDistance = d * 0.5; this.controls.maxDistance = d * 2.2;
    if (this.stats) this.stats.canvas.cameraDistance = +d.toFixed(4);
    this.placePlanet();
  }

  private resize = () => {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.layout = layoutFor(this.params.theme, w / h, this.params.bare && !this.params.shellLayout);
    if (this.layout.shiftX || this.layout.shiftY) this.camera.setViewOffset(w, h, -this.layout.shiftX * w, -this.layout.shiftY * h, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (!this.userMoved) { this.placeCamera(); this.controls.update(); }
    if (this.stats) { this.stats.canvas.width = w; this.stats.canvas.height = h; }
  };

  /** Intro storyboard values (null = final look). Lights come up, camera pushes in 6 %, planet fades in. */
  setIntro(v: IntroValues | null) {
    const next = v ?? FINAL_VALUES;
    const pushChanged = next.push !== this.iv.push;
    this.iv = next;
    if (pushChanged && !this.userMoved) { this.placeCamera(); this.controls.update(); }
    this.applyLook();
  }

  /** Dev-only multipliers (window.__baymaxEngine.tune) used to tune the look from measurements. */
  readonly tune = { warm: 1, fill: 1, rim: 1, env: 1, hemi: 1, planetX: 0, planetY: 0, planetZ: 0 };
  private warmBreath = 1;
  private applyLook() {
    if (this.params.silhouette) return;
    const L = this.look, v = this.iv;
    const lit = Math.max(v.rim, v.warm);
    this.wrapper.visible = lit > 0.001; // before the first light the model is not drawn at all (no dark silhouette in the 0.4–1.2 s spark phase)
    this.rimLight.intensity = L.rim.intensity * v.rim * this.tune.rim;
    this.fillLight.intensity = L.fill.intensity * lit * this.tune.fill;
    this.warmLight.intensity = L.warm.intensity * v.warm * this.warmBreath * this.tune.warm;
    this.hemi.intensity = L.hemi.intensity * lit * this.tune.hemi;
    this.scene.environmentIntensity = L.env * lit * this.tune.env; // three ≥ r163: material.envMapIntensity no longer scales scene.environment
    if (this.planetMat) this.planetMat.uniforms.uOpacity.value = v.plate;
    if (this.ringMat) this.ringMat.uniforms.uOpacity.value = v.plate;
  }

  /** Screen position of a model-local point (px, relative to the canvas). */
  projectChip(): ChipFrame {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    this.wrapper.updateMatrixWorld(true);
    const at = (v: Vector3) => { this.tmpV.copy(v).applyMatrix4(this.wrapper.matrixWorld).project(this.camera); return { x: (this.tmpV.x * 0.5 + 0.5) * w, y: (-this.tmpV.y * 0.5 + 0.5) * h }; };
    const chip = at(this.chestLocal);
    return { ...chip, w, h, foot: at(this.footLocal), top: at(this.topLocal) };
  }

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
      // First render with the model visible even if the intro keeps it dark, so shader compilation is paid here (and counted), not in the middle of the intro.
      this.wrapper.visible = true; this.applyPose(); this.renderOnce(); this.renderer.getContext().finish(); this.renderer.clear();
      this.applyLook();
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
    this.bodyMats.length = 0;
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
        this.bodyMats.push({ mat: next, base: next.envMapIntensity });
        mesh.castShadow = role !== 'eye'; mesh.receiveShadow = role === 'body' || role === 'chestCover';
        if (role === 'eye' && mesh.name.toLowerCase() !== 'eye_line') this.eyes.push(mesh);
      }
      mesh.frustumCulled = false; // skinned bind-pose bounds don't follow the arms
    });
    if (this.params.silhouette) {
      const flat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
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
    this.locateChip(scene);
    this.applyLook();
  }

  /** Warm light hangs `offsetZ` in front of the centre of the chest recess (the "chip"). */
  private locateChip(scene: Object3D) {
    const recess = scene.getObjectByName('Chest_Recess') as SkinnedMesh | undefined;
    if (!recess) return;
    const v = new Vector3(), min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    const pos = recess.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) { recess.getVertexPosition(i, v); v.applyMatrix4(recess.matrixWorld); min.min(v); max.max(v); }
    this.chipLocal.set((min.x + max.x) / 2, (min.y + max.y) / 2, max.z + this.look.warm.offsetZ);
    this.chestLocal.set(this.chipLocal.x, this.chipLocal.y, max.z);
    this.warmLight?.position.copy(this.chipLocal);
    this.stats.chip = [this.chipLocal.x, this.chipLocal.y, this.chipLocal.z].map(n => +n.toFixed(4));
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
    this.warmBreath = this.reduced || this.paused || this.fixedFraction !== null ? 1 : 1 + this.look.warm.breathAmp * Math.sin((2 * Math.PI * this.decorTime) / this.look.warm.breathPeriod);
    this.applyLook();
    this.applyPose();
    this.renderOnce();
    this.stats.intro = { warm: +this.iv.warm.toFixed(3), push: +this.iv.push.toFixed(3), plate: +this.iv.plate.toFixed(3) };
    if (this.planetGroup) {
      const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
      this.planetGroup.updateMatrixWorld(true);
      const c = new Vector3().setFromMatrixPosition(this.planetGroup.matrixWorld);
      const R = PLANET_R * this.layout.planetScale;
      if (this.ringMat) { // light comes from the upper left in view space (same as the ball's shading)
        this.ringMat.uniforms.uCenter.value.copy(c); this.ringMat.uniforms.uR.value = R;
        this.ringMat.uniforms.uLight.value.set(-0.55, 0.3, 0.78).transformDirection(this.camera.matrixWorld);
      }
      if (this.iv.plate > 0.01) {
        const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(R).add(c);
        const pc = c.clone().project(this.camera), pr = right.project(this.camera);
        this.stats.planet.screen = { x: (pc.x * 0.5 + 0.5) * w, y: (-pc.y * 0.5 + 0.5) * h, r: Math.abs(pr.x - pc.x) * 0.5 * w };
        const ringM = this.planetGroup.children[1].matrixWorld;
        this.stats.planet.ringPoly = Array.from({ length: 48 }, (_, i) => { const a = i / 48 * Math.PI * 2; const q = new Vector3(Math.cos(a) * 1.55, Math.sin(a) * 1.55, 0).applyMatrix4(ringM).project(this.camera); return [+((q.x * 0.5 + 0.5) * w).toFixed(1), +((-q.y * 0.5 + 0.5) * h).toFixed(1)]; });
        // ring (outer radius 1.55 × scale) nearest point to the camera, in world z, for the occlusion check against Baymax's back
        this.stats.planet.world = { centre: c.toArray().map(n => +n.toFixed(3)), ringNearestZ: +(c.z + 1.55 * this.layout.planetScale * Math.cos(0.38)).toFixed(3) };
      }
    }
    if (this.hooks.onFrame) { const c = this.projectChip(); this.hooks.onFrame(c); }
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
