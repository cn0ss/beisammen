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

type Dictionary = {
  htmlLang: string;
  meta: {
    title: string;
    description: string;
  };
  nav: {
    about: string;
    circles: string;
    storage: string;
    principles: string;
    switchLang: string;
  };
  hero: {
    eyebrow: string;
    title: string[];
    titleEm: number;
    lede: string;
    primaryCta: string;
    secondaryCta: string;
    note: string;
  };
  polaroids: Array<{ caption: string; date: string; tone: string }>;
  manifesto: {
    label: string;
    title: string;
    body: string[];
  };
  circles: {
    label: string;
    title: string;
    intro: string;
    items: Array<{ name: string; count: string; line: string }>;
  };
  storage: {
    label: string;
    title: string;
    intro: string;
    bullets: Array<{ k: string; v: string }>;
  };
  principles: {
    label: string;
    title: string;
    items: Array<{ n: string; t: string; b: string }>;
  };
  cta: {
    label: string;
    title: string;
    body: string;
    emailPlaceholder: string;
    primary: string;
    secondary: string;
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
    colophon: string;
    year: string;
  };
};

export const dict: Record<Locale, Dictionary> = {
  en: {
    htmlLang: 'en',
    meta: {
      title: 'beisammen — a photo app for the people you keep close',
      description:
        'beisammen is a private photo and video app for small circles — partners, families, close friends. Bring your own storage. No feeds, no followers, no strangers.',
    },
    nav: {
      about: 'What it is',
      circles: 'Circles',
      storage: 'Your storage',
      principles: 'Principles',
      switchLang: 'Deutsch',
    },
    hero: {
      eyebrow: 'beisammen · noun · German · being together',
      title: ['For moments', 'that stay', 'between us'],
      titleEm: 2,
      lede:
        'A photo and video app for the handful of people you actually want to send things to. Not a network. Not a feed. A small, quiet place.',
      primaryCta: 'Join the early circle',
      secondaryCta: 'Read the principles',
      note: 'Coming to iOS and Android — self-hostable by design.',
    },
    polaroids: [
      { caption: 'Kitchen floor, 2am', date: '09 · Feb', tone: 'warm' },
      { caption: 'First walk of the year', date: '02 · Jan', tone: 'sage' },
      { caption: 'Grandma’s Sunday', date: '17 · Mar', tone: 'rose' },
      { caption: 'Nothing in particular', date: '24 · Apr', tone: 'ink' },
    ],
    manifesto: {
      label: '01 — What it is',
      title:
        'A small, private place for the photos that don’t belong on the internet.',
      body: [
        'Most of the pictures on your phone are not for everyone. They are for three people, or five, or one. They are for the people in the photo and the people who love them.',
        'beisammen is built for that audience. Share with a named circle. Keep the originals on storage you control. Leave the rest of the internet out of it.',
      ],
    },
    circles: {
      label: '02 — Circles',
      title: 'Small groups, named out loud.',
      intro:
        'A circle is a private shared library for a specific set of people. Join by invitation. No discovery, no suggestions, no metrics.',
      items: [
        {
          name: 'Partners',
          count: 'usually 2',
          line: 'Every picture, shared by default.',
        },
        {
          name: 'Family',
          count: '4 – 12',
          line: 'Birthdays, kitchens, back-of-the-car photos.',
        },
        {
          name: 'Close friends',
          count: '3 – 20',
          line: 'The chat before, the album after.',
        },
      ],
    },
    storage: {
      label: '03 — Your storage',
      title: 'Your originals live where you say they live.',
      intro:
        'beisammen is a bring-your-own-storage app. We hold the metadata, the shared views, and the invites. The full-resolution files live on an S3-compatible bucket you choose — your own, your family’s, or an official one.',
      bullets: [
        { k: 'S3-compatible', v: 'AWS, Backblaze, Wasabi, MinIO, Hetzner, Garage' },
        { k: 'Self-hostable', v: 'Run the whole thing on your own hardware' },
        { k: 'Leaveable', v: 'Take your originals and go, at any time' },
        { k: 'Source available', v: 'PolyForm Noncommercial — readable, private' },
      ],
    },
    principles: {
      label: '04 — Principles',
      title: 'Four quiet commitments.',
      items: [
        {
          n: 'i.',
          t: 'No feed',
          b: 'There is no algorithm deciding what you see. You see what your circles shared, in order.',
        },
        {
          n: 'ii.',
          t: 'No strangers',
          b: 'Every person in beisammen is someone you already named. That is the whole social graph.',
        },
        {
          n: 'iii.',
          t: 'No lock-in',
          b: 'Your originals stay in storage you control. Walk away with them whenever you want.',
        },
        {
          n: 'iv.',
          t: 'No theatre',
          b: 'No reactions inflating into numbers. No streaks, no notifications chasing you back.',
        },
      ],
    },
    cta: {
      label: 'Coming soon',
      title: 'If this sounds like the app your group chat has been asking for, let us know.',
      body:
        'We are building slowly, with a small group of early circles. Drop your email if you want to be one of them.',
      emailPlaceholder: 'you@somewhere.email',
      primary: 'Join the waitlist',
      secondary: 'Read the docs',
      success: 'You are on the list. We will reach out when early access opens.',
      duplicate: 'This address is already on the waitlist.',
      error: 'That did not work. Please try again in a moment.',
      configError: 'The waitlist is not configured yet.',
    },
    footer: {
      tagline: 'Made to be used, quietly.',
      source: 'Source',
      license: 'License',
      privacy: 'Privacy',
      colophon: 'Colophon',
      year: '© 2026 beisammen',
    },
  },
  de: {
    htmlLang: 'de',
    meta: {
      title: 'beisammen — eine Foto-App für die Menschen, die dir nah sind',
      description:
        'beisammen ist eine private Foto- und Video-App für kleine Kreise — Partner, Familien, enge Freunde. Dein eigener Speicher. Kein Feed, keine Follower, keine Fremden.',
    },
    nav: {
      about: 'Worum es geht',
      circles: 'Kreise',
      storage: 'Dein Speicher',
      principles: 'Prinzipien',
      switchLang: 'English',
    },
    hero: {
      eyebrow: 'beisammen · Nomen · Deutsch · zusammen sein',
      title: ['Für Momente,', 'die zwischen', 'uns bleiben'],
      titleEm: 1,
      lede:
        'Eine Foto- und Video-App für die Handvoll Menschen, denen du wirklich etwas schicken willst. Kein Netzwerk. Kein Feed. Ein kleiner, ruhiger Ort.',
      primaryCta: 'Dem frühen Kreis beitreten',
      secondaryCta: 'Die Prinzipien lesen',
      note: 'Kommt für iOS und Android — von Grund auf selbst hostbar.',
    },
    polaroids: [
      { caption: 'Küchenboden, 2 Uhr', date: '09 · Feb', tone: 'warm' },
      { caption: 'Erster Spaziergang', date: '02 · Jan', tone: 'sage' },
      { caption: 'Omas Sonntag', date: '17 · Mär', tone: 'rose' },
      { caption: 'Nichts Besonderes', date: '24 · Apr', tone: 'ink' },
    ],
    manifesto: {
      label: '01 — Worum es geht',
      title:
        'Ein kleiner, privater Ort für die Bilder, die nicht ins Internet gehören.',
      body: [
        'Die meisten Fotos auf deinem Telefon sind nicht für alle da. Sie sind für drei Menschen, oder fünf, oder einen. Für die Menschen im Bild und für die, die sie lieben.',
        'beisammen ist für genau dieses Publikum gebaut. Teile mit einem benannten Kreis. Halte die Originale auf Speicher, den du kontrollierst. Lass den Rest des Internets draußen.',
      ],
    },
    circles: {
      label: '02 — Kreise',
      title: 'Kleine Gruppen, mit Namen.',
      intro:
        'Ein Kreis ist eine private, gemeinsame Bibliothek für eine bestimmte Gruppe. Beitritt per Einladung. Keine Vorschläge, keine Entdeckung, keine Kennzahlen.',
      items: [
        {
          name: 'Partner',
          count: 'meist 2',
          line: 'Jedes Bild, standardmäßig geteilt.',
        },
        {
          name: 'Familie',
          count: '4 – 12',
          line: 'Geburtstage, Küchen, Rückbank-Fotos.',
        },
        {
          name: 'Enge Freunde',
          count: '3 – 20',
          line: 'Der Chat davor, das Album danach.',
        },
      ],
    },
    storage: {
      label: '03 — Dein Speicher',
      title: 'Deine Originale liegen dort, wo du sagst.',
      intro:
        'beisammen ist eine Bring-your-own-Storage-App. Wir halten die Metadaten, die geteilten Ansichten und die Einladungen. Die Originale in voller Auflösung liegen in einem S3-kompatiblen Bucket deiner Wahl — deinem eigenen, dem deiner Familie oder einem offiziellen.',
      bullets: [
        { k: 'S3-kompatibel', v: 'AWS, Backblaze, Wasabi, MinIO, Hetzner, Garage' },
        { k: 'Selbst hostbar', v: 'Alles auf deiner eigenen Hardware betreiben' },
        { k: 'Verlassbar', v: 'Nimm deine Originale mit, jederzeit' },
        { k: 'Quelltext offen', v: 'PolyForm Noncommercial — lesbar, privat' },
      ],
    },
    principles: {
      label: '04 — Prinzipien',
      title: 'Vier ruhige Versprechen.',
      items: [
        {
          n: 'i.',
          t: 'Kein Feed',
          b: 'Kein Algorithmus entscheidet, was du siehst. Du siehst, was deine Kreise geteilt haben, der Reihe nach.',
        },
        {
          n: 'ii.',
          t: 'Keine Fremden',
          b: 'Jede Person in beisammen ist jemand, den du selbst benannt hast. Das ist der ganze Social Graph.',
        },
        {
          n: 'iii.',
          t: 'Kein Lock-in',
          b: 'Deine Originale bleiben auf Speicher, den du kontrollierst. Geh jederzeit damit.',
        },
        {
          n: 'iv.',
          t: 'Kein Theater',
          b: 'Keine Reaktionen, die zu Zahlen anschwellen. Keine Streaks, keine Benachrichtigungen, die dich zurückjagen.',
        },
      ],
    },
    cta: {
      label: 'Bald',
      title: 'Wenn das nach der App klingt, nach der euer Gruppenchat ruft — schreib uns.',
      body:
        'Wir bauen langsam, mit einer kleinen Gruppe früher Kreise. Lass uns deine E-Mail da, wenn du einer davon sein willst.',
      emailPlaceholder: 'du@beispiel.de',
      primary: 'Auf die Warteliste',
      secondary: 'Zur Dokumentation',
      success: 'Du bist auf der Liste. Wir melden uns, wenn der frühe Zugang startet.',
      duplicate: 'Diese Adresse steht bereits auf der Warteliste.',
      error: 'Das hat nicht geklappt. Versuch es bitte gleich noch einmal.',
      configError: 'Die Warteliste ist noch nicht konfiguriert.',
    },
    footer: {
      tagline: 'Gebaut, um leise benutzt zu werden.',
      source: 'Quelltext',
      license: 'Lizenz',
      privacy: 'Datenschutz',
      colophon: 'Kolophon',
      year: '© 2026 beisammen',
    },
  },
};
