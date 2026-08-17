import { Link } from 'react-router';
import { localePath, type Locale } from '@/i18n/ui';
import { usePageMeta } from '@/lib/meta';
import { PolicyShell } from './PolicyShell';

function GermanContent() {
  return (
    <>
      <h2>Für wen das gilt</h2>
      <p>
        Diese Richtlinie betrifft die beisammen-App, diese Website und die gehosteten
        Backend-Dienste, die sie betreiben.
      </p>

      <h2>Welche Daten wir verarbeiten</h2>
      <p>Je nach Nutzung können wir verarbeiten:</p>
      <ul>
        <li>Konto- und Anmeldedaten für die Authentifizierung über Clerk</li>
        <li>Profildaten wie Anzeigename, E-Mail und Profilbild</li>
        <li>Kreis-, Einladungs- und Mitgliedsdaten für private Gruppen</li>
        <li>Medien-Metadaten wie Dateinamen, Mime-Types, Zeitstempel und Upload-Status</li>
        <li>Mediendateien, die du hochlädst, gespeichert auf S3-kompatiblem Speicher</li>
        <li>Optionale Ortsdaten aus Foto-Metadaten oder Geräteberechtigungen</li>
        <li>Kommentare, Reaktionen und Aktivitätsdaten innerhalb deiner Kreise</li>
        <li>Kaufhistorie und Abonnementstatus; Zahlungsdaten selbst erhalten wir nicht</li>
        <li>Push-Token, Geräteplattform und App-Version für Benachrichtigungen</li>
        <li>
          Produktnutzung und Leistungsdaten wie App-Start- und Bildschirm-Ladezeiten, App- und
          Betriebssystemversion, Gerätemodell und Sprachregion
        </li>
        <li>Warteliste-Einträge, die du über die Website sendest</li>
        <li>Technische Logs zum Betrieb, zur Sicherheit und Fehlersuche</li>
      </ul>

      <h2>Wofür wir sie nutzen</h2>
      <ul>
        <li>um Nutzer zu authentifizieren und Sitzungen aktiv zu halten</li>
        <li>um private Kreise, Einladungen und geteilte Bibliotheken zu betreiben</li>
        <li>um geteilte Fotos und Videos hochzuladen, zu verarbeiten und anzuzeigen</li>
        <li>um Medien optional mit Ortsangaben zu versehen, wenn du es erlaubst</li>
        <li>um Abonnements bereitzustellen, wiederherzustellen und Kontingente durchzusetzen</li>
        <li>um gewünschte Push-Mitteilungen zuzustellen</li>
        <li>um Stabilität und Ladezeiten der App zu messen und zu verbessern</li>
        <li>um auf Warteliste-Anfragen und Zugangswünsche zu antworten</li>
        <li>um Sicherheit, Missbrauchsschutz und Betrieb zu gewährleisten</li>
      </ul>

      <h2>Berechtigungen</h2>
      <p>Die App kann Zugriff auf Folgendes anfragen:</p>
      <ul>
        <li>Fotos und Videos, um Medien auszuwählen und zu speichern</li>
        <li>Kamera, um Fotos und Videos aufzunehmen</li>
        <li>Mikrofon, um Videos mit Ton aufzunehmen</li>
        <li>Standort, um Medien mit Ortsangaben anzureichern, wenn du es erlaubst</li>
      </ul>
      <p>
        Optionale Berechtigungen kannst du verweigern — einige Funktionen arbeiten dann
        möglicherweise nicht wie vorgesehen.
      </p>

      <h2>Speicherung und Dienstleister</h2>
      <p>
        beisammen nutzt Convex als Anwendungs-Backend, Clerk für die Anmeldung, RevenueCat für
        Abonnements, Expo für Push-Mitteilungen und EAS Observe sowie Resend für betriebliche
        E-Mails. Käufe werden von Apple oder Google abgewickelt. Originale Mediendateien liegen
        auf dem für den jeweiligen Betrieb konfigurierten S3-kompatiblen Speicher. RevenueCat
        erhält eine interne beisammen-Nutzer-ID, Kauf- und Abonnementinformationen, aber keine
        vollständigen Zahlungskartendaten. EAS Observe erhält technische Leistungs- und
        Produktnutzungsdaten; private Circle-, Share-, Medien-, Einladungs- und Instanzkennungen
        werden vor dem Versand aus Navigationsdaten gefiltert.
      </p>

      <h2>Speicherdauer</h2>
      <p>
        Konten-, Kreis- und Mediendaten bleiben erhalten, solange sie für den Betrieb nötig sind
        oder bis du sie beziehungsweise dein Konto löschst. Technische Betriebs- und
        Abrechnungsnachweise können so lange erhalten bleiben, wie dies für Sicherheit,
        Streitfälle oder gesetzliche Pflichten erforderlich ist. Bei eigenem Hosting bestimmt der
        Betreiber die Speicherdauer.
      </p>

      <h2>Deine Möglichkeiten</h2>
      <ul>
        <li>du entscheidest, ob du Medien hochlädst</li>
        <li>du entscheidest, welche optionalen Berechtigungen du erteilst</li>
        <li>du kannst die Warteliste verlassen, indem du die Betreiber der Installation kontaktierst</li>
        <li>
          du kannst dein Konto und die zugehörigen Inhalte in der App unter Einstellungen → Konto
          → „Konto und Daten löschen“ dauerhaft löschen
        </li>
      </ul>
      <p>
        Die vollständigen Schritte und eine Möglichkeit zur Löschanfrage ohne App-Zugriff findest
        du unter <Link to="/delete-account/">Konto löschen</Link>.
      </p>
      <p>
        Das Löschen des beisammen-Kontos beendet kein Abonnement bei Apple oder Google. Ein
        aktives Abonnement kannst du zuvor über „Abo verwalten“ in der App oder direkt in deinem
        Store-Konto kündigen.
      </p>

      <h2>Kontakt</h2>
      <p>
        Für Support- und Datenschutzanfragen zur offiziellen beisammen-Installation erreichst du
        Niklas Schmidt unter{' '}
        <a href="mailto:niklas@niklasschmidt.dev">niklas@niklasschmidt.dev</a>.
      </p>
    </>
  );
}

