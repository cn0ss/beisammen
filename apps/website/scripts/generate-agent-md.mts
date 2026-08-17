// Post-build step: write markdown representations of every static route to
// dist/_agent/<route>/index.md. The Worker serves them via content
// negotiation when a request carries `Accept: text/markdown`, so agents get
// clean text instead of the SPA shell (HTML stays the default for browsers).
//
// Landing content is generated from src/i18n/ui.ts and stays in sync
// automatically. Policy content mirrors src/pages/PrivacyPage.tsx and
// src/pages/DeleteAccountPage.tsx — keep those in sync by hand, like
// scripts/prerender-heads.mjs does for meta tags.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appStoreUrl,
  dict,
  licenseUrl,
  playStoreUrl,
  repoUrl,
  type Locale,
} from '../src/i18n/ui.ts';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const site = 'https://beisammen.app';

function landingMd(locale: Locale): string {
  const t = dict[locale];
  const de = locale === 'de';
  const prefix = de ? '' : '/en';

  const circles = t.moments.circles
    .map(
      (circle) =>
        `### ${circle.label} (${circle.members})\n\n` +
        `${de ? 'Beispielmoment' : 'Example moment'}: "${circle.caption}" (${circle.date})\n\n` +
        circle.facts.map((fact) => `- ${fact}`).join('\n'),
    )
    .join('\n\n');

  const promises = t.promises.items
    .map((item, index) => {
      const link = item.linkLabel ? ` ${item.linkLabel}: ${repoUrl}` : '';
      return `${index + 1}. **${item.title}** ${item.body}${link}`;
    })
    .join('\n');

  return `# beisammen

> ${t.meta.description}

${t.hero.title} ${t.hero.lede}

${t.hero.metaItems.map((item) => `- ${item}`).join('\n')}

## ${t.manifesto.eyebrow}

${t.manifesto.title} ${t.manifesto.body}

## ${t.moments.eyebrow}

${t.moments.title} ${t.moments.body}

${circles}

## ${t.promises.eyebrow}

${t.promises.title}

${promises}

## ${t.download.eyebrow}

${t.download.title} ${t.download.body} ${t.download.note}

- App Store: ${appStoreUrl}
- Google Play: ${playStoreUrl}

## Links

- ${t.footer.source}: ${repoUrl}
- ${t.footer.license}: ${licenseUrl}
- ${t.footer.privacy}: ${site}${prefix}/privacy/
- ${de ? 'Konto löschen' : 'Delete account'}: ${site}${prefix}/delete-account/
- ${de ? 'English version' : 'Deutsche Version'}: ${site}${de ? '/en/' : '/'}
`;
}

