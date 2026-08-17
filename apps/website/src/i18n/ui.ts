export const locales = ['en', 'de'] as const;
export type Locale = (typeof locales)[number];

export const localeLabel: Record<Locale, string> = {
  en: 'EN',
  de: 'DE',
};

export const LANG_STORAGE_KEY = 'beisammen:lang';

export type MomentCircle = {
  key: 'partner' | 'family' | 'friends';
  label: string;
  members: string;
  initials: string[];
  photoAlt: string;
  caption: string;
  date: string;
  reply: { initial: string; name: string; text: string; time: string };
  facts: string[];
};

type Dictionary = {
  htmlLang: string;
  meta: { title: string; description: string };
  masthead: { availability: string };
  nav: {
    why: string;
    circles: string;
    promises: string;
    waitlist: string;
    cta: string;
    menuLabel: string;
  };
  hero: {
    eyebrow: string;
    titlePlain: string;
    titleItalic: string;
    titleEnd: string;
    lede: string;
    primaryCta: string;
    secondaryCta: string;
    metaItems: string[];
    imageAlt: string;
  };
  manifesto: {
    eyebrow: string;
    titlePlain: string;
    titleItalic: string;
    body: string;
  };
  moments: {
    eyebrow: string;
    titlePlain: string;
    titleItalic: string;
    body: string;
    tablistLabel: string;
    hint: string;
    photoOpenLabel: string;
    photoCloseLabel: string;
    circles: MomentCircle[];
  };
  promises: {
    eyebrow: string;
    titlePlain: string;
    titleItalic: string;
    items: Array<{ title: string; body: string; linkLabel?: string }>;
  };
  waitlist: {
    eyebrow: string;
    titlePlain: string;
    titleItalic: string;
    body: string;
    emailPlaceholder: string;
    emailLabel: string;
    primary: string;
    pending: string;
    statusDone: string;
    footnote: string;
    success: string;
    duplicate: string;
    error: string;
    configError: string;
  };
  footer: {
    tagline: string;
    source: string;
    license: string;
    privacy: string;
    year: string;
  };
};

