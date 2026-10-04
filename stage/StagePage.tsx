import { useEffect, useMemo, useRef, useState } from 'react';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/noto-sans-sc/700.css';
import './stage.css';
import { useI18n } from '../i18n';
import { useMotionPref } from '../ui/useMotionPref';
import { parseStageParams, type StageLod } from './params';
import { StageEngine } from './stageEngine';

function isTypingTarget(el: EventTarget | null) {
  const n = el as HTMLElement | null;
  return !!n && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(n.tagName) || n.isContentEditable);
}

export default function StagePage() {
  const { t } = useI18n();
  const { reduced } = useMotionPref();
  const params = useMemo(() => parseStageParams(window.location.search), []);
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StageEngine | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorText, setErrorText] = useState('');
  const [paused, setPaused] = useState(params.still || params.t !== null);
  const [lod, setLod] = useState<StageLod>(params.lod);
  const [fpsNotice, setFpsNotice] = useState(false);
  const [voice, setVoice] = useState(false); // placeholder switch, no behaviour yet

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: StageEngine;
    try {
      engine = new StageEngine(host, params, {
        onPausedChange: setPaused,
        onReady: () => setPhase('ready'),
        onError: message => { setErrorText(message); setPhase('error'); },
        onFpsSwitch: () => {
          setFpsNotice(true); // shown once: the guard latches after firing
          setLod('low');
          const url = new URL(window.location.href); url.searchParams.set('lod', 'low'); window.history.replaceState(null, '', url);
        },
      });
    } catch {
      setErrorText(t('err.webgl.unsupported')); setPhase('error');
      return;
    }
    engineRef.current = engine;
    engine.setReduced(reduced);
    void engine.loadModel(params.lod);
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault();
      engine.togglePaused();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); engine.dispose(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engine is created once per page load
  }, [params]);

  useEffect(() => { engineRef.current?.setReduced(reduced); }, [reduced]);
  useEffect(() => { void engineRef.current?.loadModel(lod); }, [lod]);

  const stage = <div ref={hostRef} className="care-stage" data-stage-host data-stage-phase={phase}/>;
  const status = <>
    {phase === 'loading' && <p role="status" className="care-loading">{t('stage.loading')}</p>}
    {phase === 'error' && <p role="alert" className="care-error">{t('stage.error')}{errorText ? ` — ${errorText}` : ''}</p>}
    {fpsNotice && <p role="status" data-stage-fps-notice className="care-notice">{t('stage.fps.switched')}</p>}
  </>;
  const hints = !params.silhouette && <aside aria-label={t('stage.hints')} data-stage-hints className="care-hints">
    <span><kbd>{t('stage.key.space')}</kbd><span>{t('stage.hint.pause')}</span></span>
    {(reduced || paused) && <span role="status" data-stage-status>{reduced ? t('stage.reduced') : t('stage.paused')}</span>}
  </aside>;

  if (params.bare) {
    return <main aria-label={t('stage.title')} className="care-page care-bare" data-stage-mode="bare">{stage}{status}{hints}</main>;
  }
  return <main aria-label={t('stage.title')} className="care-page" data-stage-mode="shell">
    <div className="care-nav-wrap">
      <nav className="care-nav" aria-label={t('stage.nav.label')}>
        <a href="#top" aria-current="page">{t('stage.nav.home')}</a>
        <a href="#scan">{t('stage.nav.scan')}</a>
        <a href="#about">{t('stage.nav.about')}</a>
        <span className="care-sep" aria-hidden="true"/>
        <button type="button" role="switch" aria-checked={voice} className="care-voice" onClick={() => setVoice(v => !v)}>
          {t('stage.nav.voice')}<span className="care-track" aria-hidden="true"/>
        </button>
      </nav>
    </div>
    <section id="top" className="care-hero">
      {stage}
      <h1 className="care-title">{t('stage.hero.title')}</h1>
      <div id="scan" className="care-cta">
        <p className="care-sub">{t('stage.hero.sub')}<span className="care-tag">{t('stage.hero.soon')}</span></p>
        <button type="button" className="care-btn">{t('stage.hero.cta')}</button>
      </div>
      {status}{hints}
    </section>
    <footer id="about" className="care-footer">
      <p className="care-wordmark" aria-hidden="true">{t('stage.footer.word')}</p>
      <p className="care-closing">{t('stage.footer.line')}</p>
      <p className="care-note">{t('stage.footer.note')}</p>
    </footer>
  </main>;
}
