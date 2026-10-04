import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './stage.css';
import { useI18n } from '../i18n';
import { useMotionPref } from '../ui/useMotionPref';
import { parseStageParams, type StageLod } from './params';
import { StageEngine } from './stageEngine';
import { FINAL_VALUES, INTRO, INTRO_SESSION_KEY, introState, shouldPlayIntro, type IntroValues } from './intro';
import Placeholder from './Placeholder';

import { anchor } from './anchor';

const Stars = lazy(() => import('./Stars'));
const Motes = lazy(() => import('./Motes'));

function isTypingTarget(el: EventTarget | null) {
  const n = el as HTMLElement | null;
  return !!n && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(n.tagName) || n.isContentEditable);
}

/** Writes the storyboard numbers to CSS custom properties on the page root (no React re-render per frame). */
function applyValues(el: HTMLElement, v: IntroValues) {
  const s = el.style;
  s.setProperty('--i-stars', String(v.stars)); s.setProperty('--i-warm', String(v.warm)); s.setProperty('--i-plate', String(v.plate)); s.setProperty('--i-plate-zoom', String(v.plateZoom)); s.setProperty('--i-hud', String(v.hud)); s.setProperty('--i-egg', String(v.egg));
  s.setProperty('--i-spark', String(v.spark)); s.setProperty('--i-spark-k', String(v.sparkProgress));
  s.setProperty('--i-t1', String(v.title1)); s.setProperty('--i-t2', String(v.title2)); s.setProperty('--i-sub', String(v.sub));
  s.setProperty('--i-nav', String(v.nav)); s.setProperty('--i-btn', String(v.button)); s.setProperty('--i-ui', String(v.ui));
}

type Phase = 'play' | 'closing' | 'done';

/** Debug/test channel: window.__baymaxIntro (dev server, or any build with ?debug=1). */
function dbgSet(enabled: boolean, extra: Record<string, unknown>) {
  if (!enabled) return;
  const w = window as unknown as { __baymaxIntro?: Record<string, unknown> };
  w.__baymaxIntro = { ...w.__baymaxIntro, ...extra };
}

