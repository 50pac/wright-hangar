import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { KeyCap } from '../ui/KeyCap';
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
  const [paused, setPaused] = useState(params.still);
  const [lod, setLod] = useState<StageLod>(params.lod);
  const [fpsNotice, setFpsNotice] = useState(false);

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

  return <main aria-label={t('stage.title')} className="relative h-screen w-screen overflow-hidden bg-ink-0">
    <div ref={hostRef} className="absolute inset-0" data-stage-host data-stage-phase={phase}/>
    {phase === 'loading' && <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-step-1 text-bone-2">{t('stage.loading')}</p>}
    {phase === 'error' && <p role="alert" className="absolute inset-x-0 top-6 mx-auto w-fit border border-danger bg-ink-1 px-4 py-2 font-mono text-step-1 text-danger">{t('stage.error')}{errorText ? ` — ${errorText}` : ''}</p>}
    {fpsNotice && <p role="status" data-stage-fps-notice className="absolute inset-x-0 top-6 mx-auto w-fit border border-line-hi bg-ink-1/90 px-4 py-2 font-mono text-step-1 text-warn">{t('stage.fps.switched')}</p>}
    {!params.silhouette && <aside aria-label={t('stage.hints')} data-stage-hints className="pointer-events-none absolute bottom-4 left-4 flex flex-col gap-2 border border-line bg-ink-1/80 px-3 py-2 font-mono text-step-0 text-bone-2">
      <span className="flex items-center gap-2"><KeyCap>{t('stage.key.space')}</KeyCap><span>{t('stage.hint.pause')}</span></span>
      {(reduced || paused) && <span role="status" data-stage-status className="text-bone-3">{reduced ? t('stage.reduced') : t('stage.paused')}</span>}
    </aside>}
  </main>;
}
