// Metro cannot resolve dynamic imports, so each locale is mapped to its
// translation file with a static require.
const translations: Record<string, unknown> = {
  en: require('../_gt/en.json'),
};

export async function loadTranslations(locale: string): Promise<unknown> {
  return translations[locale] ?? {};
}