export default function StagePage() {
  const { t } = useI18n();
  const { reduced } = useMotionPref();
  const params = useMemo(() => parseStageParams(window.location.search), []);
  const rootRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StageEngine | null>(null);
  const reducedAtMount = useRef(reduced);
  // How the page opens: 'play' = storyboard, 'reduced' = straight fade, 'none' = already in the end state (?intro=0, seen this session, bare stage).
  const openMode = useMemo<'play' | 'reduced' | 'none'>(() => {
    if (params.bare) return 'none';
    if (reducedAtMount.current) return 'reduced';
    let seen = false;
    try { seen = window.sessionStorage.getItem(INTRO_SESSION_KEY) === '1'; } catch { /* storage disabled */ }
    return shouldPlayIntro({ intro: params.intro, reduced: false, seen, introT: params.introT }) ? 'play' : 'none';
  }, [params]);

  const [phase, setPhase] = useState<Phase>(openMode === 'play' ? 'play' : 'done');
  const phaseRef = useRef<Phase>(phase);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [showSkip, setShowSkip] = useState(false);
  const [revealed, setRevealed] = useState(openMode !== 'reduced');
  const [reason, setReason] = useState<string | null>(null);
  const [paused, setPaused] = useState(params.still || params.t !== null);
  const [lod, setLod] = useState<StageLod>(params.lod);
  const [fpsNotice, setFpsNotice] = useState(false);
  const [hintsFaded, setHintsFaded] = useState(false);
  const [voice, setVoice] = useState(false); // placeholder switch, no behaviour yet
  const ctl = useRef({ start: 0, readyAt: null as number | null, failedAt: null as number | null, skipAt: null as number | null, chip: { x: 0, y: 0, w: 0, h: 0 }, body: { cx: 0, cy: 0, h: 0, fx: 0, fy: 0 }, lastSkip: false });

  const elapsed = useCallback(() => params.introT ?? (performance.now() - ctl.current.start) / 1000, [params]);
  const debugOn = params.debug || !!import.meta.env?.DEV;
  const skip = useCallback(() => { const c = ctl.current; if (phaseRef.current === 'play' && c.skipAt === null) { c.skipAt = elapsed(); dbgSet(debugOn, { skipAt: +c.skipAt.toFixed(3) }); } }, [elapsed, debugOn]);

  // Engine + intro loop
  useEffect(() => {
    const host = hostRef.current, root = rootRef.current;
    if (!host || !root) return;
    const c = ctl.current; c.start = performance.now();
    if (params.introT !== null && openMode === 'play') c.readyAt = 0; // frozen storyboard assumes the model is there
    let engine: StageEngine | null = null; let raf = 0; let stopped = false;
    const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };
    const dbg = (extra: Record<string, unknown>) => dbgSet(debugOn, { mode: openMode, ...extra });
    dbg({ phase: phaseRef.current });
    try {
      engine = new StageEngine(host, params, {
        onPausedChange: setPaused,
        onReady: () => { c.readyAt ??= elapsed(); setReady(true); dbg({ readyAt: c.readyAt }); },
        onError: message => { c.failedAt ??= elapsed(); setFailed(message); dbg({ failedAt: c.failedAt, error: message }); },
        onFpsSwitch: () => {
          setFpsNotice(true); // shown once: the guard latches after firing
          setLod('low');
          const url = new URL(window.location.href); url.searchParams.set('lod', 'low'); window.history.replaceState(null, '', url);
        },
        onFrame: chip => {
          const px = (n: number) => `${n.toFixed(1)}px`;
          const b = c.body, bh = Math.abs(chip.foot.y - chip.top.y), cx = chip.foot.x, cy = (chip.foot.y + chip.top.y) / 2;
          anchor.cx = cx; anchor.cy = cy; anchor.h = bh; anchor.footX = chip.foot.x; anchor.footY = chip.foot.y; anchor.topY = chip.top.y; anchor.w = chip.w; anchor.vh = chip.h;
          if (Math.abs(b.cx - cx) + Math.abs(b.cy - cy) + Math.abs(b.h - bh) + Math.abs(b.fy - chip.foot.y) >= 0.4) {
            c.body = { cx, cy, h: bh, fx: chip.foot.x, fy: chip.foot.y };
            root.style.setProperty('--body-cx', px(cx)); root.style.setProperty('--body-cy', px(cy)); root.style.setProperty('--body-h', px(bh));
            root.style.setProperty('--foot-x', px(chip.foot.x)); root.style.setProperty('--foot-y', px(chip.foot.y));
          }
          const p = c.chip; if (Math.abs(p.x - chip.x) + Math.abs(p.y - chip.y) + Math.abs(p.w - chip.w) < 0.4) return;
          c.chip = chip; root.style.setProperty('--chip-x', px(chip.x)); root.style.setProperty('--chip-y', px(chip.y));
        },
      });
    } catch {
      c.failedAt ??= elapsed(); setFailed(t('err.webgl.unsupported'));
    }
    engineRef.current = engine;
    engine?.setReduced(reducedAtMount.current);
    void engine?.loadModel(params.lod);

    let slowTimer = 0;
    const finish = (why: string | null) => {
      applyValues(root, FINAL_VALUES); engine?.setIntro(null);
      setReason(why); setPhaseBoth('done'); setShowSkip(false);
      if (params.introT === null) { try { window.sessionStorage.setItem(INTRO_SESSION_KEY, '1'); } catch { /* ignore */ } }
      dbg({ phase: 'done', reason: why, doneAt: +elapsed().toFixed(3) });
    };
    if (openMode === 'play') {
      applyValues(root, introState({ elapsed: 0, readyAt: null, skipAt: null, failedAt: null }).values);
      engine?.setIntro(introState({ elapsed: 0, readyAt: null, skipAt: null, failedAt: null }).values);
      const tick = () => {
        if (stopped) return;
        const e = elapsed();
        const st = introState({ elapsed: e, readyAt: c.readyAt, skipAt: c.skipAt, failedAt: c.failedAt });
        applyValues(root, st.values); engine?.setIntro(st.values);
        // spark: from lower-right of the viewport to the chest chip
        const k = st.values.sparkProgress, W = c.chip.w || root.clientWidth, H = c.chip.h || root.clientHeight;
        root.style.setProperty('--spark-x', `${(0.74 * W + (c.chip.x - 0.74 * W) * k).toFixed(1)}px`);
        root.style.setProperty('--spark-y', `${(0.8 * H + (c.chip.y - 0.8 * H) * k).toFixed(1)}px`);
        root.dataset.introWaiting = st.waiting ? '1' : '0';
        if (st.showSkip !== c.lastSkip) { c.lastSkip = st.showSkip; setShowSkip(st.showSkip); }
        if (st.phase !== phaseRef.current) {
          if (st.phase === 'done') { finish(st.reason); return; }
          setPhaseBoth(st.phase); setReason(st.reason); dbg({ phase: st.phase, reason: st.reason });
        }
        if (st.reason === 'timeout' || st.reason === 'failed') setSlow(true);
        dbg({ elapsed: +e.toFixed(3), clock: +st.clock.toFixed(3), waiting: st.waiting });
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } else {
      applyValues(root, FINAL_VALUES);
      if (openMode === 'reduced') {
        // Reduced motion: no storyboard. Static warm dot while loading, then one 0.3 s opacity fade to the end state.
        root.style.setProperty('--i-spark', '1'); root.style.setProperty('--i-spark-k', '1');
        root.style.setProperty('--spark-x', 'var(--chip-x)'); root.style.setProperty('--spark-y', 'var(--chip-y)');
      }
    }
    slowTimer = window.setTimeout(() => setSlow(true), INTRO.giveUpAfter * 1000);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (phaseRef.current === 'play') { skip(); e.preventDefault(); } return; }
      if (e.code !== 'Space' || e.repeat) return;
      if (phaseRef.current !== 'done') { e.preventDefault(); skip(); return; } // during the intro Space = skip, never pause
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      engine?.togglePaused();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      stopped = true; cancelAnimationFrame(raf); window.clearTimeout(slowTimer);
      window.removeEventListener('keydown', onKey, true);
      engine?.dispose(); engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engine + intro are created once per page load
  }, [params]);

  useEffect(() => { engineRef.current?.setReduced(reduced); }, [reduced]);
  // Key-hint pill: fades out after 5 s without input (once the intro is over), comes back on mouse / key / touch.
  // Not while paused (the pill then carries the "paused" status) and never under reduced motion (no fade at all, it stays visible at low contrast).
  useEffect(() => {
    if (reduced || phase !== 'done' || paused || params.silhouette) { setHintsFaded(false); return; }
    let timer = window.setTimeout(() => setHintsFaded(true), 5000);
    const wake = () => { setHintsFaded(false); window.clearTimeout(timer); timer = window.setTimeout(() => setHintsFaded(true), 5000); };
    const evs = ['mousemove', 'keydown', 'pointerdown', 'touchstart'] as const;
    evs.forEach(e => window.addEventListener(e, wake, { passive: true }));
    return () => { window.clearTimeout(timer); evs.forEach(e => window.removeEventListener(e, wake)); };
  }, [reduced, phase, paused, params.silhouette]);
  useEffect(() => { void engineRef.current?.loadModel(lod); }, [lod]);

  // Reduced motion: reveal the page (0.3 s fade) once the model is there, or the model failed / is slow.
  useEffect(() => {
    if (openMode !== 'reduced' || revealed) return;
    if (ready || failed || slow) {
      rootRef.current?.style.setProperty('--i-spark', '0');
      setRevealed(true);
    }
  }, [openMode, revealed, ready, failed, slow]);

  const frozenShot = params.still || params.t !== null; // screenshot modes hold the pose by design; only a user pause shows the label
  const giveUp = !ready && (!!failed || slow);
  const lowTier = lod === 'low' || fpsNotice;
  const introOn = phase !== 'done';
  const dataIntro = openMode === 'reduced' ? (revealed ? 'reduced-fade' : 'reduced-wait') : introOn ? phase : 'done';

  const stage = <div ref={hostRef} className="care-stage" data-stage-host data-stage-phase={ready ? 'ready' : failed ? 'error' : 'loading'}/>;
  const status = <>
    {giveUp && <Placeholder/>}
    {giveUp && failed && <p role="status" data-stage-soft-error className="vz-soft">{t('stage.error.soft')}</p>}
    {giveUp && !failed && <p role="status" data-stage-waiting className="vz-soft">{t('stage.intro.waiting')}</p>}
    {fpsNotice && <p role="status" data-stage-fps-notice className="vz-soft vz-fps">{t('stage.fps.switched')}</p>}
  </>;
  const hints = !params.silhouette && <aside aria-label={t('stage.hints')} data-stage-hints data-faded={hintsFaded ? 1 : 0} className="vz-hints">
    <span><kbd>{t('stage.key.space')}</kbd><span>{t('stage.hint.pause')}</span></span>
    {(reduced || (paused && !frozenShot)) && <span role="status" data-stage-status>{reduced ? t('stage.reduced') : t('stage.paused')}</span>}
  </aside>;
  const motesOn = !reduced && !params.silhouette;
  const bg = <>
    <div className="vz-sky" aria-hidden="true"/>
    <div className="vz-plate" aria-hidden="true" data-stage-plate><i/></div>
    {!reduced && <Suspense fallback={null}><Stars count={lowTier ? 30 : 50}/></Suspense>}
    {params.theme === 'b' && <div className="vz-aurora" aria-hidden="true"><i/><i/><i/></div>}
  </>;
  const floor = <div className="vz-ground" aria-hidden="true"><i className="vz-pool"/><i className="vz-shadow"/></div>;
  const hud = <svg className="vz-hud" aria-hidden="true" focusable="false" viewBox="0 0 200 200" data-stage-hud>
    <defs><mask id="vz-hud-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
      <ellipse className="vz-hud-reveal" cx="100" cy="100" rx="82" ry="31" pathLength="1"/>
    </mask></defs>
    <ellipse className="vz-hud-orbit" cx="100" cy="100" rx="82" ry="31" transform="rotate(-14 100 100)" mask="url(#vz-hud-mask)"/>
    <path className="vz-hud-tick" d="M40 30v7M40 30h7M160 30v7M160 30h-7M40 170v-7M40 170h7M160 170v-7M160 170h-7"/>
  </svg>;
  const fx = <>
    <div className="vz-halo" aria-hidden="true"/>
    {motesOn && <Suspense fallback={null}><Motes count={lowTier ? 10 : 16}/></Suspense>}
    <div className="vz-spark" aria-hidden="true"/>
    <div className="vz-grain" aria-hidden="true"/>
    <div className="vz-vignette" aria-hidden="true"/>
  </>;
  const rootProps = {
    ref: rootRef as React.RefObject<HTMLElement>, 'aria-label': t('stage.title'), 'data-theme': params.theme, 'data-intro': dataIntro,
    'data-intro-reason': reason ?? '', 'data-lod': lod,
    onPointerDown: () => skip(),
  };

  if (params.bare) {
    return <main {...rootProps} className="care-page care-bare" data-stage-mode="bare">{bg}{params.silhouette ? null : floor}{stage}{params.silhouette ? null : fx}{status}<div className="vz-dock">{hints}</div></main>;
  }
  const lines = <>
    <span className="vz-line" data-l="1">{t('stage.hero.title1')}</span><span className="vz-line" data-l="2">{t('stage.hero.title2')}</span>
  </>;
  return <main {...rootProps} className="care-page" data-stage-mode="shell">
    {bg}{floor}{params.theme === 'a' && hud}{stage}{fx}
    <header className="vz-top" data-ui>
      <p className="vz-brand" data-nav><span className="vz-dot" aria-hidden="true"/><span className="vz-brand-name">{t('stage.brand')}</span><span className="vz-brand-mono" aria-hidden="true">{t('stage.brand.mono')}</span></p>
      <nav className="vz-nav" data-nav aria-label={t('stage.nav.label')}>
        <a href="#top" aria-current="page">{t('stage.nav.home')}</a>
        <a href="#scan">{t('stage.nav.scan')}</a>
        <a href="#about">{t('stage.nav.about')}</a>
        <a href="#scan" className="vz-nav-cta">{t('stage.nav.start')}</a>
      </nav>
    </header>
    <section id="top" className="vz-hero" data-ui>
      <div className="vz-copy">
        <p className="vz-label" data-sub><i className="vz-rule" aria-hidden="true"/>{t('stage.hero.label')}</p>
        <h1 className="vz-title">{lines}</h1>
        <p className="vz-sub" data-sub>{t('stage.hero.sub')}</p>
        <p className="vz-sub2" data-sub>{t('stage.hero.sub2')}</p>
      </div>
      <div className="vz-cta">
        <button type="button" id="scan" className="vz-btn" data-btn>
          <i className="vz-pip" aria-hidden="true"/><span>{t('stage.hero.cta')}</span>
          <svg className="vz-arrow" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M3.5 10h12M10.5 4.5 16 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <p className="vz-meta" data-btn>{t('stage.hero.meta')}</p>
        <p className="vz-status" data-btn><i aria-hidden="true"/>{t('stage.status')}</p>
      </div>
    </section>
    {params.theme === 'b' && <ul className="vz-cards" data-ui data-sub>
      {[1, 2, 3, 4].map(n => <li key={n} className="vz-card"><span className="vz-card-k">{t(`stage.card.${n}.k`)}</span><span className="vz-card-t">{t(`stage.card.${n}.t`)}</span></li>)}
    </ul>}
    {params.theme === 'a' && <p className="vz-egg" data-egg lang="zh-CN">
      <svg className="vz-egg-arrow" viewBox="0 0 64 40" aria-hidden="true" focusable="false"><path d="M60 33C47 36 28 33 17 21 12 16 9 11 8 6M8 6l-1 9M8 6l8 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      <span>{t('stage.egg')}</span>
    </p>}
    {status}
    <div className="vz-dock" data-ui>
      {hints}
      <button type="button" role="switch" aria-checked={voice} aria-label={t('stage.nav.voice')} className="vz-mic" onClick={() => setVoice(v => !v)}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><rect x="7" y="2.5" width="6" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7 17.5h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
      </button>
    </div>
    <p className="vz-note" data-ui>{t('stage.note')}</p>
    {phase === 'play' && openMode === 'play' && <div className="vz-progress" aria-hidden="true" data-waiting-line/>}
    {phase === 'play' && showSkip && <button type="button" className="vz-skip" data-intro-skip aria-label={t('stage.intro.skipLabel')} onClick={skip}>{t('stage.intro.skip')}</button>}
  </main>;
}