export const dict: Record<Locale, Dictionary> = {
  en: {
    htmlLang: 'en',
    meta: {
      title: 'beisammen — a quieter place for your closest photos',
      description:
        'Private photo circles for partners, families, and close friends. No feed, no followers, no algorithm.',
    },
    masthead: {
      availability: 'Private beta · 2026',
    },
    nav: {
      why: 'Why',
      circles: 'Circles',
      promises: 'Promises',
      waitlist: 'Access',
      cta: 'Request access',
      menuLabel: 'Open menu',
    },
    hero: {
      eyebrow: 'Private photo circles',
      titlePlain: 'Photos for',
      titleItalic: 'your people,',
      titleEnd: 'no one else.',
      lede:
        'No feed. No followers. No algorithm. Just the photos you take together — with the people who count.',
      primaryCta: 'Request early access',
      secondaryCta: 'How it works',
      metaItems: [
        'Invite-only circles',
        'Ready in a minute',
        'Your photos stay yours',
      ],
      imageAlt: 'Wide alpine meadow in soft morning light',
    },
    manifesto: {
      eyebrow: 'Why beisammen exists',
      titlePlain: 'Some moments don’t belong',
      titleItalic: 'on the internet.',
      body:
        'They belong to the people who were there. beisammen is a small, private place for exactly those moments — no feed, no strangers, no stage.',
    },
    moments: {
      eyebrow: 'Circles',
      titlePlain: 'A circle is',
      titleItalic: 'your place.',
      body:
        'Create a circle for the people who belong together. What you share there is seen by them — and no one else.',
      tablistLabel: 'Choose a circle',
      hint: 'Tap the photo to open it',
      photoOpenLabel: 'Open photo',
      photoCloseLabel: 'Close photo',
      circles: [
        {
          key: 'partner',
          label: 'Partner',
          members: '2 people',
          initials: ['N', 'A'],
          photoAlt: 'Desert dunes in warm evening light',
          caption: 'Dunes, just before eight',
          date: 'Aug 12',
          reply: { initial: 'A', name: 'Alex', text: 'Send me the full-size one.', time: '21:42' },
          facts: [
            'Visible to exactly 2 people',
            'No likes, only replies',
            'Originals in full quality',
          ],
        },
        {
          key: 'family',
          label: 'Family',
          members: '5 people',
          initials: ['M', 'K', 'J', 'E', 'L'],
          photoAlt: 'Misty pine forest on a quiet morning',
          caption: 'Sunday in the woods',
          date: 'Mar 9',
          reply: { initial: 'K', name: 'Kim', text: 'I want to go back already.', time: '16:08' },
          facts: [
            'Visible to exactly 5 people',
            'Nothing gets sorted or recommended',
            'Stays until you delete it',
          ],
        },
        {
          key: 'friends',
          label: 'Close friends',
          members: '4 people',
          initials: ['T', 'J', 'S', 'P'],
          photoAlt: 'Still lake at twilight with a forested shore',
          caption: 'Last day at the lake',
          date: 'Jun 24',
          reply: { initial: 'T', name: 'Toni', text: 'Same again next summer.', time: '23:17' },
          facts: [
            'Visible to exactly 4 people',
            'No explore tab, no trending',
            'Your shared archive',
          ],
        },
      ],
    },
    promises: {
      eyebrow: 'Promises',
      titlePlain: 'Four promises,',
      titleItalic: 'kept by design.',
      items: [
        {
          title: 'Invite-only',
          body: 'Every circle starts empty. You decide who joins — nobody else, ever.',
        },
        {
          title: 'No algorithm',
          body: 'Your photos appear in the order life happened. Nothing is ranked, nothing is recommended.',
        },
        {
          title: 'Safe in the cloud',
          body: 'Encrypted in transit and in storage, backed up automatically. Sign in and start — that is all it takes.',
        },
        {
          title: 'Built in the open',
          body: 'The source code is public. Read how it treats your photos — or run beisammen entirely yourself.',
          linkLabel: 'View the source',
        },
      ],
    },
    waitlist: {
      eyebrow: 'Access',
      titlePlain: 'We’re saving you',
      titleItalic: 'a seat.',
      body:
        'beisammen opens in small rounds. Leave your email and we will let you know the moment it is your turn.',
      emailPlaceholder: 'you@quiet.place',
      emailLabel: 'Email',
      primary: 'Request access',
      pending: 'Sending…',
      statusDone: 'Done',
      footnote: 'No newsletter. Just one email when it is time.',
      success: 'You are on the list — see you soon.',
      duplicate: 'You are already on the list. We have not forgotten.',
      error: 'Something went sideways. Try once more?',
      configError: 'The waitlist is not configured yet.',
    },
    footer: {
      tagline: 'For the ones who count.',
      source: 'Source',
      license: 'License',
      privacy: 'Privacy',
      year: 'MMXXVI · beisammen',
    },
  },
  de: {
    htmlLang: 'de',
    meta: {
      title: 'beisammen — ein leiserer Ort für eure Fotos',
      description:
        'Private Fotokreise für Partner, Familie und enge Freunde. Kein Feed, keine Follower, kein Algorithmus.',
    },
    masthead: {
      availability: 'Private Beta · 2026',
    },
    nav: {
      why: 'Warum',
      circles: 'Kreise',
      promises: 'Versprechen',
      waitlist: 'Zugang',
      cta: 'Zugang anfragen',
      menuLabel: 'Menü öffnen',
    },
    hero: {
      eyebrow: 'Private Fotokreise',
      titlePlain: 'Fotos für',
      titleItalic: 'deine Menschen,',
      titleEnd: 'sonst niemand.',
      lede:
        'Kein Feed. Keine Follower. Kein Algorithmus. Nur die Fotos, die ihr zusammen macht — mit den Menschen, die zählen.',
      primaryCta: 'Früher Zugang',
      secondaryCta: 'So funktioniert es',
      metaItems: [
        'Nur auf Einladung',
        'In einer Minute startklar',
        'Deine Fotos gehören dir',
      ],
      imageAlt: 'Weite Almwiese in weichem Morgenlicht',
    },
    manifesto: {
      eyebrow: 'Warum es beisammen gibt',
      titlePlain: 'Manche Momente gehören',
      titleItalic: 'nicht ins Internet.',
      body:
        'Sie gehören den Menschen, die dabei waren. beisammen ist ein kleiner, privater Ort für genau diese Momente — ohne Feed, ohne Fremde, ohne Bühne.',
    },
    moments: {
      eyebrow: 'Kreise',
      titlePlain: 'Ein Kreis ist',
      titleItalic: 'euer Ort.',
      body:
        'Erstelle einen Kreis für die Menschen, die zusammengehören. Was ihr dort teilt, sehen nur sie — sonst niemand.',
      tablistLabel: 'Kreis auswählen',
      hint: 'Foto antippen zum Öffnen',
      photoOpenLabel: 'Foto öffnen',
      photoCloseLabel: 'Foto schließen',
      circles: [
        {
          key: 'partner',
          label: 'Partner',
          members: '2 Personen',
          initials: ['N', 'A'],
          photoAlt: 'Dünen im warmen Abendlicht',
          caption: 'Dünen, kurz vor acht',
          date: '12. Aug',
          reply: { initial: 'A', name: 'Alex', text: 'Schick mir das in groß.', time: '21:42' },
          facts: [
            'Sichtbar für genau 2 Personen',
            'Keine Likes, nur Antworten',
            'Originale in voller Qualität',
          ],
        },
        {
          key: 'family',
          label: 'Familie',
          members: '5 Personen',
          initials: ['M', 'K', 'J', 'E', 'L'],
          photoAlt: 'Nebliger Nadelwald an einem ruhigen Morgen',
          caption: 'Sonntag im Wald',
          date: '9. März',
          reply: { initial: 'K', name: 'Kim', text: 'Da will ich gleich wieder hin.', time: '16:08' },
          facts: [
            'Sichtbar für genau 5 Personen',
            'Nichts wird sortiert oder empfohlen',
            'Bleibt, bis ihr es löscht',
          ],
        },
        {
          key: 'friends',
          label: 'Enge Freunde',
          members: '4 Personen',
          initials: ['T', 'J', 'S', 'P'],
          photoAlt: 'Stiller See in der Dämmerung mit bewaldetem Ufer',
          caption: 'Letzter Seetag',
          date: '24. Juni',
          reply: { initial: 'T', name: 'Toni', text: 'Nächsten Sommer wieder.', time: '23:17' },
          facts: [
            'Sichtbar für genau 4 Personen',
            'Kein Entdecken, kein Trending',
            'Euer gemeinsames Archiv',
          ],
        },
      ],
    },
    promises: {
      eyebrow: 'Versprechen',
      titlePlain: 'Vier Versprechen,',
      titleItalic: 'fest eingebaut.',
      items: [
        {
          title: 'Nur auf Einladung',
          body: 'Jeder Kreis beginnt leer. Wer dazukommt, entscheidet ihr — niemand sonst.',
        },
        {
          title: 'Kein Algorithmus',
          body: 'Eure Fotos erscheinen in der Reihenfolge, in der das Leben passiert ist. Nichts wird sortiert, nichts wird empfohlen.',
        },
        {
          title: 'Sicher in der Cloud',
          body: 'Verschlüsselt übertragen und gespeichert, automatisch gesichert. Anmelden und loslegen — mehr braucht es nicht.',
        },
        {
          title: 'Offen gebaut',
          body: 'Der Quelltext ist öffentlich. Lies nach, wie beisammen mit euren Fotos umgeht — oder betreibe es komplett selbst.',
          linkLabel: 'Zum Quelltext',
        },
      ],
    },
    waitlist: {
      eyebrow: 'Zugang',
      titlePlain: 'Wir halten dir',
      titleItalic: 'einen Platz frei.',
      body:
        'beisammen öffnet in kleinen Runden. Trag deine E-Mail ein und wir melden uns, sobald du dran bist.',
      emailPlaceholder: 'du@leiser.ort',
      emailLabel: 'E-Mail',
      primary: 'Zugang anfragen',
      pending: 'Wird gesendet…',
      statusDone: 'Erledigt',
      footnote: 'Kein Newsletter. Nur eine einzige E-Mail, wenn es so weit ist.',
      success: 'Du stehst auf der Liste — schön, dass du da bist.',
      duplicate: 'Du stehst schon auf der Liste. Wir haben dich nicht vergessen.',
      error: 'Da ist etwas schiefgegangen. Noch einmal versuchen?',
      configError: 'Die Warteliste ist noch nicht konfiguriert.',
    },
    footer: {
      tagline: 'Für die, die zählen.',
      source: 'Quelltext',
      license: 'Lizenz',
      privacy: 'Datenschutz',
      year: 'MMXXVI · beisammen',
    },
  },
};

export const repoUrl = 'https://github.com/cn0ss/beisammen';
export const licenseUrl = `${repoUrl}/blob/main/docs/licensing.md`;

export function localePath(locale: Locale, path: '' | 'privacy' | 'delete-account'): string {
  const prefix = locale === 'en' ? '/en' : '';
  return path === '' ? `${prefix}/` : `${prefix}/${path}/`;
}
