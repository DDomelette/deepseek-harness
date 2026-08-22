/**
 * Skills settings section: one icon per display group (declared group or
 * discovery source), drilling into a group's skill list with one toggle per
 * skill. Toggles write through the page store's revision-guarded settings
 * path; effective invocation flags ride the catalog rows.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { IconFolderClose16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { groupSkills } from './grouping.ts'
import { sourceLabel, type SkillsKey } from './locales.ts'
import type { SkillsSettingsState } from './store.ts'
import styles from './SkillsSection.module.css'

/** Registration-side business face of {@link SkillsSection}. */
export interface SkillsSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as `useSkills`. */
    skills: SnapshotStore<SkillsSettingsState>
  }
  /** Load or refresh the current session's catalog. */
  load: () => Promise<void>
  /** Persist one skill's user-global enablement override. */
  setEnabled: (name: string, enabled: boolean) => Promise<void>
}

/** Full component props composed from the slot, locale, and injected shares. */
export type SkillsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.skills'>
  & InjectFace<SkillsSectionInjected>

/**
 * Render the Skills settings section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section.
 */
export function SkillsSection({ useSkills, load, setEnabled, t }: SkillsSectionProps): ReactNode {
  const state = useSkills(snapshot => snapshot)
  const [openKey, setOpenKey] = useState<string | undefined>(undefined)
  const groups = useMemo(
    () => groupSkills(state.skills, source => sourceLabel(source, t)),
    [state.skills, t],
  )

  useEffect(() => {
    if (state.status === 'idle') void load()
  }, [load, state.status])

  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={styles.section}>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.error} role="alert">{`${t('loadFailed')}: ${errorText}`}</p>
        <button type="button" className={styles.secondaryButton} onClick={() => { void load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  const open = groups.find(group => group.key === openKey)

  return (
    <div className={styles.section}>
      <h2 className={styles.title}>{t('title')}</h2>
      <p className={styles.intro}>{t('intro')}</p>
      {!state.writable ? <p className={styles.notice}>{t('readOnly')}</p> : null}
      {state.error === null ? null : <p className={styles.error} role="alert">{state.error}</p>}
      {open !== undefined
        ? (
          <GroupView
            group={open}
            state={state}
            t={t}
            onBack={() => { setOpenKey(undefined) }}
            onToggle={(name, enabled) => { void setEnabled(name, enabled) }}
          />
        )
        : groups.length === 0
          ? <p className={styles.empty}>{state.noSession ? t('noSession') : t('empty')}</p>
          : (
            <ul className={styles.grid}>
              {groups.map(group => (
                <li key={group.key}>
                  <button
                    type="button"
                    className={styles.groupIcon}
                    onClick={() => { setOpenKey(group.key) }}
                  >
                    <IconFolderClose16 size={24} className={styles.groupGlyph} />
                    <span className={styles.groupLabel}>{group.label}</span>
                    <span className={styles.groupCount}>
                      {group.skills.length === 1
                        ? t('countOne')
                        : t('count').replace('{count}', String(group.skills.length))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
    </div>
  )
}

interface GroupViewProps {
  group: ReturnType<typeof groupSkills>[number]
  state: SkillsSettingsState
  t: (key: SkillsKey) => string
  onBack: () => void
  onToggle: (name: string, enabled: boolean) => void
}

function GroupView({ group, state, t, onBack, onToggle }: GroupViewProps): ReactNode {
  const togglesDisabled = state.status !== 'ready' || !state.writable || state.revision === undefined
  return (
    <div>
      <button type="button" className={styles.backButton} onClick={onBack}>{t('back')}</button>
      <h3 className={styles.groupTitle}>{group.label}</h3>
      <ul className={styles.skillList}>
        {group.skills.map((skill) => {
          const userOnly = !skill.modelInvocable && skill.userInvocable
          const writing = state.writing.includes(skill.name)
          return (
            <li key={skill.name} className={styles.skillRow}>
              <div className={styles.skillIdentity}>
                <span className={styles.skillName}>{skill.name}</span>
                {userOnly ? <span className={styles.skillTag}>{t('userOnly')}</span> : null}
                <span className={styles.skillDescription}>{skill.description}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!skill.disabled}
                aria-label={t('toggle').replace('{name}', skill.name)}
                className={skill.disabled ? styles.switch : `${styles.switch} ${styles.switchOn}`}
                disabled={togglesDisabled || writing}
                onClick={() => { onToggle(skill.name, skill.disabled) }}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
