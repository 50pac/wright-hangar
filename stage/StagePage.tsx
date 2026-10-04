import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './stage.css';
import { useI18n } from '../i18n';
import { useMotionPref } from '../ui/useMotionPref';
import { parseStageParams, type StageLod } from './params';
import { StageEngine } from './stageEngine';
import { FINAL_VALUES, INTRO, INTRO_SESSION_KEY, introState, shouldPlayIntro, type IntroValues } from './intro';
import Placeholder from './Placeholder';

const Stars = lazy(() => import('./Stars'));

function isTypingTarget(el: EventTarget | null) {
  const n = el as HTMLElement | null;
  return !!n && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(n.tagName) || n.isContentEditable);
}

/** Writes the storyboard numbers to CSS custom properties on the page root (no React re-render per frame). */
function applyValues(el: HTMLElement, v: IntroValues) {
  const s = el.style;
  s.setProperty('--i-stars', String(v.stars)); s.setProperty('--i-warm', String(v.warm)); s.setProperty('--i-planet', String(v.planet));
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
  const [voice, setVoice] = useState(false); // placeholder switch, no behaviour yet
  const ctl = useRef({ start: 0, readyAt: null as number | null, failedAt: null as number | null, skipAt: null as number | null, chip: { x: 0, y: 0, w: 0, h: 0 }, lastSkip: false });

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
          const p = c.chip; if (Math.abs(p.x - chip.x) + Math.abs(p.y - chip.y) + Math.abs(p.w - chip.w) < 0.4) return;
          c.chip = chip; root.style.setProperty('--chip-x', `${chip.x.toFixed(1)}px`); root.style.setProperty('--chip-y', `${chip.y.toFixed(1)}px`);
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
        root.style.setProperty('--spark-x', `${(0.62 * W + (c.chip.x - 0.62 * W) * k).toFixed(1)}px`);
        root.style.setProperty('--spark-y', `${(0.72 * H + (c.chip.y - 0.72 * H) * k).toFixed(1)}px`);
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
  const hints = !params.silhouette && <aside aria-label={t('stage.hints')} data-stage-hints className="vz-hints">
    <span><kbd>{t('stage.key.space')}</kbd><span>{t('stage.hint.pause')}</span></span>
    {(reduced || (paused && !frozenShot)) && <span role="status" data-stage-status>{reduced ? t('stage.reduced') : t('stage.paused')}</span>}
  </aside>;
  const bg = <>
    <div className="vz-sky" aria-hidden="true"/>
    {!reduced && <Suspense fallback={null}><Stars count={lowTier ? 40 : 80}/></Suspense>}
    {params.theme === 'b' && <div className="vz-aurora" aria-hidden="true"><i/><i/><i/></div>}
  </>;
  const fx = <>
    <div className="vz-halo" aria-hidden="true"/>
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
    return <main {...rootProps} className="care-page care-bare" data-stage-mode="bare">{bg}{stage}{params.silhouette ? null : fx}{status}{hints}</main>;
  }
  const lines = <>
    <span className="vz-line" data-l="1">{t('stage.hero.title1')}</span><span className="vz-line" data-l="2">{t('stage.hero.title2')}</span>
  </>;
  return <main {...rootProps} className="care-page" data-stage-mode="shell">
    {bg}{stage}{fx}
    <header className="vz-top" data-ui>
      <p className="vz-brand" data-nav><span className="vz-dot" aria-hidden="true"/>{t('stage.brand')}</p>
      <nav className="vz-nav" data-nav aria-label={t('stage.nav.label')}>
        <a href="#top" aria-current="page">{t('stage.nav.home')}</a>
        <a href="#scan">{t('stage.nav.scan')}</a>
        <a href="#about">{t('stage.nav.about')}</a>
        <span className="vz-sep" aria-hidden="true"/>
        <button type="button" role="switch" aria-checked={voice} className="vz-voice" onClick={() => setVoice(v => !v)}>
          {t('stage.nav.voice')}<span className="vz-track" aria-hidden="true"/>
        </button>
      </nav>
    </header>
    <section id="top" className="vz-hero" data-ui>
      <p className="vz-label" data-sub>{t('stage.hero.label')}</p>
      <h1 className="vz-title">{lines}</h1>
      <p className="vz-sub" data-sub>{t('stage.hero.sub')}</p>
      <button type="button" id="scan" className="vz-btn" data-btn><span>{t('stage.hero.cta')}</span></button>
    </section>
    {params.theme === 'b' && <ul className="vz-cards" data-ui data-sub>
      {[1, 2, 3, 4].map(n => <li key={n} className="vz-card"><span className="vz-card-k">{t(`stage.card.${n}.k`)}</span><span className="vz-card-t">{t(`stage.card.${n}.t`)}</span></li>)}
    </ul>}
    {params.theme === 'a' && <p className="vz-egg" data-sub lang="zh-CN">{t('stage.egg')}</p>}
    {status}{hints}
    <p className="vz-note" data-sub>{t('stage.note')}</p>
    {phase === 'play' && openMode === 'play' && <div className="vz-progress" aria-hidden="true" data-waiting-line/>}
    {phase === 'play' && showSkip && <button type="button" className="vz-skip" data-intro-skip aria-label={t('stage.intro.skipLabel')} onClick={skip}>{t('stage.intro.skip')}</button>}
  </main>;
}

