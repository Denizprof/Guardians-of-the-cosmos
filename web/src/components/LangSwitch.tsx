import { useEffect, useState } from 'react';
import { getLang, onLangChange, setLang, type Lang } from '../i18n';

/** EN / TR switch for the top bar. Its own labels are never translated (data-no-i18n). */
export default function LangSwitch() {
  const [lang, setL] = useState<Lang>(getLang());
  useEffect(() => onLangChange(setL), []);
  return (
    <div className="lang-switch" role="group" aria-label={lang === 'tr' ? 'Dil' : 'Language'} data-no-i18n>
      {(['en', 'tr'] as const).map((l) => (
        <button
          key={l}
          type="button"
          className="lang-btn"
          aria-pressed={lang === l}
          lang={l}
          title={l === 'en' ? 'English' : 'Türkçe'}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
