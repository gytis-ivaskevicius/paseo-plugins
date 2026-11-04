import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import {
  copyText,
  FlatList,
  Icon,
  Modal,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  nameError,
  secretsGet,
  secretsList,
  secretsRemove,
  secretsSet,
  valueError,
} from "../shared/secrets";

type Theme = PluginScreenProps["theme"];
type Layout = PluginScreenProps["layout"];

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const start = text.search(/[A-Z][A-Z_]+: /);
  const body = start === -1 ? text : text.slice(start);
  return body.replace(/ (?:requestType|code)=.*$/, "");
}

function useStyles({ theme, layout }: Pick<PluginScreenProps, "theme" | "layout">) {
  return useMemo(() => {
    const { colors } = theme;
    const pad = layout.compact ? 14 : 20;
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      body: { flex: 1, flexDirection: layout.compact ? ("column" as const) : ("row" as const) },
      listPane: {
        flex: layout.compact ? 1 : undefined,
        width: layout.compact ? undefined : 340,
        maxWidth: layout.compact ? undefined : ("48%" as const),
        borderRightWidth: layout.compact ? 0 : 1,
        borderRightColor: colors.border,
        paddingHorizontal: layout.compact ? pad : 12,
        paddingTop: 12,
        gap: 10,
      },
      filters: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      filter: {
        flex: 1,
        minWidth: 0,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        color: colors.foreground,
        backgroundColor: colors.surface2,
      },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 9,
        paddingHorizontal: 10,
        borderRadius: 8,
      },
      rowSelected: { backgroundColor: colors.surface2 },
      rowName: { flex: 1, color: colors.foreground, fontSize: 14 },
      rowMeta: { color: colors.foregroundMuted, fontSize: 11 },
      detail: { flex: 1 },
      detailBody: { padding: layout.compact ? pad : 24, gap: 16 },
      detailHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
      detailName: {
        flex: 1,
        color: colors.foreground,
        fontSize: layout.compact ? 18 : 20,
        fontWeight: "600" as const,
      },
      label: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      valueBox: {
        backgroundColor: colors.surface2,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        padding: 12,
      },
      value: {
        color: colors.foreground,
        fontSize: 14,
        fontFamily: layout.platform === "ios" ? "Menlo" : "monospace",
      },
      masked: { color: colors.foregroundMuted, fontSize: 14, letterSpacing: 2 },
      notes: { color: colors.foreground, fontSize: 14 },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      placeholder: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        padding: pad,
        gap: 10,
      },
      placeholderText: { color: colors.foregroundMuted, fontSize: 14, textAlign: "center" as const },
      banner: {
        borderWidth: 1,
        borderColor: colors.statusDanger,
        borderRadius: 8,
        padding: 10,
        gap: 6,
      },
      bannerText: { color: colors.statusDanger, fontSize: 13 },
      form: { gap: 14 },
      field: { gap: 6 },
      input: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 9,
        color: colors.foreground,
        backgroundColor: colors.surface2,
      },
      notesInput: { minHeight: 96, textAlignVertical: "top" as const },
      formError: { color: colors.statusDanger, fontSize: 13 },
      modalActions: {
        flexDirection: "row" as const,
        justifyContent: "flex-end" as const,
        gap: 10,
        flexWrap: "wrap" as const,
      },
      link: { color: colors.accent, fontSize: 13 },
      linkDanger: { color: colors.statusDanger, fontSize: 13 },
      disabled: { opacity: 0.5 },
    };
  }, [theme, layout]);
}

