import { lazy, Suspense } from 'react';
import { zh } from './i18n/zh';
import { useI18n } from './i18n';
import { isStageLocation } from './stage/params';

const KitPage = lazy(() => import('./ui/kit/KitPage'));
const StagePage = lazy(() => import('./stage/StagePage'));
export default function App() {
  const { t } = useI18n();
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('kit')) {
    return <Suspense fallback={<main className="flex h-screen items-center justify-center bg-ink-0 text-bone">{t('s0.loading')}</main>}><KitPage/></Suspense>;
  }
  if (typeof window !== 'undefined' && isStageLocation(window.location)) {
    return <Suspense fallback={<main className="flex h-screen items-center justify-center bg-ink-0 text-bone">{t('s0.loading')}</main>}><StagePage/></Suspense>;
  }
  return <main aria-label={zh['s0.title']} className="flex h-screen min-h-screen items-center justify-center bg-ink-0"><h1 className="font-display text-step-6 font-extrabold tracking-[.04em] text-bone">{zh['s0.title']}</h1></main>;
}
