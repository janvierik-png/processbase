export type LanguageCode = 'sk' | 'en';

export type TranslationDictionary = Record<LanguageCode, Record<string, string>>;
