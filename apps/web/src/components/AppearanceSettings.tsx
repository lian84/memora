import { useAppearance, resetAppearance, updateAppearance, type FontSizePreference, type ThemeMode } from '../lib/appearance';

const themes: Array<{ value: ThemeMode; label: string; detail: string }> = [
  { value: 'system', label: 'Sistema', detail: 'Segue il tema del dispositivo' },
  { value: 'light', label: 'Chiaro', detail: 'Sempre luminoso' },
  { value: 'dark', label: 'Scuro', detail: 'Meno luce, più contrasto' },
];


const fontSizes: Array<{ value: FontSizePreference; label: string; sample: string }> = [
  { value: 'small', label: 'Piccolo', sample: 'Aa' },
  { value: 'normal', label: 'Normale', sample: 'Aa' },
  { value: 'large', label: 'Grande', sample: 'Aa' },
  { value: 'xlarge', label: 'Molto grande', sample: 'Aa' },
];

export function AppearanceSettings() {
  const appearance = useAppearance();

  return (
    <section className="admin-card appearance-card">
      <div className="appearance-heading">
        <div>
          <h3>Aspetto</h3>
          <p className="admin-card-description">Le preferenze sono salvate solo in questo browser e si applicano subito.</p>
        </div>
        <button type="button" className="appearance-reset" onClick={() => resetAppearance()}>
          Ripristina
        </button>
      </div>

      <fieldset className="appearance-fieldset">
        <legend>Tema</legend>
        <div className="appearance-choice-grid appearance-theme-grid" role="radiogroup" aria-label="Tema">
          {themes.map(theme => (
            <label key={theme.value} className={`appearance-choice${appearance.theme === theme.value ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="appearance-theme"
                value={theme.value}
                checked={appearance.theme === theme.value}
                onChange={() => updateAppearance({ theme: theme.value })}
              />
              <span className={`appearance-theme-swatch is-${theme.value}`} aria-hidden="true" />
              <strong>{theme.label}</strong>
              <small>{theme.detail}</small>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="appearance-fieldset">
        <legend>Dimensione testo</legend>
        <div className="appearance-choice-grid appearance-font-grid" role="radiogroup" aria-label="Dimensione testo">
          {fontSizes.map(size => (
            <label key={size.value} className={`appearance-choice appearance-font-choice is-${size.value}${appearance.fontSize === size.value ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="appearance-font-size"
                value={size.value}
                checked={appearance.fontSize === size.value}
                onChange={() => updateAppearance({ fontSize: size.value })}
              />
              <span className="appearance-font-sample" aria-hidden="true">{size.sample}</span>
              <strong>{size.label}</strong>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="admin-grid-2 appearance-options">
        <fieldset className="appearance-fieldset">
          <legend>Densità</legend>
          <div className="appearance-segmented" role="radiogroup" aria-label="Densità">
            <label className={appearance.density === 'comfortable' ? 'is-selected' : ''}>
              <input type="radio" name="appearance-density" checked={appearance.density === 'comfortable'} onChange={() => updateAppearance({ density: 'comfortable' })} />
              Comoda
            </label>
            <label className={appearance.density === 'compact' ? 'is-selected' : ''}>
              <input type="radio" name="appearance-density" checked={appearance.density === 'compact'} onChange={() => updateAppearance({ density: 'compact' })} />
              Compatta
            </label>
          </div>
        </fieldset>

        <fieldset className="appearance-fieldset">
          <legend>Conversazione</legend>
          <label className="admin-toggle">
            <input type="checkbox" checked={appearance.wideChat} onChange={event => updateAppearance({ wideChat: event.target.checked })} />
            <span>Usa una larghezza maggiore</span>
          </label>
          <label className="admin-toggle">
            <input type="checkbox" checked={appearance.reducedMotion} onChange={event => updateAppearance({ reducedMotion: event.target.checked })} />
            <span>Riduci animazioni e scorrimento</span>
          </label>
          <label className="admin-toggle">
            <input type="checkbox" checked={appearance.sidebarCollapsed} onChange={event => updateAppearance({ sidebarCollapsed: event.target.checked })} />
            <span>Mantieni la barra chat compressa</span>
          </label>
        </fieldset>
      </div>

      <div className="appearance-preview" aria-label="Anteprima aspetto">
        <span className="appearance-preview-eyebrow">Anteprima</span>
        <p>Memora si adatta alla tua postazione. La memoria resta locale e il contesto resta sotto controllo.</p>
        <div className="appearance-preview-message">Questo è un esempio di messaggio della chat.</div>
      </div>
    </section>
  );
}
