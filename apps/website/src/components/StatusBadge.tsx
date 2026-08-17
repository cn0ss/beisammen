import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// transitions.dev Pro "spinner-check-morph" — React variant. The morph
// itself lives in src/styles/transitions.css; this component only
// calibrates the check path length and pulses the cross-blur.

function readNum(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (raw.endsWith('ms')) return parseFloat(raw);
  if (raw.endsWith('s') && !raw.endsWith('ms')) return parseFloat(raw) * 1000;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? fallback : n;
}

type StatusBadgeProps = {
  state: 'loading' | 'done';
  label?: string;
};

export function StatusBadge({ state, label }: StatusBadgeProps) {
  const markRef = useRef<SVGPathElement>(null);
  const [len, setLen] = useState<number | null>(null);
  const [crossing, setCrossing] = useState(false);
  const mounted = useRef(false);

  // The dash length must be set before first paint, or the check would
  // flash fully drawn.
  useLayoutEffect(() => {
    const mark = markRef.current;
    if (mark) setLen(Math.ceil(mark.getTotalLength()));
  }, []);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setCrossing(true);
    const t = window.setTimeout(() => setCrossing(false), readNum('--check-fill-dur', 350) * 0.45);
    return () => window.clearTimeout(t);
  }, [state]);

  return (
    <span className={'t-check-blur-wrap' + (crossing ? ' is-crossing' : '')}>
      <span
        className="t-check-badge"
        data-state={state}
        style={len ? ({ '--check-mark-len': len } as React.CSSProperties) : undefined}
        role="img"
        aria-label={label ?? (state === 'done' ? 'Done' : 'In progress')}
      >
        <span className="t-check-ring" aria-hidden="true" />
        <span className="t-check-arc" aria-hidden="true" />
        <span className="t-check-fill" aria-hidden="true" />
        <span className="t-check-disc" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path ref={markRef} className="t-check-mark" d="M8 12.5L10.8 15.5L16.4 9.5" />
          </svg>
        </span>
      </span>
    </span>
  );
}
