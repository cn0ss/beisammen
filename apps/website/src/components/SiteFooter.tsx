import { Link } from 'react-router';
import { dict, licenseUrl, localePath, repoUrl, type Locale } from '@/i18n/ui';

export function SiteFooter({ locale }: { locale: Locale }) {
  const t = dict[locale];

  return (
    <footer className="mt-12 overflow-hidden border-t border-ink/10 px-4 pt-10 sm:mt-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-center gap-6 text-center lg:grid-cols-[1fr_auto_1fr] lg:text-left">
          <p className="text-sm text-ink/70">{t.footer.tagline}</p>
          <nav aria-label="Secondary">
            <ul role="list" className="flex items-center justify-center gap-6 text-sm text-ink/70">
              <li>
                <a href={repoUrl} rel="noopener noreferrer" className="hover:text-ember">
                  {t.footer.source}
                </a>
              </li>
              <li>
                <a href={licenseUrl} rel="noopener noreferrer" className="hover:text-ember">
                  {t.footer.license}
                </a>
              </li>
              <li>
                <Link to={localePath(locale, 'privacy')} className="hover:text-ember">
                  {t.footer.privacy}
                </Link>
              </li>
            </ul>
          </nav>
          <p className="font-mono text-xs tracking-widest text-ink/40 lg:text-right">
            {t.footer.year}
          </p>
        </div>

        {/* Ghost wordmark — bookends the hero's oversized type. */}
        <p
          aria-hidden="true"
          className="pointer-events-none mt-8 -mb-[0.24em] text-center text-[clamp(4rem,14.5vw,13rem)] leading-none font-extrabold tracking-tighter text-ink/6 select-none"
        >
          beisammen<span className="text-ember/25">.</span>
        </p>
      </div>
    </footer>
  );
}
