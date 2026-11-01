import { ShieldCheck } from 'lucide-react';
import { useSettingsContext } from '../SettingsContext';
import { SettingsPanel } from '../settings-ui';
import { CredentialStoragePanel } from '../CredentialStoragePanel';

export function PrivacyCategory() {
  const { draft } = useSettingsContext();

  return (
    <>
      <CredentialStoragePanel />
      <SettingsPanel
        panelId="telemetry"
        title="Help improve Mezair"
        description="Choose whether to share crash reports or anonymous usage statistics."
        saveKeys={['telemetryEnabled', 'usageStatisticsEnabled']}
        autosave
      >
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg-primary p-4 transition-colors hover:bg-bg-tertiary">
          <input
            type="checkbox"
            checked={draft.settings.telemetryEnabled ?? false}
            onChange={(event) => draft.update('telemetryEnabled', event.target.checked)}
            className="mt-1 h-4 w-4 accent-accent"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <ShieldCheck size={15} className="text-accent" />
              Send crash reports
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-text-secondary">
              Sends error stack traces, the Mezair version, and operating-system details to Sentry.
              Reports do not include screenshots, interaction history, or attached repository files.
            </span>
          </span>
        </label>
        <p className="text-xs leading-relaxed text-text-tertiary">
          Off by default. Restart Mezair for a change to take effect. Error stack traces may contain
          local file paths.
        </p>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg-primary p-4 transition-colors hover:bg-bg-tertiary">
          <input
            type="checkbox"
            checked={draft.settings.usageStatisticsEnabled ?? false}
            onChange={(event) => draft.update('usageStatisticsEnabled', event.target.checked)}
            className="mt-1 h-4 w-4 accent-accent"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text-primary">
              Share anonymous usage statistics
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-text-secondary">
              Sends app launches and feature event counts, the Mezair version, platform, and
              processor architecture to PostHog in the EU. No prompts, code, repository names, file
              paths, credentials, or account details are sent. No session recordings.
            </span>
          </span>
        </label>
        <p className="text-xs leading-relaxed text-text-tertiary">
          Off by default and separate from crash reporting. Changes take effect immediately. A fresh
          random identifier is used each time Mezair starts; it is never linked to your account.
        </p>
      </SettingsPanel>
    </>
  );
}
