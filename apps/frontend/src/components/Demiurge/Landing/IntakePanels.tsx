import { ChevronRight, Sparkles } from 'lucide-react';
import { MagneticButton } from '../../beui/registry/components/motion/button/magnetic';
import { BouncyAccordion } from '../../beui/bouncy-accordion';
import { useTranslation } from 'react-i18next';
import type { CSSProperties, RefObject } from 'react';
import type { BeeGameIntakeOption, BeeGameIntakeSettings } from '../../../services/beeGameAdapter';
import type { ProductionSettingOptions } from '../../../config/productionSettingOptions';
import type { IntakeCopy } from './types';
import { ProjectSelect } from '../../beui/project-select';
import styles from './AvatarDialogue.module.css';

type IntakeOptionCardsProps = {
  options: BeeGameIntakeOption[];
  copy: IntakeCopy;
  localizedOptionLabel: (value: string) => string;
  onSelect: (option: BeeGameIntakeOption) => void;
};

export function IntakeOptionCards({ options, copy, localizedOptionLabel, onSelect }: IntakeOptionCardsProps) {
  const { t } = useTranslation('landing');
  return <div data-testid="intake-options">
    <BouncyAccordion defaultValue={null} classNames={{ item: 'bg-muted', title: `whitespace-normal ${styles.headlineText}`, trigger: 'py-3' }} items={options.map((option, index) => ({
      id: option.id,
      icon: <span className={`${styles.footnoteText} tabular-nums`}>0{index + 1}</span>,
      title: <span data-testid="intake-option-title">{option.title}</span>,
      description: <div>
        <div data-dialogue-item style={{ '--dialogue-order': 0 } as CSSProperties} className={`${styles.footnoteText} text-muted-foreground`}>{copy.optionCard.gameplay}</div>
        <div data-dialogue-item style={{ '--dialogue-order': 1 } as CSSProperties} data-testid="intake-option-gameplay" tabIndex={0} aria-label={copy.optionCard.gameplay} className={`${styles.bodyText} mt-2 whitespace-pre-wrap break-words text-muted-foreground ${styles.proposalGameplay}`}>{option.gameplay || localizedOptionLabel(option.title)}</div>
        <div data-dialogue-item style={{ '--dialogue-order': 2 } as CSSProperties} className="mt-4 flex justify-end"><MagneticButton variant="primary" size="icon" className="rounded-full" aria-label={t('avatar.nextStep')} onClick={() => onSelect(option)}><ChevronRight aria-hidden="true" className="size-5" /></MagneticButton></div>
      </div>,
    }))} />
  </div>;

}

type IntakeSettingsFormProps = {
  settings: BeeGameIntakeSettings;
  copy: IntakeCopy;
  options: ProductionSettingOptions;
  localizedOptionLabel: (value: string) => string;
  onChange: (patch: Partial<BeeGameIntakeSettings>) => void;
  isInputMenuOpen: boolean;
  onToggleInputMenu: () => void;
  inputMenuRef: RefObject<HTMLDivElement | null>;
  inputMenuButtonRef: RefObject<HTMLButtonElement | null>;
  group: number;
  onNext: () => void;
  onConfirm: () => void;
};

