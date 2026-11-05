import { KeyboardShortcutsPanel } from '../KeyboardShortcutsPanel';
import { Compass } from 'lucide-react';
import type { UserRole } from '../../../../shared/types';
import { Button } from '../../ui';
import { ThemeSettingsPanel } from '../ThemeSettingsPanel';
import { useSettingsContext } from '../SettingsContext';
import { ButtonGrid, ProviderButton, SettingsPanel } from '../settings-ui';

const ROLE_OPTIONS: Array<{ id: UserRole; label: string; description: string }> = [
  { id: 'developer', label: 'Developer', description: 'Build, review, and operate software' },
  { id: 'ba-brm', label: 'BA / BRM', description: 'Shape delivery work and decisions' },
  { id: 'design', label: 'Design', description: 'Explore and communicate product intent' },
  { id: 'itsm', label: 'ITSM', description: 'Coordinate service work and improvement' },
];

export function ProfileCategory() {
  const { draft, userRole, onRoleChange, onPreviewOnboarding } = useSettingsContext();

  const selectRole = async (role: UserRole) => {
    if (await draft.saveInstant({ userRole: role })) onRoleChange?.(role);
  };

  return (
    <>
      <KeyboardShortcutsPanel />
      <SettingsPanel
        panelId="role"
        title="Role"
        description="Controls which tools are visible in the sidebar."
        saveKeys={['userRole', 'showAllTools']}
        autosave
      >
        <ButtonGrid>
          {ROLE_OPTIONS.map((role) => (
            <ProviderButton
              key={role.id}
              label={role.label}
              description={role.description}
              active={(draft.settings.userRole ?? userRole) === role.id}
              onClick={() => void selectRole(role.id)}
            />
          ))}
        </ButtonGrid>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg-primary p-4 transition-colors hover:bg-bg-tertiary">
          <input
            type="checkbox"
            checked={draft.settings.showAllTools ?? false}
            onChange={(event) => draft.update('showAllTools', event.target.checked)}
            className="mt-1 h-4 w-4 accent-accent"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text-primary">Show all tools</span>
            <span className="mt-1 block text-sm leading-relaxed text-text-secondary">
              Keep every tool visible in the sidebar regardless of role. Hidden tools still open
              from direct links and the command palette.
            </span>
          </span>
        </label>

        {onPreviewOnboarding && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary">Preview first-run setup</p>
              <p className="mt-0.5 text-xs text-text-tertiary">
                Replay the role and connector screens without changing saved settings.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={onPreviewOnboarding}>
              <Compass size={14} aria-hidden="true" />
              Preview onboarding
            </Button>
          </div>
        )}
      </SettingsPanel>

      <ThemeSettingsPanel />
    </>
  );
}