const privacyDe = `# Datenschutz · beisammen

Wie wir über eure Fotos denken. Kurz gesagt: Was du hochlädst, gehört deinen Kreisen. Diese Seite beschreibt, welche Daten wir anfassen, warum und wie lange.

Zuletzt aktualisiert: 16. August 2026

## Für wen das gilt

Diese Richtlinie betrifft die beisammen-App, diese Website und die gehosteten Backend-Dienste, die sie betreiben.

## Welche Daten wir verarbeiten

Je nach Nutzung können wir verarbeiten:

- Konto- und Anmeldedaten für die Authentifizierung über Clerk
- Profildaten wie Anzeigename, E-Mail und Profilbild
- Kreis-, Einladungs- und Mitgliedsdaten für private Gruppen
- Medien-Metadaten wie Dateinamen, Mime-Types, Zeitstempel und Upload-Status
- Mediendateien, die du hochlädst, gespeichert auf S3-kompatiblem Speicher
- Optionale Ortsdaten aus Foto-Metadaten oder Geräteberechtigungen
- Kommentare, Reaktionen und Aktivitätsdaten innerhalb deiner Kreise
- Kaufhistorie und Abonnementstatus; Zahlungsdaten selbst erhalten wir nicht
- Push-Token, Geräteplattform und App-Version für Benachrichtigungen
- Produktnutzung und Leistungsdaten wie App-Start- und Bildschirm-Ladezeiten, App- und Betriebssystemversion, Gerätemodell und Sprachregion
- Technische Logs zum Betrieb, zur Sicherheit und Fehlersuche

## Wofür wir sie nutzen

- um Nutzer zu authentifizieren und Sitzungen aktiv zu halten
- um private Kreise, Einladungen und geteilte Bibliotheken zu betreiben
- um geteilte Fotos und Videos hochzuladen, zu verarbeiten und anzuzeigen
- um Medien optional mit Ortsangaben zu versehen, wenn du es erlaubst
- um Abonnements bereitzustellen, wiederherzustellen und Kontingente durchzusetzen
- um gewünschte Push-Mitteilungen zuzustellen
- um Stabilität und Ladezeiten der App zu messen und zu verbessern
- um Sicherheit, Missbrauchsschutz und Betrieb zu gewährleisten

## Berechtigungen

Die App kann Zugriff auf Folgendes anfragen:

- Fotos und Videos, um Medien auszuwählen und zu speichern
- Kamera, um Fotos und Videos aufzunehmen
- Mikrofon, um Videos mit Ton aufzunehmen
- Standort, um Medien mit Ortsangaben anzureichern, wenn du es erlaubst

Optionale Berechtigungen kannst du verweigern. Einige Funktionen arbeiten dann möglicherweise nicht wie vorgesehen.

## Speicherung und Dienstleister

beisammen nutzt Convex als Anwendungs-Backend, Clerk für die Anmeldung, RevenueCat für Abonnements, Expo für Push-Mitteilungen und EAS Observe sowie Resend für betriebliche E-Mails. Käufe werden von Apple oder Google abgewickelt. Originale Mediendateien liegen auf dem für den jeweiligen Betrieb konfigurierten S3-kompatiblen Speicher. RevenueCat erhält eine interne beisammen-Nutzer-ID, Kauf- und Abonnementinformationen, aber keine vollständigen Zahlungskartendaten. EAS Observe erhält technische Leistungs- und Produktnutzungsdaten; private Circle-, Share-, Medien-, Einladungs- und Instanzkennungen werden vor dem Versand aus Navigationsdaten gefiltert.

## Speicherdauer

Konten-, Kreis- und Mediendaten bleiben erhalten, solange sie für den Betrieb nötig sind oder bis du sie beziehungsweise dein Konto löschst. Technische Betriebs- und Abrechnungsnachweise können so lange erhalten bleiben, wie dies für Sicherheit, Streitfälle oder gesetzliche Pflichten erforderlich ist. Bei eigenem Hosting bestimmt der Betreiber die Speicherdauer.

## Deine Möglichkeiten

- du entscheidest, ob du Medien hochlädst
- du entscheidest, welche optionalen Berechtigungen du erteilst
- du kannst dein Konto und die zugehörigen Inhalte in der App unter Einstellungen → Konto → „Konto und Daten löschen" dauerhaft löschen

Die vollständigen Schritte und eine Möglichkeit zur Löschanfrage ohne App-Zugriff findest du unter ${site}/delete-account/.

Das Löschen des beisammen-Kontos beendet kein Abonnement bei Apple oder Google. Ein aktives Abonnement kannst du zuvor über „Abo verwalten" in der App oder direkt in deinem Store-Konto kündigen.

## Kontakt

Für Support- und Datenschutzanfragen zur offiziellen beisammen-Installation erreichst du Niklas Schmidt unter niklas@niklasschmidt.dev.
`;

const privacyEn = `# Privacy policy · beisammen

How we think about your photos. The short version: what you upload belongs to your circles. This page describes the data we touch, why, and for how long.

Last updated: August 16, 2026

## Who this applies to

This policy covers the beisammen mobile app, this website, and the hosted backend services used to operate them.

## Data we process

Depending on how you use the product, we may process:

- account and sign-in data needed for authentication via Clerk
- profile data such as your display name, email, and profile image
- circle, invite, and membership data used to manage private groups
- media metadata such as filenames, mime types, timestamps, and upload state
- media files you choose to upload, stored on the configured S3-compatible storage
- optional location data derived from embedded photo metadata or device permission flows
- comments, reactions, and activity inside your circles
- purchase history and subscription status; we do not receive your payment-card details
- push token, device platform, and app version used for notifications
- product interaction and performance data such as app start and screen loading times, app and operating-system version, device model, and locale
- basic technical logs needed to operate, secure, and debug the service

## How we use it

- to authenticate users and keep sessions active
- to create and operate private circles, invites, and shared libraries
- to upload, process, and display shared photos and videos
- to attach optional place labels to media when location information is available
- to provide and restore subscriptions and enforce plan limits
- to deliver push notifications you enable
- to measure and improve app stability and loading performance
- to maintain security, prevent abuse, and troubleshoot service problems

## Permissions

The mobile app may request access to:

- photos and videos, to select and save media
- camera, to capture photos and videos
- microphone, to record video with audio
- location, to enrich media with place information when you allow it

You can deny optional permissions. Some features may no longer work as intended.

## Storage and processors

beisammen uses Convex as its application backend, Clerk for authentication, RevenueCat for subscriptions, Expo for push notifications and EAS Observe, and Resend for operational emails. Purchases are processed by Apple or Google. Original media files live on S3-compatible storage configured for the active deployment. RevenueCat receives an internal beisammen user ID plus purchase and subscription information, but not full payment-card details. EAS Observe receives technical performance and product-interaction data; private circle, share, media, invite, and instance identifiers are filtered from navigation telemetry before dispatch.

## Retention

We retain account, circle, and media records for as long as they are needed to operate the service, or until you delete them or your account. Technical operations and transaction records may be retained as needed for security, disputes, or legal obligations. Operators of self-hosted deployments determine their own retention periods.

## Your choices

- you can choose whether to upload media
- you can choose whether to grant optional device permissions
- you can permanently delete your account and associated content in Settings → Account → "Delete account and data" in the app

Full instructions and an option to request deletion without app access are available at ${site}/en/delete-account/.

Deleting your beisammen account does not cancel an Apple or Google subscription. Cancel an active subscription first through "Manage subscription" in the app or directly in your store account.

## Contact

For support and privacy inquiries related to the official beisammen deployment, contact Niklas Schmidt at niklas@niklasschmidt.dev.
`;

