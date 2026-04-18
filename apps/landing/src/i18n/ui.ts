export const locales = ['en', 'de'] as const;
export type Locale = (typeof locales)[number];

export const localeLabel: Record<Locale, string> = {
  en: 'EN',
  de: 'DE',
};

export const localeLongLabel: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
};

type CircleCard = {
  eyebrow: string;
  size: string;
  name: string;
  title: { plain: string; italic: string };
  body: string;
  initials: string[];
};

type Dictionary = {
  htmlLang: string;
  meta: { title: string; description: string };
  masthead: { availability: string };
  nav: { why: string; circles: string; hosting: string; waitlist: string };
  hero: {
    eyebrow: string;
    titleLine1: string;
    titleItalic: string;
    titleLine2: string;
    lede: string;
    primaryCta: string;
    secondaryCta: string;
    metaItems: string[];
    polaroids: Array<{ caption: string; date: string }>;
  };
  promise: {
    eyebrow: string;
    titlePlain: string;
    titleItalic: string;
    body: string;
  };
  circles: {
    eyebrow: string;
    label: string;
    titlePlain: string;
    titleItalic: string;
    cards: CircleCard[];
  };
  principles: {
    eyebrow: string;
    titlePlain: string;
    titleItalic: string;
    items: Array<{ title: string; body: string }>;
  };
  hosting: {
    eyebrow: string;
    titlePlain: string;
    titleItalic: string;
    cloud: {
      tag: string;
      badge: string;
      titlePlain: string;
      titleItalic: string;
      body: string;
      points: string[];
    };
    self: {
      tag: string;
      badge: string;
      titlePlain: string;
      titleItalic: string;
      body: string;
      points: string[];
    };
    storageLabel: string;
    storageProviders: string[];
    note: string;
  };
  waitlist: {
    eyebrow: string;
    titlePlain: string;
    titleItalic: string;
    body: string;
    emailPlaceholder: string;
    emailLabel: string;
    primary: string;
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
        'Private photo circles for partners, families, and close friends. No feed, no followers, no algorithm. Start in the official cloud or run your own.',
    },
    masthead: {
      availability: 'Private beta · 2026',
    },
    nav: {
      why: 'Idea',
      circles: 'Circles',
      hosting: 'Hosting',
      waitlist: 'Access',
    },
    hero: {
      eyebrow: 'Private photo circles',
      titleLine1: 'Photos for',
      titleItalic: 'your people,',
      titleLine2: 'no one else.',
      lede:
        'beisammen is a quiet home for the photos you take together — for partners, families, and the friends you actually text back. No feed. No followers. No algorithm.',
      primaryCta: 'Request early access',
      secondaryCta: 'How it works',
      metaItems: [
        'Invite-only circles',
        'Official cloud or your own',
        'Source-available',
      ],
      polaroids: [
        { caption: 'Sunday light', date: 'Mar 14' },
        { caption: 'Her first candle', date: 'Feb 03' },
        { caption: 'Portugal, briefly', date: 'Oct 22' },
      ],
    },
    promise: {
      eyebrow: 'The idea',
      titlePlain: 'Closer,',
      titleItalic: 'not louder.',
      body:
        'Social apps keep shouting. beisammen whispers — between the few people who actually matter to you, and nobody else.',
    },
    circles: {
      eyebrow: 'Circles',
      label: '01 · 02 · 03',
      titlePlain: 'A quiet place',
      titleItalic: 'for every quiet group.',
      cards: [
        {
          eyebrow: '01',
          size: 'Usually 2',
          name: 'Partner',
          title: { plain: 'Just the', italic: 'two of you.' },
          body: 'The in-jokes, the Polaroids, the Tuesday nights. A small, steady place for the life you share.',
          initials: ['N', 'L'],
        },
        {
          eyebrow: '02',
          size: '4–8 people',
          name: 'Family',
          title: { plain: 'The family chat,', italic: 'but warmer.' },
          body: 'First steps, last candles, ordinary Sundays. One calm feed for the people who were there from the start.',
          initials: ['M', 'P', 'A', 'E'],
        },
        {
          eyebrow: '03',
          size: 'A few',
          name: 'Close friends',
          title: { plain: 'The people', italic: 'you actually call.' },
          body: 'Trips, concerts, inside bits. Kept between the four of you — never borrowed by a feed.',
          initials: ['J', 'T', 'K', 'S'],
        },
      ],
    },
    principles: {
      eyebrow: 'Private by design',
      titlePlain: 'Trust,',
      titleItalic: 'quietly built in.',
      items: [
        {
          title: 'Invite-only',
          body: 'Every circle starts empty. You decide who walks in — no requests, no suggestions, no surprises.',
        },
        {
          title: 'No public feed',
          body: 'Nothing here is tuned for strangers, followers, or reach. There is no explore tab because there is nothing to explore.',
        },
        {
          title: 'Yours, really',
          body: 'Your photos live on your cloud — or on ours. Leave whenever, take them with you.',
        },
        {
          title: 'Source-available',
          body: 'Read the code. Audit the boundaries. Trust, verified — not just promised.',
        },
      ],
    },
    hosting: {
      eyebrow: 'Hosting',
      titlePlain: 'Start in the cloud.',
      titleItalic: 'Move to your own, anytime.',
      cloud: {
        tag: 'Option 01',
        badge: 'Recommended',
        titlePlain: 'Official',
        titleItalic: 'cloud.',
        body:
          'Sign in, make a circle, share something from tonight. We handle uploads, backups, and upgrades so nothing gets in the way of your photos.',
        points: [
          'Nothing to set up. Open the app and start.',
          'Encrypted in transit and at rest.',
          'New features land here first.',
        ],
      },
      self: {
        tag: 'Option 02',
        badge: 'Advanced',
        titlePlain: 'Self-',
        titleItalic: 'hosted.',
        body:
          'Prefer your own box? Run beisammen next to your own S3 bucket. Yours to own, break, and bring back — on your terms.',
        points: [
          'Runs on any S3-compatible storage.',
          'WorkOS handles sign-in for you.',
          'Private, noncommercial use is welcome.',
        ],
      },
      storageLabel: 'Pairs with',
      storageProviders: [
        'Amazon S3',
        'Backblaze B2',
        'Cloudflare R2',
        'Hetzner Object',
        'MinIO',
        'Wasabi',
      ],
      note:
        'Source-available is not OSI open source. Commercial hosting and resale need a separate agreement.',
    },
    waitlist: {
      eyebrow: 'Access',
      titlePlain: 'The door is',
      titleItalic: 'almost open.',
      body:
        'We are letting people in slowly, one circle at a time. Drop your email and we will quietly tap you when the next round unlocks.',
      emailPlaceholder: 'you@quiet.place',
      emailLabel: 'Email',
      primary: 'Request access',
      footnote: 'No newsletter. No noise. Just the ping when it is your turn.',
      success: 'You are on the list. We will tap you when the next round opens.',
      duplicate: 'You are already on the list. We have not forgotten.',
      error: 'Something went sideways. Try once more?',
      configError: 'The waitlist is not configured yet.',
    },
    footer: {
      tagline: 'Closer, not louder.',
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
        'Private Fotokreise für Partner, Familie und enge Freunde. Kein Feed, keine Follower, kein Algorithmus. Starte in der offiziellen Cloud oder hoste selbst.',
    },
    masthead: {
      availability: 'Private Beta · 2026',
    },
    nav: {
      why: 'Idee',
      circles: 'Kreise',
      hosting: 'Hosting',
      waitlist: 'Zugang',
    },
    hero: {
      eyebrow: 'Private Fotokreise',
      titleLine1: 'Fotos für',
      titleItalic: 'deine Menschen,',
      titleLine2: 'sonst niemand.',
      lede:
        'beisammen ist ein ruhiger Ort für die Fotos, die ihr zusammen macht — für Partner, Familie und die Freunde, denen du wirklich antwortest. Kein Feed. Keine Follower. Kein Algorithmus.',
      primaryCta: 'Früher Zugang',
      secondaryCta: 'So funktioniert es',
      metaItems: [
        'Nur auf Einladung',
        'Offizielle Cloud oder deine eigene',
        'Quelltext einsehbar',
      ],
      polaroids: [
        { caption: 'Sonntagslicht', date: '14. Mär' },
        { caption: 'Ihre erste Kerze', date: '03. Feb' },
        { caption: 'Portugal, kurz', date: '22. Okt' },
      ],
    },
    promise: {
      eyebrow: 'Die Idee',
      titlePlain: 'Näher.',
      titleItalic: 'Leiser.',
      body:
        'Social Apps schreien. beisammen flüstert — zwischen den wenigen Menschen, auf die es wirklich ankommt. Sonst niemand.',
    },
    circles: {
      eyebrow: 'Kreise',
      label: '01 · 02 · 03',
      titlePlain: 'Ein ruhiger Ort',
      titleItalic: 'für jede kleine Runde.',
      cards: [
        {
          eyebrow: '01',
          size: 'Meist 2',
          name: 'Partner',
          title: { plain: 'Nur', italic: 'ihr zwei.' },
          body: 'Die Insider-Witze, die Polaroids, die Dienstagabende. Ein kleiner, beständiger Ort für das, was ihr teilt.',
          initials: ['N', 'L'],
        },
        {
          eyebrow: '02',
          size: '4–8 Personen',
          name: 'Familie',
          title: { plain: 'Familie,', italic: 'wärmer gedacht.' },
          body: 'Erste Schritte, letzte Kerzen, normale Sonntage. Ein ruhiger Feed für die Menschen, die von Anfang an dabei sind.',
          initials: ['M', 'P', 'A', 'E'],
        },
        {
          eyebrow: '03',
          size: 'Eine Handvoll',
          name: 'Enge Freunde',
          title: { plain: 'Die Leute,', italic: 'die du wirklich anrufst.' },
          body: 'Reisen, Konzerte, Insider. Nur zwischen euch vieren — nie von einem Feed geliehen.',
          initials: ['J', 'T', 'K', 'S'],
        },
      ],
    },
    principles: {
      eyebrow: 'Privat entworfen',
      titlePlain: 'Vertrauen,',
      titleItalic: 'leise eingebaut.',
      items: [
        {
          title: 'Nur auf Einladung',
          body: 'Jeder Kreis beginnt leer. Du entscheidest, wer hereinkommt — keine Anfragen, keine Vorschläge, keine Überraschungen.',
        },
        {
          title: 'Kein öffentlicher Feed',
          body: 'Hier ist nichts für Fremde, Follower oder Reichweite optimiert. Es gibt keinen Entdecken-Tab, weil es nichts zu entdecken gibt.',
        },
        {
          title: 'Wirklich deins',
          body: 'Deine Fotos liegen auf deiner Cloud — oder auf unserer. Geh, wann du willst, und nimm sie mit.',
        },
        {
          title: 'Quelltext einsehbar',
          body: 'Lies den Code. Prüfe die Grenzen. Vertrauen belegbar, nicht versprochen.',
        },
      ],
    },
    hosting: {
      eyebrow: 'Hosting',
      titlePlain: 'Starte in der Cloud.',
      titleItalic: 'Wechsle später, wenn du willst.',
      cloud: {
        tag: 'Option 01',
        badge: 'Empfohlen',
        titlePlain: 'Offizielle',
        titleItalic: 'Cloud.',
        body:
          'Anmelden, Kreis erstellen, etwas vom heutigen Abend teilen. Uploads, Backups und Updates übernehmen wir — du teilst.',
        points: [
          'Nichts einzurichten. App auf, los geht\'s.',
          'Verschlüsselt beim Transport und im Speicher.',
          'Neue Funktionen landen zuerst hier.',
        ],
      },
      self: {
        tag: 'Option 02',
        badge: 'Fortgeschritten',
        titlePlain: 'Selbst',
        titleItalic: 'gehostet.',
        body:
          'Lieber auf deiner eigenen Kiste? Betreibe beisammen neben deinem S3-Bucket. Deine Infrastruktur, deine Regeln, dein Rhythmus.',
        points: [
          'Läuft auf jedem S3-kompatiblen Speicher.',
          'WorkOS übernimmt die Anmeldung.',
          'Private, nichtkommerzielle Nutzung willkommen.',
        ],
      },
      storageLabel: 'Passt zu',
      storageProviders: [
        'Amazon S3',
        'Backblaze B2',
        'Cloudflare R2',
        'Hetzner Object',
        'MinIO',
        'Wasabi',
      ],
      note:
        'Quelltext einsehbar heißt nicht OSI Open Source. Kommerzielles Hosting und Weiterverkauf brauchen eine separate Vereinbarung.',
    },
    waitlist: {
      eyebrow: 'Zugang',
      titlePlain: 'Die Tür geht',
      titleItalic: 'bald auf.',
      body:
        'Wir lassen schrittweise Menschen hinein, Kreis für Kreis. Lass deine E-Mail da — wir klopfen leise, wenn die nächste Runde frei ist.',
      emailPlaceholder: 'du@leiser.ort',
      emailLabel: 'E-Mail',
      primary: 'Zugang anfragen',
      footnote: 'Kein Newsletter. Kein Lärm. Nur das Klopfen, wenn du dran bist.',
      success: 'Du stehst auf der Liste. Wir klopfen, sobald neue Plätze frei werden.',
      duplicate: 'Du stehst schon auf der Liste. Wir haben dich nicht vergessen.',
      error: 'Da ist etwas schiefgegangen. Noch einmal versuchen?',
      configError: 'Die Warteliste ist noch nicht konfiguriert.',
    },
    footer: {
      tagline: 'Näher. Leiser.',
      source: 'Quelltext',
      license: 'Lizenz',
      privacy: 'Datenschutz',
      year: 'MMXXVI · beisammen',
    },
  },
};
