import type { RefObject } from 'react';
import type { BeeGameIntakeOption, BeeGameIntakeSettings } from '../../../services/beeGameAdapter';
import type { ProductionSettingOptions } from '../../../config/productionSettingOptions';
import type { IntakeCopy } from './types';
import { ProjectSelect } from '../../beui/project-select';

type IntakeOptionCardsProps = {
  options: BeeGameIntakeOption[];
  copy: IntakeCopy;
  localizedOptionLabel: (value: string) => string;
  onSelect: (option: BeeGameIntakeOption) => void;
};

export function IntakeOptionCards({ options, copy, localizedOptionLabel, onSelect }: IntakeOptionCardsProps) {
  return (
    <div className="space-y-4" data-testid="intake-options">
      <div className="grid items-stretch gap-3 md:grid-cols-3">
        {options.map(option => (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option)}
            data-testid="intake-option-card"
            className="group grid h-[25rem] min-h-[20rem] grid-rows-[5.25rem_1.75rem_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card p-4 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="min-h-0">
              <div className="type-footnote text-muted-foreground">{copy.optionCard.mode}</div>
              <div data-testid="intake-option-title" className="type-title-3 mt-2 line-clamp-2 overflow-hidden text-foreground">
                {option.title}
              </div>
            </div>
            <div className="type-footnote mt-4 text-muted-foreground">{copy.optionCard.gameplay}</div>
            <div data-testid="intake-option-gameplay" className="scrollbar-premium type-body mt-2 min-h-0 overflow-y-auto py-2 text-muted-foreground">
              {option.gameplay || localizedOptionLabel(option.title)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
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
  onBack: () => void;
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
  onBack,
  onConfirm,
}: IntakeSettingsFormProps) {
  const selectClass = 'mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30';
  const inputLabelClass = 'text-sm text-muted-foreground';
  return (
    <div className="space-y-4" data-testid="intake-settings" data-panel-depth="single">
      <div className="grid gap-3 sm:grid-cols-2">
        <SettingSelect label={copy.fields.platform} value={settings.platform} options={options.platforms} onChange={value => onChange({ platform: value })} copy={copy} localizedOptionLabel={localizedOptionLabel} className={selectClass} labelClass={inputLabelClass} />
        <SettingSelect label={copy.fields.engine} value={settings.engine || ''} options={options.engines} onChange={value => onChange({ engine: value })} copy={copy} localizedOptionLabel={localizedOptionLabel} className={selectClass} labelClass={inputLabelClass} />
        <SettingSelect label={copy.fields.dimension} value={settings.dimension} options={options.dimensions} onChange={value => onChange({ dimension: value })} copy={copy} localizedOptionLabel={localizedOptionLabel} className={selectClass} labelClass={inputLabelClass} />
        <SettingSelect label={copy.fields.genre} value={settings.genre} options={options.genres} onChange={value => onChange({ genre: value })} copy={copy} localizedOptionLabel={localizedOptionLabel} className={selectClass} labelClass={inputLabelClass} />
        <SettingSelect label={copy.fields.style} value={settings.visualStyle} options={options.styles} onChange={value => onChange({ visualStyle: value })} copy={copy} localizedOptionLabel={localizedOptionLabel} className={selectClass} labelClass={inputLabelClass} />
        <div className={inputLabelClass}>
          {copy.fields.resourceLibrary}
          <ProjectSelect ariaLabel={copy.fields.resourceLibrary} value={settings.resourceLibraryUsage || ''} onValueChange={value => onChange({ resourceLibraryUsage: value as BeeGameIntakeSettings['resourceLibraryUsage'] })} placeholder={copy.fields.selectPlaceholder} options={(['preferred', 'optional', 'required'] as const).map(value => ({ value, label: copy.resourceLibraryUsage[value] }))} className="w-full" triggerClassName={selectClass} />
        </div>
        <div ref={inputMenuRef} className={inputLabelClass}>
          <span>{copy.fields.inputs}</span>
          <button
            ref={inputMenuButtonRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isInputMenuOpen}
            onClick={onToggleInputMenu}
            className="mt-2 flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm text-foreground outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <span className={settings.inputs.length ? 'text-foreground' : 'text-muted-foreground'}>
              {settings.inputs.length ? settings.inputs.map(localizedOptionLabel).join(' / ') : copy.fields.selectPlaceholder}
            </span>
            <span aria-hidden="true" className="text-xs text-muted-foreground">{isInputMenuOpen ? '▴' : '▾'}</span>
          </button>
        </div>
      </div>
      <label className="block text-sm text-muted-foreground">
        {copy.fields.notes}
        <textarea aria-label={copy.fields.notes} value={settings.notes || ''} onChange={event => onChange({ notes: event.target.value })} placeholder={copy.placeholders.notes} className="mt-2 min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <button type="button" onClick={onBack} className="h-9 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition hover:bg-accent">{copy.actions.chooseAgain}</button>
        <button type="button" onClick={onConfirm} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90">{copy.actions.confirmBrief}</button>
      </div>
    </div>
  );
}

function SettingSelect({ label, value, options, onChange, copy, localizedOptionLabel, className, labelClass }: { label: string; value: string; options: string[]; onChange: (value: string) => void; copy: IntakeCopy; localizedOptionLabel: (value: string) => string; className: string; labelClass: string }) {
  return <div className={labelClass}>{label}<ProjectSelect ariaLabel={label} value={value} onValueChange={onChange} placeholder={copy.fields.selectPlaceholder} options={options.map(option => ({ value: option, label: localizedOptionLabel(option) }))} className="w-full" triggerClassName={className} /></div>;
}

type ConfirmedBriefProps = { settings: BeeGameIntakeSettings; copy: IntakeCopy; localizedOptionLabel: (value: string) => string; isPreparing: boolean; onEdit: () => void; onStart: () => void };

export function ConfirmedBrief({ settings, copy, localizedOptionLabel, isPreparing, onEdit, onStart }: ConfirmedBriefProps) {
  const values = [[copy.fields.platform, settings.platform], [copy.fields.engine, settings.engine || 'React'], [copy.fields.presentation, settings.dimension], [copy.fields.type, settings.genre], [copy.fields.style, settings.visualStyle], [copy.fields.inputs, settings.inputs.join(' / ')], [copy.fields.resourceLibrary, copy.resourceLibraryUsage[settings.resourceLibraryUsage]]] as const;
  return <div className="space-y-4" data-testid="confirmed-brief" data-panel-depth="single"><dl className="grid gap-x-8 gap-y-4 py-1 sm:grid-cols-2">{values.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm text-foreground">{localizedOptionLabel(value)}</dd></div>)}</dl>{settings.notes ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{settings.notes}</p> : null}<div className="flex flex-wrap justify-end gap-3 border-t border-border pt-4"><button type="button" onClick={onEdit} className="h-9 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition hover:bg-accent">{copy.actions.edit}</button><button type="button" disabled={isPreparing} onClick={onStart} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">{isPreparing ? copy.actions.building : copy.actions.startBuild}</button></div></div>;
}