const deleteDe = `# Konto löschen · beisammen

Deine Daten. Deine Entscheidung. Du kannst dein beisammen-Konto und die damit verbundenen Daten jederzeit dauerhaft löschen.

## Direkt in der App

1. Öffne beisammen und melde dich an.
2. Öffne Einstellungen → Konto.
3. Tippe auf „Konto und Daten löschen" und bestätige die Löschung.

## Ohne Zugriff auf die App

Sende von der E-Mail-Adresse deines beisammen-Kontos eine Nachricht mit dem Betreff „beisammen-Konto löschen" an niklas@niklasschmidt.dev. Wir können zusätzliche Angaben anfordern, um deine Identität zu bestätigen.

## Was gelöscht wird

Gelöscht werden dein Anmeldekonto und Profil, Mitgliedschaften, Einladungen, Beiträge, Kommentare, Reaktionen, Benachrichtigungsdaten sowie hochgeladene Fotos und Videos. Circles, die du besitzt, werden einschließlich ihrer Inhalte gelöscht. Die Löschung kann nicht rückgängig gemacht werden.

## Was begrenzt aufbewahrt werden kann

Technische Sicherheits-, Transaktions- und Abrechnungsnachweise können so lange aufbewahrt werden, wie dies für gesetzliche Pflichten, Betrugsprävention oder die Klärung von Streitfällen erforderlich ist. Sie werden nicht für Werbung verwendet.

## Abonnements

Die Kontolöschung beendet kein Abonnement bei Apple oder Google. Kündige ein aktives Abonnement vorher über „Abo verwalten" in der App oder direkt in deinem Store-Konto.

Datenschutzerklärung: ${site}/privacy/
`;

const deleteEn = `# Delete account · beisammen

Your data. Your decision. You can permanently delete your beisammen account and its associated data at any time.

## Delete inside the app

1. Open beisammen and sign in.
2. Open Settings → Account.
3. Tap "Delete account and data" and confirm.

## Delete without access to the app

From the email address attached to your beisammen account, send a message with the subject "Delete beisammen account" to niklas@niklasschmidt.dev. We may request additional information to verify your identity.

## Data that is deleted

We delete your sign-in account and profile, memberships, invitations, posts, comments, reactions, notification data, and uploaded photos and videos. Circles you own are deleted together with their content. Deletion cannot be undone.

## Limited retention

Technical security, transaction, and billing records may be retained only as long as required for legal obligations, fraud prevention, or dispute resolution. They are not used for advertising.

## Subscriptions

Deleting your account does not cancel an Apple or Google subscription. Cancel an active subscription first through "Manage subscription" in the app or directly in your store account.

Privacy policy: ${site}/en/privacy/
`;

const shareMd = `# Beisammen ansehen

Diese Adresse zeigt eine private, tokengeschützte Ansicht geteilter Momente aus einem beisammen-Kreis. Der Inhalt wird erst im Browser mit dem Token aus dem Link geladen und ist nicht öffentlich zugänglich.

Mehr über beisammen: ${site}/
`;

const files: Array<[string, string]> = [
  ['index.md', landingMd('de')],
  ['en/index.md', landingMd('en')],
  ['privacy/index.md', privacyDe],
  ['en/privacy/index.md', privacyEn],
  ['delete-account/index.md', deleteDe],
  ['en/delete-account/index.md', deleteEn],
  ['share/index.md', shareMd],
];

for (const [path, content] of files) {
  const target = join(dist, '_agent', path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  console.log(`agent markdown: /_agent/${path}`);
}
