import de from '../messages/de.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };
import { IntlMessageFormat } from 'intl-messageformat';

const catalogs = { de, en };
const cache = new Map();
export function recipientLocale(value) {
  return value === 'de' || value === 'en' ? value : process.env.ALERD_DEFAULT_LOCALE === 'de' ? 'de' : 'en';
}
export function hasLocalizedPrefix(content, key) {
  return ['de', 'en'].some(locale => content.startsWith(translate(locale, key)));
}
export function translate(locale, key, values = {}) {
  const language = locale === 'en' ? 'en' : 'de';
  const message = key.split('.').reduce((node, part) => node?.[part], catalogs[language]);
  if (typeof message !== 'string') throw new Error(`Missing translation: ${language}.${key}`);
  const cacheKey = `${language}:${key}`;
  let formatter = cache.get(cacheKey);
  if (!formatter) {
    formatter = new IntlMessageFormat(message, language, undefined, { ignoreTag: true });
    cache.set(cacheKey, formatter);
  }
  const localizedValues = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, typeof value === 'string' ? translateMessage(language, value) : value]));
  return String(formatter.format(localizedValues));
}

export function messageCode(key, values = {}) {
  return 'i18n:' + JSON.stringify([key, values]);
}
export class MessageError extends Error {
  constructor(key, values = {}) {
    super(translate('de', key, values));
    this.code = messageCode(key, values);
  }
}
export function errorMessage(error, fallback = 'unexpected_error') {
  if (error instanceof MessageError) return error.code;
  return error instanceof Error ? error.message : fallback;
}

export function translateMessage(locale, value) {
  if (typeof value !== 'string') return value;
  const text = value.startsWith('Error: i18n:') ? value.slice(7) : value;
  if (!text.startsWith('i18n:')) return value;
  try {
    const [key, values] = JSON.parse(text.slice(5));
    return translate(locale, key, values);
  } catch { return value; }
}