export function IntakeSettingsForm({
  settings,
  copy,
  options,
  localizedOptionLabel,
  onChange,
  isInputMenuOpen,
  onToggleInputMenu,
  inputMenuRef,
  inputMenuButtonRef,
  group,
  onNext,
  onConfirm,
}: IntakeSettingsFormProps) {
  const { t } = useTranslation('landing');
  const selectClass = `${styles.bodyText} mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30`;
  const inputLabelClass = `${styles.subheadText} text-muted-foreground`;
  const inputDisplay = settings.inputs.map(localizedOptionLabel).join(' / ') || copy.fields.selectPlaceholder;
  return (
    <div className="space-y-4" data-testid="intake-settings" data-panel-depth="single" data-group={group}>
      <p className={`${styles.footnoteText} text-muted-foreground`}>{group + 1} / 3</p>
      {group !== 2 ? <div data-dialogue-items className="grid gap-3 sm:grid-cols-2">
        {group === 0 ? <>
        <SettingSelect label={copy.fields.platform} value={settings.platform} options={options.platforms} onChange={value => onChange({ platform: value })} copy={copy} localizedOptionLabel={localizedOptionLabel} className={selectClass} labelClass={inputLabelClass} />
        <SettingSelect label={copy.fields.engine} value={settings.engine || ''} options={options.engines} onChange={value => onChange({ engine: value })} copy={copy} localizedOptionLabel={localizedOptionLabel} className={selectClass} labelClass={inputLabelClass} />
        <SettingSelect label={copy.fields.dimension} value={settings.dimension} options={options.dimensions} onChange={value => onChange({ dimension: value })} copy={copy} localizedOptionLabel={localizedOptionLabel} className={selectClass} labelClass={inputLabelClass} />
        {!['VR', 'AR'].includes(settings.dimension) && <SettingSelect label={copy.fields.orientation} value={settings.orientation || ''} options={['Landscape', 'Portrait']} onChange={value => onChange({ orientation: value as BeeGameIntakeSettings['orientation'] })} copy={copy} localizedOptionLabel={localizedOptionLabel} className={selectClass} labelClass={inputLabelClass} />}
        </> : null}
        {group === 1 ? <>
        <SettingSelect label={copy.fields.genre} value={settings.genre} options={options.genres} onChange={value => onChange({ genre: value })} copy={copy} localizedOptionLabel={localizedOptionLabel} className={selectClass} labelClass={inputLabelClass} />
        <SettingSelect label={copy.fields.style} value={settings.visualStyle} options={options.styles} onChange={value => onChange({ visualStyle: value })} copy={copy} localizedOptionLabel={localizedOptionLabel} className={selectClass} labelClass={inputLabelClass} />
        <div ref={inputMenuRef} className={`min-w-0 ${inputLabelClass}`}>
          <span>{copy.fields.inputs}</span>
          <button
            ref={inputMenuButtonRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isInputMenuOpen}
            title={inputDisplay}
            onClick={onToggleInputMenu}
            className={`${styles.bodyText} mt-2 flex h-11 min-w-0 w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3 py-2 text-left text-foreground outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/30`}
          >
            <span className={`min-w-0 flex-1 truncate ${settings.inputs.length ? 'text-foreground' : 'text-muted-foreground'}`}>
              {inputDisplay}
            </span>
            <span aria-hidden="true" className={`shrink-0 ${styles.footnoteText} text-muted-foreground`}>{isInputMenuOpen ? '▴' : '▾'}</span>
          </button>
        </div>
        <div className={inputLabelClass}>
          {copy.fields.resourceLibrary}
          <ProjectSelect portal ariaLabel={copy.fields.resourceLibrary} value={settings.resourceLibraryUsage || ''} onValueChange={value => onChange({ resourceLibraryUsage: value as BeeGameIntakeSettings['resourceLibraryUsage'] })} placeholder={copy.fields.selectPlaceholder} options={(['preferred', 'optional', 'required'] as const).map(value => ({ value, label: copy.resourceLibraryUsage[value] }))} className="w-full" triggerClassName={selectClass} contentClassName={styles.selectMenu} />
        </div>
        </> : null}
      </div> : null}
      {group === 2 ? <label data-dialogue-item className={`block ${styles.subheadText} text-muted-foreground`}>
        {copy.fields.notes}
        <textarea aria-label={copy.fields.notes} value={settings.notes || ''} onChange={event => onChange({ notes: event.target.value })} placeholder={copy.placeholders.notes} className={`${styles.bodyText} mt-2 min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30`} />
      </label> : null}
      <div data-dialogue-item style={{ '--dialogue-order': group === 2 ? 1 : 4 } as CSSProperties} className="flex justify-end pt-1">
        <MagneticButton variant="primary" size="icon" className="rounded-full" aria-label={group === 2 ? copy.actions.confirmBrief : t('avatar.nextStep')} onClick={group === 2 ? onConfirm : onNext}><ChevronRight aria-hidden="true" className="size-5" /></MagneticButton>
      </div>
    </div>
  );
}

function SettingSelect({ label, value, options, onChange, copy, localizedOptionLabel, className, labelClass }: { label: string; value: string; options: string[]; onChange: (value: string) => void; copy: IntakeCopy; localizedOptionLabel: (value: string) => string; className: string; labelClass: string }) {
  // The settings dialog scrolls: inline menus would be clipped by its bounds.
  return <div className={labelClass}>{label}<ProjectSelect portal ariaLabel={label} value={value} onValueChange={onChange} placeholder={copy.fields.selectPlaceholder} options={options.map(option => ({ value: option, label: localizedOptionLabel(option) }))} className="w-full" triggerClassName={className} contentClassName={styles.selectMenu} /></div>;
}

type ConfirmedBriefProps = { settings: BeeGameIntakeSettings; copy: IntakeCopy; localizedOptionLabel: (value: string) => string; isPreparing: boolean; onStart: () => void };

export function ConfirmedBrief({ settings, copy, localizedOptionLabel, isPreparing, onStart }: ConfirmedBriefProps) {
  const values = [[copy.fields.platform, settings.platform], [copy.fields.engine, settings.engine || copy.fields.selectPlaceholder], [copy.fields.presentation, settings.dimension], ...(!['VR', 'AR'].includes(settings.dimension) ? [[copy.fields.orientation, settings.orientation || '']] : []), [copy.fields.type, settings.genre], [copy.fields.style, settings.visualStyle], [copy.fields.inputs, settings.inputs.join(' / ')], [copy.fields.resourceLibrary, copy.resourceLibraryUsage[settings.resourceLibraryUsage]]] as const;
  return <div className="space-y-4" data-testid="confirmed-brief" data-panel-depth="single"><dl data-dialogue-items className="grid gap-x-8 gap-y-4 py-1 sm:grid-cols-2">{values.map(([label, value]) => <div key={label}><dt className={`${styles.footnoteText} text-muted-foreground`}>{label}</dt><dd className={`mt-1 ${styles.bodyText} text-foreground`}>{localizedOptionLabel(value)}</dd></div>)}</dl>{settings.notes ? <p data-dialogue-item style={{ '--dialogue-order': values.length } as CSSProperties} className={`rounded-lg bg-muted p-3 ${styles.bodyText} text-muted-foreground`}>{settings.notes}</p> : null}<div data-dialogue-item style={{ '--dialogue-order': values.length + (settings.notes ? 1 : 0) } as CSSProperties} className="flex flex-wrap justify-end gap-3 border-t border-border pt-4"><MagneticButton variant="primary" size="icon" className="rounded-full" disabled={isPreparing} onClick={onStart} aria-label={isPreparing ? copy.actions.building : copy.actions.startBuild}><Sparkles aria-hidden="true" className="size-4" /></MagneticButton></div></div>;
}
