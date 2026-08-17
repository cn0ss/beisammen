import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { publicShareEndpoint } from '@/lib/instance';
import { usePageMeta } from '@/lib/meta';

// German-only, like the previous static viewer — public circle links are
// created by the German-first mobile app.

type PublicAsset = {
  _id: string;
  kind: 'image' | 'video';
  fileName?: string;
  mimeType: string;
  url: string | null;
  previewUrl: string | null;
};

type PublicShare = {
  _id: string;
  caption: string;
  assetCount: number;
  authorName: string;
  publishedAt: number;
  createdAtLabel: string;
  assets: PublicAsset[];
};

type PublicCircle = {
  _id: string;
  name: string;
  description: string;
};

type PublicShareResponse = {
  ok?: boolean;
  circle?: PublicCircle;
  link?: { expiresAt: number };
  shares?: PublicShare[];
  isDone?: boolean;
  continueCursor?: string;
};

type ViewState =
  | { kind: 'status'; title: string; message: string; retryable?: boolean }
  | {
      kind: 'ready';
      circle: PublicCircle;
      link: { expiresAt: number };
      shares: PublicShare[];
      isDone: boolean;
    };

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const dayFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

function formatDate(value: number | null | undefined, formatter: Intl.DateTimeFormat): string {
  if (!value || !Number.isFinite(value)) {
    return '';
  }
  return formatter.format(new Date(value));
}