function Action({
  icon,
  label,
  onPress,
  theme,
  disabled,
  danger,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  theme: Theme;
  disabled?: boolean;
  danger?: boolean;
}) {
  const color = danger ? theme.colors.statusDanger : theme.colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.surface2,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={16} color={color} />
      <Text style={{ color, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function ModalActions({
  styles,
  cancelLabel,
  onCancel,
  confirmLabel,
  confirmText,
  onConfirm,
  danger,
  busy,
  busyText,
}: {
  styles: ReturnType<typeof useStyles>;
  cancelLabel: string;
  onCancel: () => void;
  confirmLabel: string;
  confirmText: string;
  onConfirm: () => void;
  danger?: boolean;
  busy: boolean;
  busyText: string;
}) {
  return (
    <View style={styles.modalActions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cancelLabel}
        disabled={busy}
        onPress={onCancel}
      >
        <Text style={styles.link}>Cancel</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={confirmLabel}
        disabled={busy}
        onPress={onConfirm}
      >
        <Text style={[danger ? styles.linkDanger : styles.link, busy ? styles.disabled : null]}>
          {busy ? busyText : confirmText}
        </Text>
      </Pressable>
    </View>
  );
}

function EntryDetail({
  name,
  theme,
  layout,
  onClose,
  onDeleted,
}: {
  name: string;
  theme: Theme;
  layout: Layout;
  onClose: (() => void) | null;
  onDeleted: () => void;
}) {
  const styles = useStyles({ theme, layout });
  const getSecret = useRpc(secretsGet);
  const removeSecret = useRpc(secretsRemove);
  const toast = useToast();
  const detail = useQuery({
    queryKey: ["secrets", "get", name],
    queryFn: () => getSecret({ name }),
    retry: false,
  });
  const [revealed, setRevealed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function copyValue() {
    if (!detail.data) return;
    try {
      await copyText(detail.data.value);
      toast.show("Copied to clipboard", { variant: "success" });
    } catch {
      toast.error("Could not copy the value.");
    }
  }

  async function deleteEntry() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await removeSecret({ name });
      toast.show("Entry deleted", { variant: "success" });
      onDeleted();
    } catch (error) {
      setDeleteError(messageOf(error));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <View style={styles.detail}>
      <ScrollView contentContainerStyle={styles.detailBody}>
        <View style={styles.detailHeader}>
          {onClose ? (
            <Action icon="ArrowLeft" label="Back to list" onPress={onClose} theme={theme} />
          ) : null}
          <Text style={styles.detailName}>{name}</Text>
        </View>
        {detail.isPending ? <Text style={styles.placeholderText}>Loading entry…</Text> : null}
        {detail.error ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{messageOf(detail.error)}</Text>
          </View>
        ) : null}
        {detail.data ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Value</Text>
              <View style={styles.valueBox}>
                {revealed ? (
                  <Text selectable style={styles.value}>
                    {detail.data.value}
                  </Text>
                ) : (
                  <Text style={styles.masked}>••••••••••</Text>
                )}
              </View>
            </View>
            <View style={styles.actions}>
              <Action
                icon={revealed ? "EyeOff" : "Eye"}
                label={revealed ? "Hide" : "Reveal"}
                onPress={() => setRevealed((value) => !value)}
                theme={theme}
              />
              <Action icon="Copy" label="Copy" onPress={() => void copyValue()} theme={theme} />
              <Action
                icon="Trash2"
                label="Delete"
                danger
                onPress={() => setConfirmDelete(true)}
                theme={theme}
              />
            </View>
            {detail.data.notes !== "" ? (
              <View style={styles.field}>
                <Text style={styles.label}>Notes</Text>
                <Text selectable style={styles.notes}>
                  {detail.data.notes}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <Modal
        title="Delete entry?"
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDelete(false);
            setDeleteError(null);
          }
        }}
      >
        <Modal.Content>
          <View style={styles.form}>
            <Text style={styles.notes}>
              {name} will be removed from the password store.
            </Text>
            {deleteError ? <Text style={styles.formError}>{deleteError}</Text> : null}
            <ModalActions
              styles={styles}
              cancelLabel="Cancel delete"
              onCancel={() => {
                setConfirmDelete(false);
                setDeleteError(null);
              }}
              confirmLabel="Confirm delete"
              confirmText="Delete"
              busyText="Deleting…"
              danger
              busy={deleting}
              onConfirm={() => void deleteEntry()}
            />
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}

function AddEntryModal({
  theme,
  layout,
  onClose,
  onSaved,
}: {
  theme: Theme;
  layout: Layout;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const styles = useStyles({ theme, layout });
  const setSecret = useRpc(secretsSet);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function save(overwrite: boolean) {
    const problem = nameError(name);
    if (problem) {
      setConfirming(false);
      setError(problem);
      return;
    }
    const valueProblem = valueError(value);
    if (valueProblem) {
      setConfirming(false);
      setError(valueProblem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setSecret({
        name,
        value,
        notes: notes === "" ? undefined : notes,
        overwrite,
      });
      onSaved(name);
    } catch (caught) {
      const body = messageOf(caught);
      if (!overwrite && body.startsWith("EXISTS:")) {
        setConfirming(true);
        return;
      }
      setError(body);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={confirming ? "Replace entry?" : "Add entry"}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Content>
        {confirming ? (
          <View style={styles.form}>
            <Text style={styles.notes}>
              {name} already exists. Replacing it overwrites its value and notes.
            </Text>
            {error ? <Text style={styles.formError}>{error}</Text> : null}
            <ModalActions
              styles={styles}
              cancelLabel="Cancel replace"
              onCancel={() => {
                setConfirming(false);
                setError(null);
              }}
              confirmLabel="Confirm replace"
              confirmText="Replace"
              busyText="Saving…"
              danger
              busy={saving}
              onConfirm={() => void save(true)}
            />
          </View>
        ) : (
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="service/resource"
                placeholderTextColor={theme.colors.foregroundMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Value</Text>
              <TextInput
                value={value}
                onChangeText={setValue}
                placeholder="Secret value"
                placeholderTextColor={theme.colors.foregroundMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Notes</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Optional"
                placeholderTextColor={theme.colors.foregroundMuted}
                multiline
                style={[styles.input, styles.notesInput]}
              />
            </View>
            {error ? <Text style={styles.formError}>{error}</Text> : null}
            <ModalActions
              styles={styles}
              cancelLabel="Cancel add"
              onCancel={onClose}
              confirmLabel="Save entry"
              confirmText="Save"
              busyText="Saving…"
              busy={saving}
              onConfirm={() => void save(false)}
            />
          </View>
        )}
      </Modal.Content>
    </Modal>
  );
}

export function SecretsScreen({ theme, layout }: PluginScreenProps) {
  const styles = useStyles({ theme, layout });
  const listSecrets = useRpc(secretsList);
  const toast = useToast();
  const list = useQuery({
    queryKey: ["secrets", "list"],
    queryFn: () => listSecrets({}),
    retry: false,
  });
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const entries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (list.data?.entries ?? []).filter((entry) =>
      entry.name.toLowerCase().includes(needle),
    );
  }, [list.data, filter]);

  function select(name: string) {
    setSelected(name);
  }

  async function saved(name: string) {
    setAdding(false);
    setFilter("");
    setSelected(name);
    await list.refetch();
    toast.show("Entry saved", { variant: "success" });
  }

  async function deleted() {
    setSelected(null);
    await list.refetch();
  }

  const listPane = (
    <View style={styles.listPane}>
      <View style={styles.filters}>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter entries"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.filter}
        />
        <Action
          icon="Plus"
          label="Add"
          onPress={() => setAdding(true)}
          theme={theme}
        />
      </View>
      {list.error ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{messageOf(list.error)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry listing" onPress={() => void list.refetch()}>
            <Text style={styles.link}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {list.isPending ? <Text style={styles.placeholderText}>Loading entries…</Text> : null}
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.name}
        style={{ flex: 1 }}
        ListEmptyComponent={
          list.isPending || list.error ? null : (
            <Text style={styles.placeholderText}>
              {filter.trim() === "" ? "No entries in this store." : "No entries match the filter."}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}`}
            onPress={() => select(item.name)}
            style={({ pressed }) => [
              styles.row,
              selected === item.name ? styles.rowSelected : null,
              pressed ? styles.rowSelected : null,
            ]}
          >
            <Icon name="KeyRound" size={15} color={theme.colors.foregroundMuted} />
            <Text numberOfLines={1} style={styles.rowName}>
              {item.name}
            </Text>
            <Text style={styles.rowMeta}>{item.bytes} B</Text>
          </Pressable>
        )}
      />
    </View>
  );

  const detail = selected ? (
    <EntryDetail
      key={selected}
      name={selected}
      theme={theme}
      layout={layout}
      onClose={layout.compact ? () => setSelected(null) : null}
      onDeleted={() => void deleted()}
    />
  ) : (
    <View style={styles.placeholder}>
      <Icon name="KeyRound" size={28} color={theme.colors.foregroundMuted} />
      <Text style={styles.placeholderText}>Select an entry to see its value and notes.</Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      {layout.compact && selected ? (
        <View style={styles.body}>{detail}</View>
      ) : (
        <View style={styles.body}>
          {listPane}
          {layout.compact ? null : detail}
        </View>
      )}
      {adding ? (
        <AddEntryModal
          theme={theme}
          layout={layout}
          onClose={() => setAdding(false)}
          onSaved={(name) => void saved(name)}
        />
      ) : null}
    </View>
  );
}
