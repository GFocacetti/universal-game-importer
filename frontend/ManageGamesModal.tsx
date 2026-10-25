import {
    Field,
    Toggle,
    TextField,
    Dropdown,
    DialogBody,
    DialogButtonSecondary,
    ConfirmModal
} from '@steambrew/client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ManagedShortcut, FilterMode } from 'types';
import { readImageAsDataURL } from 'ipc';

type ManageGamesModalProps = {
    managedShortcuts: ManagedShortcut[];
    onApply: (ids: string[]) => Promise<void>;
    closeModal: () => void;
};

const ManageGamesModal = ({ managedShortcuts, onApply, closeModal }: ManageGamesModalProps) => {
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<FilterMode>('all');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [draftDisabled, setDraftDisabled] = useState(() =>
        new Set(
            managedShortcuts
                .filter((x) => !x.enabled)
                .map((x) => x.id)
        )
    );
    const [iconDataUrls, setIconDataUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        const loadIcons = async () => {
            for (const item of managedShortcuts) {
                if (item.icon && !iconDataUrls[item.icon]) {
                    try {
                        const dataUrl = await readImageAsDataURL(item.icon);
                        const cleanUrl = dataUrl.replace(/^"|"$/g, '').replace(/&quot;/g, '"');
                        setIconDataUrls(prev => ({ ...prev, [item.icon!]: cleanUrl }));
                    } catch (err) {
                        console.error('Failed to load icon for', item.name, item.icon, err);
                        setIconDataUrls(prev => ({ ...prev, [item.icon!]: '' }));
                    }
                }
            }
        };
        loadIcons();
    }, [managedShortcuts]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();

        return managedShortcuts.filter((item) => {
            const disabled = draftDisabled.has(item.id);

            const matchesQuery =
                q.length === 0 ||
                item.name.toLowerCase().includes(q) ||
                item.id.toLowerCase().includes(q) ||
                (item.source ?? '').toLowerCase().includes(q);

            const matchesFilter =
                filter === 'all' ||
                (filter === 'enabled' && !disabled) ||
                (filter === 'disabled' && disabled);

            return matchesQuery && matchesFilter;
        });
    }, [managedShortcuts, draftDisabled, query, filter]);

    const disabledCount = draftDisabled.size;
    const enabledCount = Math.max(0, managedShortcuts.length - disabledCount);

    const setDisabled = useCallback((id: string, disabled: boolean) => {
        setDraftDisabled((prev) => {
            const next = new Set(prev);
            if (disabled) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const setAllVisible = useCallback((disabled: boolean) => {
        setDraftDisabled((prev) => {
            const next = new Set(prev);
            for (const item of filtered) {
                if (disabled) next.add(item.id);
                else next.delete(item.id);
            }
            return next;
        });
    }, [filtered]);

    const handleApply = useCallback(async () => {
        setSaving(true);
        setError(null);

        try {
            await onApply(Array.from(draftDisabled).sort());
            closeModal();
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'Failed to save disabled games');
        } finally {
            setSaving(false);
        }
    }, [draftDisabled, onApply, closeModal]);

    return (
        <ConfirmModal
            strTitle="Manage imported games"
            onCancel={closeModal}
            onOK={handleApply}
            strOKButtonText={saving ? 'Saving...' : 'Apply'}
            bHideCloseIcon={false}
        >
            <DialogBody>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <TextField
                        value={query}
                        label="Search by game title, id, or source"
                        onChange={(e: any) => setQuery(e?.target?.value ?? '')}
                        style={{ marginBottom: 0 }}
                    />

                    <Dropdown
                        selectedOption={filter}
                        rgOptions={[
                            { label: 'All games', data: 'all' },
                            { label: 'Enabled only', data: 'enabled' },
                            { label: 'Disabled only', data: 'disabled' },
                        ]}
                        onChange={(option: any) => setFilter((option?.data ?? 'all') as FilterMode)}
                    />

                    <div
                        style={{
                            display: 'flex',
                            gap: 6,
                            flexWrap: 'wrap',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: 12,
                            margin: '2px 0'
                        }}
                    >
                        <div style={{ opacity: 0.8 }}>
                            {filtered.length} of {managedShortcuts.length} games - {enabledCount} enabled - {disabledCount} disabled
                        </div>

                        <div style={{ display: 'flex', gap: 6 }}>
                            <DialogButtonSecondary 
                                onClick={() => setAllVisible(false)} 
                                disabled={saving || filtered.length === 0}
                                style={{ padding: '4px 8px', fontSize: 12 }}
                            >
                                Enable visible
                            </DialogButtonSecondary>
                            <DialogButtonSecondary 
                                onClick={() => setAllVisible(true)} 
                                disabled={saving || filtered.length === 0}
                                style={{ padding: '4px 8px', fontSize: 12 }}
                            >
                                Block visible
                            </DialogButtonSecondary>
                        </div>
                    </div>

                    <div style={{ maxHeight: '320px', overflowY: 'auto', marginTop: 4 }}>
                        <div style={{ display: 'grid', gap: 6 }}>
                            {filtered.length === 0 ? (
                                <div style={{ opacity: 0.8, padding: '8px 0', fontSize: 13 }}>
                                    No games matched the current search/filter.
                                </div>
                            ) : (
                                filtered.map((item) => {
                                    const disabled = draftDisabled.has(item.id);
                                    const description = item.source
                                        ? `${item.source} • ${item.id}`
                                        : item.id;

                                    return (
                                        <Field
                                            key={item.id}
                                            label={item.name}
                                            description={description}
                                            bottomSeparator="standard"
                                            focusable
                                            //@ts-expect-error
                                            style={{ contain: 'layout paint', padding: '4px 0' }}
                                            icon={
                                                item.icon && iconDataUrls[item.icon] ? (
                                                    <img
                                                        src={iconDataUrls[item.icon]}
                                                        alt=""
                                                        style={{ width: 28, height: 28, objectFit: 'contain' }}
                                                    />
                                                ) : undefined
                                            }
                                        >
                                            <Toggle
                                                value={!disabled}
                                                onChange={(enabled: boolean) => setDisabled(item.id, !enabled)}
                                                disabled={saving}
                                            />
                                        </Field>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {error && (
                        <div style={{ color: '#ff8080', fontSize: 12, marginTop: 4 }}>
                            {error}
                        </div>
                    )}
                </div>
            </DialogBody>
        </ConfirmModal>
    );
};

export default ManageGamesModal;