function EnglishContent() {
  return (
    <>
      <h2>Who this applies to</h2>
      <p>
        This policy covers the beisammen mobile app, this website, and the hosted backend
        services used to operate them.
      </p>

      <h2>Data we process</h2>
      <p>Depending on how you use the product, we may process:</p>
      <ul>
        <li>account and sign-in data needed for authentication via Clerk</li>
        <li>profile data such as your display name, email, and profile image</li>
        <li>circle, invite, and membership data used to manage private groups</li>
        <li>media metadata such as filenames, mime types, timestamps, and upload state</li>
        <li>media files you choose to upload, stored on the configured S3-compatible storage</li>
        <li>optional location data derived from embedded photo metadata or device permission flows</li>
        <li>comments, reactions, and activity inside your circles</li>
        <li>purchase history and subscription status; we do not receive your payment-card details</li>
        <li>push token, device platform, and app version used for notifications</li>
        <li>
          product interaction and performance data such as app start and screen loading times,
          app and operating-system version, device model, and locale
        </li>
        <li>waitlist submissions you send through the website</li>
        <li>basic technical logs needed to operate, secure, and debug the service</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>to authenticate users and keep sessions active</li>
        <li>to create and operate private circles, invites, and shared libraries</li>
        <li>to upload, process, and display shared photos and videos</li>
        <li>to attach optional place labels to media when location information is available</li>
        <li>to provide and restore subscriptions and enforce plan limits</li>
        <li>to deliver push notifications you enable</li>
        <li>to measure and improve app stability and loading performance</li>
        <li>to respond to waitlist requests and product access inquiries</li>
        <li>to maintain security, prevent abuse, and troubleshoot service problems</li>
      </ul>

      <h2>Permissions</h2>
      <p>The mobile app may request access to:</p>
      <ul>
        <li>photos and videos, to select and save media</li>
        <li>camera, to capture photos and videos</li>
        <li>microphone, to record video with audio</li>
        <li>location, to enrich media with place information when you allow it</li>
      </ul>
      <p>You can deny optional permissions — some features may no longer work as intended.</p>

      <h2>Storage and processors</h2>
      <p>
        beisammen uses Convex as its application backend, Clerk for authentication, RevenueCat
        for subscriptions, Expo for push notifications and EAS Observe, and Resend for
        operational emails. Purchases are processed by Apple or Google. Original media files live
        on S3-compatible storage configured for the active deployment. RevenueCat receives an
        internal beisammen user ID plus purchase and subscription information, but not full
        payment-card details. EAS Observe receives technical performance and product-interaction
        data; private circle, share, media, invite, and instance identifiers are filtered from
        navigation telemetry before dispatch.
      </p>

      <h2>Retention</h2>
      <p>
        We retain account, circle, and media records for as long as they are needed to operate
        the service, or until you delete them or your account. Technical operations and
        transaction records may be retained as needed for security, disputes, or legal
        obligations. Operators of self-hosted deployments determine their own retention periods.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>you can choose whether to upload media</li>
        <li>you can choose whether to grant optional device permissions</li>
        <li>you can leave the waitlist by contacting the operator of the deployment</li>
        <li>
          you can permanently delete your account and associated content in Settings → Account →
          “Delete account and data” in the app
        </li>
      </ul>
      <p>
        Full instructions and an option to request deletion without app access are available on
        the <Link to="/en/delete-account/">Delete account</Link> page.
      </p>
      <p>
        Deleting your beisammen account does not cancel an Apple or Google subscription. Cancel
        an active subscription first through “Manage subscription” in the app or directly in your
        store account.
      </p>

      <h2>Contact</h2>
      <p>
        For support and privacy inquiries related to the official beisammen deployment, contact
        Niklas Schmidt at <a href="mailto:niklas@niklasschmidt.dev">niklas@niklasschmidt.dev</a>.
      </p>
    </>
  );
}

export function PrivacyPage({ locale }: { locale: Locale }) {
  const de = locale === 'de';

  usePageMeta({
    lang: locale,
    title: de ? 'Datenschutz — beisammen' : 'Privacy policy — beisammen',
    description: de
      ? 'Wie beisammen mit euren Fotos und Daten umgeht.'
      : 'How beisammen handles your photos and data.',
  });

  return (
    <PolicyShell
      locale={locale}
      page="privacy"
      eyebrow={de ? 'Datenschutz' : 'Privacy policy'}
      titlePlain={de ? 'Wie wir über' : 'How we think'}
      titleItalic={de ? 'eure Fotos denken.' : 'about your photos.'}
      lede={
        de
          ? 'Kurz gesagt: Was du hochlädst, gehört deinen Kreisen. Diese Seite beschreibt, welche Daten wir anfassen, warum und wie lange.'
          : 'The short version: what you upload belongs to your circles. This page describes the data we touch, why, and for how long.'
      }
      meta={de ? 'Zuletzt aktualisiert — 16. August 2026' : 'Last updated — August 16, 2026'}
      backHref={localePath(locale, '')}
      backLabel={de ? 'Zurück zu beisammen' : 'Back to beisammen'}
    >
      {de ? <GermanContent /> : <EnglishContent />}
    </PolicyShell>
  );
}