function readToken(): string {
  const hashToken = window.location.hash.replace(/^#/, '').trim();
  if (hashToken) {
    try {
      return decodeURIComponent(hashToken);
    } catch {
      // Malformed percent sequence — let the backend reject the raw token.
      return hashToken;
    }
  }
  return new URLSearchParams(window.location.search).get('token')?.trim() ?? '';
}

function MediaGrid({
  share,
  onOpen,
}: {
  share: PublicShare;
  onOpen: (url: string, alt: string) => void;
}) {
  const count = Math.min(share.assets.length, 4);

  return (
    <div className={'grid gap-2 p-4 sm:p-5 ' + (count >= 2 ? 'grid-cols-2' : 'grid-cols-1')}>
      {share.assets.map((asset, index) => {
        const spanFirstOfThree = share.assets.length === 3 && index === 0;
        const frameClass =
          'overflow-hidden rounded-lg bg-ink ' +
          (spanFirstOfThree
            ? 'sm:row-span-2 sm:aspect-auto aspect-4/3'
            : share.assets.length === 1
              ? 'aspect-16/10'
              : 'aspect-4/3');

        if (asset.kind === 'video') {
          return (
            <figure key={asset._id} className={frameClass}>
              <video
                controls
                playsInline
                preload="metadata"
                src={asset.url ?? undefined}
                poster={asset.previewUrl ?? undefined}
                className="size-full bg-ink object-contain"
              />
            </figure>
          );
        }

        const imageUrl = asset.previewUrl || asset.url;
        const fullUrl = asset.url || imageUrl;
        const alt = asset.fileName || share.caption || 'Beisammen Foto';

        return (
          <figure key={asset._id} className={frameClass}>
            <button
              type="button"
              className="block size-full cursor-zoom-in"
              onClick={() => fullUrl && onOpen(fullUrl, alt)}
            >
              <img
                src={imageUrl ?? undefined}
                alt={alt}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            </button>
          </figure>
        );
      })}
    </div>
  );
}

export function SharePage() {
  usePageMeta({
    lang: 'de',
    title: 'Beisammen ansehen',
    description: 'Eine private Beisammen-Ansicht für geteilte Familienmomente.',
    referrerPolicy: 'no-referrer',
  });

  const [token] = useState(readToken);
  const [view, setView] = useState<ViewState>({
    kind: 'status',
    title: 'Wird geladen',
    message: 'Die geteilten Momente werden vorbereitet.',
  });
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
  const cursorRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const loadPage = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      if (!publicShareEndpoint) {
        setView({
          kind: 'status',
          title: 'Nicht konfiguriert',
          message: 'Die öffentliche Ansicht ist noch nicht mit einer Beisammen-Instanz verbunden.',
        });
        return;
      }
      if (!token) {
        setView({
          kind: 'status',
          title: 'Link fehlt',
          message: 'Dieser öffentliche Link ist unvollständig.',
        });
        return;
      }

      // A newer call (e.g. a refresh) supersedes any in-flight response.
      const requestId = ++requestIdRef.current;
      setLoading(true);
      if (reset) {
        cursorRef.current = null;
        setView({
          kind: 'status',
          title: 'Wird geladen',
          message: 'Die geteilten Momente werden vorbereitet.',
        });
      }

      try {
        const response = await fetch(publicShareEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, cursor: cursorRef.current }),
        });
        const body = (await response.json().catch(() => null)) as PublicShareResponse | null;
        if (requestId !== requestIdRef.current) {
          return;
        }

        if (!response.ok || !body?.ok || !body.circle || !body.link || !Array.isArray(body.shares)) {
          setView({
            kind: 'status',
            title: 'Link nicht verfügbar',
            message: 'Dieser Link ist abgelaufen oder wurde zurückgezogen.',
            retryable: true,
          });
          return;
        }

        const nextShares = body.shares;
        cursorRef.current = typeof body.continueCursor === 'string' ? body.continueCursor : null;
        setView((previous) => ({
          kind: 'ready',
          circle: body.circle!,
          link: body.link!,
          shares:
            reset || previous.kind !== 'ready'
              ? nextShares
              : [...previous.shares, ...nextShares],
          isDone: Boolean(body.isDone),
        }));
      } catch {
        if (requestId !== requestIdRef.current) {
          return;
        }
        // Keep an already-loaded feed on a failed "Mehr laden" — only a
        // failed initial load or refresh falls back to the status card.
        setView((previous) =>
          !reset && previous.kind === 'ready'
            ? previous
            : {
                kind: 'status',
                title: 'Verbindung fehlgeschlagen',
                message: 'Die geteilten Momente konnten gerade nicht geladen werden.',
                retryable: true,
              },
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [token],
  );

  useEffect(() => {
    void loadPage({ reset: true });
  }, [loadPage]);

  useEffect(() => {
    if (!lightbox) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLightbox(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [lightbox]);

  return (
    <div className="isolate min-h-svh p-4 sm:p-6 xl:p-8">
      <header className="mx-auto mb-4 flex w-full max-w-[1440px] items-center justify-between gap-4">
        <Link to="/" aria-label="Homepage">
          <Logo size={26} />
        </Link>
        {view.kind === 'ready' && (
          <Button
            variant="outline"
            className="rounded-full bg-cream"
            disabled={loading}
            onClick={() => void loadPage({ reset: true })}
          >
            Aktualisieren
          </Button>
        )}
      </header>

      {view.kind === 'status' ? (
        <section className="mx-auto mt-[16svh] w-full max-w-2xl rounded-3xl border border-ink/10 bg-cream/90 p-7 shadow-sm">
          <p className="font-mono text-xs tracking-widest text-ember-deep uppercase">beisammen</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {view.title}
          </h1>
          <p className="mt-3 text-ink/70">{view.message}</p>
          {view.retryable && (
            <Button
              variant="outline"
              className="mt-5 rounded-full bg-cream"
              disabled={loading}
              onClick={() => void loadPage({ reset: true })}
            >
              Erneut versuchen
            </Button>
          )}
        </section>
      ) : (
        <section className="mx-auto grid w-full max-w-[1440px] gap-4 md:grid-cols-[320px_minmax(0,1fr)] md:items-start xl:grid-cols-[380px_minmax(0,1fr)] xl:gap-5">
          <aside
            aria-label="Circle"
            className="rounded-3xl border border-ink/10 bg-cream/90 p-6 shadow-sm md:sticky md:top-6"
          >
            <p className="font-mono text-xs tracking-widest text-ember-deep uppercase">
              Familienseite
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance break-words xl:text-5xl">
              {view.circle.name || 'Beisammen'}
            </h1>
            <p className="mt-4 min-h-6 text-ink/70">{view.circle.description}</p>
            <dl className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-ink/10 bg-paper p-3">
                <dt className="font-mono text-[0.65rem] tracking-wide text-ink/40 uppercase">
                  Beiträge
                </dt>
                <dd className="mt-1 font-semibold tabular-nums break-words">
                  {view.shares.length}
                </dd>
              </div>
              <div className="rounded-xl border border-ink/10 bg-paper p-3">
                <dt className="font-mono text-[0.65rem] tracking-wide text-ink/40 uppercase">
                  Link gültig
                </dt>
                <dd className="mt-1 font-semibold break-words">
                  {formatDate(view.link.expiresAt, dayFormatter)}
                </dd>
              </div>
            </dl>
          </aside>

          <div className="min-w-0">
            {view.shares.length === 0 ? (
              <section className="mx-auto mt-[8svh] w-full max-w-2xl rounded-3xl border border-ink/10 bg-cream/90 p-7 shadow-sm">
                <p className="font-mono text-xs tracking-widest text-ember-deep uppercase">
                  Noch ruhig
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-balance">
                  Noch keine geteilten Momente
                </h2>
                <p className="mt-3 text-ink/70">
                  Sobald in diesem Circle etwas veröffentlicht wird, erscheint es hier.
                </p>
              </section>
            ) : (
              <div className="grid gap-4 xl:gap-5">
                {view.shares.map((share) => (
                  <article
                    key={share._id}
                    className="overflow-hidden rounded-3xl border border-ink/10 bg-cream/95 shadow-sm"
                  >
                    <header className="flex items-start justify-between gap-4 border-b border-ink/10 p-4 sm:p-5">
                      <div className="min-w-0">
                        <p className="font-semibold break-words">
                          {share.authorName || 'Beisammen'}
                        </p>
                        <p className="mt-0.5 text-sm text-ink/50">
                          {formatDate(share.publishedAt, dateFormatter) || share.createdAtLabel}
                        </p>
                      </div>
                      <p className="shrink-0 rounded-full border border-ink/10 px-2.5 py-1 font-mono text-xs text-ink/60">
                        {share.assets.length} {share.assets.length === 1 ? 'Medium' : 'Medien'}
                      </p>
                    </header>
                    {share.caption.trim() && (
                      <p className="px-4 pt-4 text-lg/7 break-words whitespace-pre-wrap sm:px-5">
                        {share.caption.trim()}
                      </p>
                    )}
                    <MediaGrid
                      share={share}
                      onOpen={(url, alt) => setLightbox({ url, alt })}
                    />
                  </article>
                ))}

                {!view.isDone && (
                  <div className="flex justify-center pt-2 pb-6">
                    <Button
                      variant="outline"
                      className="rounded-full bg-cream"
                      disabled={loading}
                      onClick={() => void loadPage()}
                    >
                      {loading ? 'Wird geladen…' : 'Mehr laden'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-200 grid place-items-center bg-ink/90 p-4 pt-18"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setLightbox(null);
            }
          }}
        >
          <img
            src={lightbox.url}
            alt={lightbox.alt}
            className="max-h-[82svh] max-w-full rounded-lg object-contain shadow-2xl"
          />
          <Button
            variant="outline"
            className="fixed top-4 right-4 rounded-full bg-cream"
            onClick={() => setLightbox(null)}
          >
            Schließen
          </Button>
        </div>
      )}
    </div>
  );
}
