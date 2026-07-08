import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import translationFR from './locales/fr.json';
import translationAR from './locales/ar.json';
import translationEN from './locales/en.json';

const resources = {
  fr: { translation: translationFR },
  ar: { translation: translationAR },
  en: { translation: translationEN },
};

const savedLanguage = localStorage.getItem('language') || 'fr';

i18n.use(initReactI18next).init({
  resources,
  lng: savedLanguage,
  fallbackLng: 'fr',
  interpolation: {
    escapeValue: false,
  },
});

// Changer la direction du document pour l'arabe
i18n.on('languageChanged', (lng) => {
  document.documentElement.setAttribute('dir', lng === 'ar' ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('lang', lng);
  localStorage.setItem('language', lng);
});

export default i18n;
