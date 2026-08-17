import { localePath, type Locale } from '@/i18n/ui';
import { usePageMeta } from '@/lib/meta';
import { PolicyShell } from './PolicyShell';

function GermanContent() {
  return (
    <>
      <h2>Direkt in der App</h2>
      <ol>
        <li>Öffne beisammen und melde dich an.</li>
        <li>Öffne Einstellungen → Konto.</li>
        <li>Tippe auf „Konto und Daten löschen“ und bestätige die Löschung.</li>
      </ol>

      <h2>Ohne Zugriff auf die App</h2>
      <p>
        Sende von der E-Mail-Adresse deines beisammen-Kontos eine Nachricht mit dem Betreff
        „beisammen-Konto löschen“ an{' '}
        <a href="mailto:niklas@niklasschmidt.dev?subject=beisammen-Konto%20l%C3%B6schen">
          niklas@niklasschmidt.dev
        </a>
        . Wir können zusätzliche Angaben anfordern, um deine Identität zu bestätigen.
      </p>

      <h2>Was gelöscht wird</h2>
      <p>
        Gelöscht werden dein Anmeldekonto und Profil, Mitgliedschaften, Einladungen, Beiträge,
        Kommentare, Reaktionen, Benachrichtigungsdaten sowie hochgeladene Fotos und Videos.
        Circles, die du besitzt, werden einschließlich ihrer Inhalte gelöscht. Die Löschung kann
        nicht rückgängig gemacht werden.
      </p>

      <h2>Was begrenzt aufbewahrt werden kann</h2>
      <p>
        Technische Sicherheits-, Transaktions- und Abrechnungsnachweise können so lange
        aufbewahrt werden, wie dies für gesetzliche Pflichten, Betrugsprävention oder die Klärung
        von Streitfällen erforderlich ist. Sie werden nicht für Werbung verwendet.
      </p>

      <h2>Abonnements</h2>
      <p>
        Die Kontolöschung beendet kein Abonnement bei Apple oder Google. Kündige ein aktives
        Abonnement vorher über „Abo verwalten“ in der App oder direkt in deinem Store-Konto.
      </p>
    </>
  );
}

function EnglishContent() {
  return (
    <>
      <h2>Delete inside the app</h2>
      <ol>
        <li>Open beisammen and sign in.</li>
        <li>Open Settings → Account.</li>
        <li>Tap “Delete account and data” and confirm.</li>
      </ol>

      <h2>Delete without access to the app</h2>
      <p>
        From the email address attached to your beisammen account, send a message with the
        subject “Delete beisammen account” to{' '}
        <a href="mailto:niklas@niklasschmidt.dev?subject=Delete%20beisammen%20account">
          niklas@niklasschmidt.dev
        </a>
        . We may request additional information to verify your identity.
      </p>

      <h2>Data that is deleted</h2>
      <p>
        We delete your sign-in account and profile, memberships, invitations, posts, comments,
        reactions, notification data, and uploaded photos and videos. Circles you own are
        deleted together with their content. Deletion cannot be undone.
      </p>

      <h2>Limited retention</h2>
      <p>
        Technical security, transaction, and billing records may be retained only as long as
        required for legal obligations, fraud prevention, or dispute resolution. They are not
        used for advertising.
      </p>

      <h2>Subscriptions</h2>
      <p>
        Deleting your account does not cancel an Apple or Google subscription. Cancel an active
        subscription first through “Manage subscription” in the app or directly in your store
        account.
      </p>
    </>
  );
}

export function DeleteAccountPage({ locale }: { locale: Locale }) {
  const de = locale === 'de';

  usePageMeta({
    lang: locale,
    title: de ? 'Konto löschen · beisammen' : 'Delete account · beisammen',
    description: de
      ? 'So löschst du dein beisammen-Konto und die zugehörigen Daten dauerhaft.'
      : 'How to permanently delete your beisammen account and its data.',
  });

  return (
    <PolicyShell
      locale={locale}
      page="delete-account"
      eyebrow={de ? 'Konto löschen' : 'Delete account'}
      title={de ? 'Deine Daten. Deine Entscheidung.' : 'Your data. Your decision.'}
      lede={
        de
          ? 'Du kannst dein beisammen-Konto und die damit verbundenen Daten jederzeit dauerhaft löschen.'
          : 'You can permanently delete your beisammen account and its associated data at any time.'
      }
      backHref={localePath(locale, 'privacy')}
      backLabel={de ? 'Zur Datenschutzerklärung' : 'Privacy policy'}
    >
      {de ? <GermanContent /> : <EnglishContent />}
    </PolicyShell>
  );
}
