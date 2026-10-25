import {
    Field,
    DialogButton,
    Toggle,
    showModal,
    IconsModule,
    pluginSelf,
    ShowModalResult
} from '@steambrew/client';
import { loadSettings, loadManagedShortcuts, saveDefaultDisableList, saveAutoResync, saveDisabled, runResync, restartSteam } from 'ipc';

import ManageGamesModal from 'ManageGamesModal';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ManagedShortcut } from 'types';
import { formatTimestamp } from 'utils';

const SettingsContent = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [defaultDisableListEnabled, setDefaultDisableListEnabledState] = useState(true);
    const [autoResyncOnStartup, setAutoResyncOnStartupState] = useState(true);
    const [managedShortcuts, setManagedShortcuts] = useState<ManagedShortcut[]>([]);
    const [disabledIds, setDisabledIds] = useState<string[]>([]);
    const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

    const disabledSet = useMemo(() => new Set(disabledIds), [disabledIds]);

    const renderedShortcuts = useMemo(() => {
        return managedShortcuts.map((s) => ({
            ...s,
            enabled: s.enabled ?? !disabledSet.has(s.id),
        }));
    }, [managedShortcuts, disabledSet]);

    const enabledCount = useMemo(
        () => renderedShortcuts.filter((s) => s.enabled).length,
        [renderedShortcuts]
    );

    const refreshAll = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const s = await loadSettings();
            setManagedShortcuts(s.managed_shortcuts ?? []);
            setDisabledIds(s.disabled_shortcuts ?? []);
            setLastSyncAt(s.last_sync_at ?? null);
            setDefaultDisableListEnabledState(s.default_disablelist_enabled ?? true);
            setAutoResyncOnStartupState(s.auto_resync_on_startup ?? true);
        } catch (e) {
            console.error(e);
            setError('Failed to load plugin state');
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshManagedOnly = useCallback(async () => {
        try {
            setManagedShortcuts(await loadManagedShortcuts());
        } catch (e) {
            console.error(e);
        }
    }, []);

    useEffect(() => {
        refreshAll();
    }, [refreshAll]);

    // actors
    const onToggleDefaultDisableList = useCallback(async (enabled: boolean) => {
        setError(null);
        setDefaultDisableListEnabledState(enabled);

        try {
            if (!(await saveDefaultDisableList(enabled))) throw new Error();
        } catch (e) {
            console.error(e);
            setError('Failed to update default disablelist setting');
            refreshAll();
        }
    }, [refreshAll]);

    const onToggleAutoResync = useCallback(async (enabled: boolean) => {
        setError(null);
        setAutoResyncOnStartupState(enabled);

        try {
            if (!(await saveAutoResync(enabled))) throw new Error();
        } catch (e) {
            console.error(e);
            setError('Failed to update auto resync setting');
            refreshAll();
        }
    }, [refreshAll]);

    const onApplyDisabledIds = useCallback(async (ids: string[]) => {
        setSaving(true);
        setError(null);

        try {
            if (!(await saveDisabled(ids))) throw new Error();
            if (!(await runResync())) throw new Error();

            setDisabledIds(ids);
            await refreshManagedOnly();
        } catch (e) {
            console.error(e);
            setError('Failed to update disabled games');
            await refreshAll();
            throw e;
        } finally {
            setSaving(false);
        }
    }, [refreshAll, refreshManagedOnly]);

    const openManageGames = useCallback(() => {
        let ref: ShowModalResult | null = null;

        const close = () => ref?.Close();

        ref = showModal(
            <ManageGamesModal
                managedShortcuts={renderedShortcuts}
                onApply={onApplyDisabledIds}
                closeModal={close}
            />,
            pluginSelf?.mainWindow ?? window,
            {
                strTitle: 'Manage imported games',
                popupWidth: 720,
                popupHeight: 720,
                bNeverPopOut: false,
            }
        );
    }, [renderedShortcuts, onApplyDisabledIds]);

    const onResync = useCallback(async () => {
        setSyncing(true);
        setError(null);

        try {
            const r = await runResync();
            if (!r.success) throw new Error(r.message);

            if (r.synced_at) setLastSyncAt(r.synced_at);

            await refreshAll();
        } catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : 'Failed to resync library');
        } finally {
            setSyncing(false);
        }
    }, [refreshAll]);


    return (
        <>
            <Field
                label="Resync Library"
                description={
                    lastSyncAt
                        ? `Last sync: ${formatTimestamp(lastSyncAt)}`
                        : 'Scan installed games and sync managed Steam shortcuts.'
                }
                icon={<IconsModule.Refresh />}
                bottomSeparator="standard"
                focusable
            >
                <DialogButton onClick={onResync} disabled={syncing || loading || saving}>
                    {syncing ? 'Resyncing...' : 'Resync Now'}
                </DialogButton>
            </Field>

            <Field
                label="Managed Games"
                description={
                    loading
                        ? 'Loading imported games...'
                        : `${managedShortcuts.length} managed shortcuts • ${enabledCount} enabled • ${disabledIds.length} disabled`
                }
                icon={<IconsModule.Library />}
                bottomSeparator="standard"
                focusable
            >
                <DialogButton onClick={openManageGames} disabled={loading || syncing || saving}>
                    Manage Games
                </DialogButton>
            </Field>

            <Field
                label="Relaunch Steam"
                description="Restart the Steam client to apply changes"
                icon={<IconsModule.Settings />}
                bottomSeparator="standard"
                focusable
            >
                <DialogButton onClick={restartSteam} disabled={loading || syncing || saving}>
                    Relaunch Steam
                </DialogButton>
            </Field>

            <Field
                label="Default DisableList"
                description="Enable the built-in app disablelist during sync."
                icon={<IconsModule.Settings />}
                bottomSeparator="standard"
                focusable
            >
                <Toggle
                    value={defaultDisableListEnabled}
                    onChange={onToggleDefaultDisableList}
                    disabled={loading || syncing || saving}
                />
            </Field>

            <Field
                label="Auto Resync on Startup"
                description="Run library sync automatically when the plugin loads."
                icon={<IconsModule.Settings />}
                bottomSeparator="standard"
                focusable
            >
                <Toggle
                    value={autoResyncOnStartup}
                    onChange={onToggleAutoResync}
                    disabled={loading || syncing || saving}
                />
            </Field>

            {error ? (
                <Field
                    label="Status"
                    description={error}
                    icon={<IconsModule.Caution />}
                    bottomSeparator="standard"
                    focusable
                >
                    <DialogButton onClick={refreshAll} disabled={loading || syncing || saving}>
                        Retry
                    </DialogButton>
                </Field>
            ) : null}

            {!loading && managedShortcuts.length === 0 ? (
                <Field
                    label="Managed Apps"
                    description="No imported games were found yet."
                    icon={<IconsModule.Library />}
                    bottomSeparator="standard"
                    focusable
                >
                    <DialogButton onClick={onResync} disabled={syncing || saving}>
                        Scan Library
                    </DialogButton>
                </Field>
            ) : null}
        </>
    );
};

export default SettingsContent;