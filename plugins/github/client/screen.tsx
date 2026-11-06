import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { openExternalUrl, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import type { Feed, Item } from "../shared/github";
import {
  githubCollaborators,
  githubConfigRead,
  githubList,
  githubRequestReview,
  sameLogin,
} from "../shared/github";
import { messageOf, refreshFeed, setupText, useFeed } from "./data";
import {
  existingSession,
  projectsByRepo,
  startSession,
  type ProjectMatch,
} from "./sessions";
import {
  ageLabel,
  aggregateChip,
  checksLabel,
  isAgeDanger,
  isAuthored,
  itemChips,
  mergeableLabel,
  reviewStateLabel,
  type Chip,
} from "./view";

interface ScreenProps extends PluginScreenProps {
  openSettings(): void;
}

let cachedSelected: string | null = null;
let cachedBotsOpen = false;
let cachedIssuesOpen = false;

const EMPTY_GROUPS: Feed["groups"] = {
  yourPrs: [],
  incoming: [],
  bots: [],
  myIssues: [],
};

function toneColor(theme: PluginTheme, tone: Chip["tone"]): string {
  if (tone === "good") return theme.colors.statusSuccess;
  if (tone === "warn") return theme.colors.statusWarning;
  if (tone === "danger") return theme.colors.statusDanger;
  return theme.colors.foregroundMuted;
}

function ChipView({ chip, theme }: { chip: Chip; theme: PluginTheme }) {
  const color = toneColor(theme, chip.tone);
  return (
    <View
      style={{
        borderColor: color,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color, fontSize: 10, fontWeight: "600" }}>{chip.text}</Text>
    </View>
  );
}

function Avatar({
  login,
  avatarUrl,
  size = 24,
}: {
  login: string;
  avatarUrl: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "#8b949e",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#ffffff", fontSize: size * 0.45, fontWeight: "700" }}>
        {login.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

function ItemRow({
  item,
  feed,
  owners,
  selected,
  theme,
  onPress,
}: {
  item: Item;
  feed: Feed;
  owners: readonly string[];
  selected: boolean;
  theme: PluginTheme;
  onPress(): void;
}) {
  const chips = itemChips(item, feed.viewer, owners);
  const waiting = item.kind === "pull_request" ? item.requestedReviewers : [];
  const age = ageLabel(item.updatedAt);
  const ageColor = isAgeDanger(item.updatedAt)
    ? theme.colors.statusDanger
    : theme.colors.foregroundMuted;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        backgroundColor: selected ? theme.colors.surface2 : theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 10,
        padding: 10,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Avatar login={item.author.login} avatarUrl={item.author.avatarUrl} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}
          >
            {item.key}
          </Text>
          <Text numberOfLines={2} style={{ color: theme.colors.foreground, fontSize: 13 }}>
            {item.title}
          </Text>
        </View>
        <Text style={{ color: ageColor, fontSize: 11 }}>{age}</Text>
      </View>

      {chips.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {chips.map(function (chip, index) {
            return <ChipView key={`${chip.text}-${index}`} chip={chip} theme={theme} />;
          })}
        </View>
      ) : null}

      {waiting.length > 0 ? (
        <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          Waiting on{" "}
          {waiting
            .map(function (reviewer) {
              return reviewer.login;
            })
            .join(", ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Group({
  title,
  count,
  empty,
  open,
  onToggle,
  alwaysShow,
  hideCount,
  children,
  theme,
}: {
  title: string;
  count: number;
  empty?: string;
  open?: boolean;
  onToggle?: () => void;
  alwaysShow?: boolean;
  hideCount?: boolean;
  children: ReactNode;
  theme: PluginTheme;
}) {
  const collapsible = typeof onToggle === "function";
  const expanded = !collapsible || open === true;
  const showChildren = count > 0 || alwaysShow === true;

  return (
    <View style={{ gap: 6 }}>
      <Pressable
        accessibilityRole={collapsible ? "button" : undefined}
        disabled={!collapsible}
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "700" }}>
          {title}
        </Text>
        {!hideCount ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{count}</Text>
        ) : null}
        {collapsible ? (
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={theme.colors.foregroundMuted}
          />
        ) : null}
      </Pressable>

      {count === 0 && empty ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{empty}</Text>
      ) : null}
      {showChildren && expanded ? children : null}
    </View>
  );
}

function Section({ title, children, theme }: { title: string; children: ReactNode; theme: PluginTheme }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700" }}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  disabled,
  theme,
}: {
  label: string;
  icon: string;
  onPress(): void;
  disabled?: boolean;
  theme: PluginTheme;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: disabled ? theme.colors.surface2 : theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Icon name={icon} size={14} color={theme.colors.foreground} />
      <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function DetailPane({
  item,
  feed,
  owners,
  project,
  compact,
  onClose,
  theme,
  navigation,
}: {
  item: Item;
  feed: Feed;
  owners: readonly string[];
  project: ProjectMatch | null;
  compact: boolean;
  onClose(): void;
  theme: PluginTheme;
  navigation: PluginScreenProps["navigation"];
}) {
  const paseo = usePaseo();
  const collaboratorsRpc = useRpc(githubCollaborators);
  const requestReviewRpc = useRpc(githubRequestReview);
  const [busy, setBusy] = useState<"agent" | "review" | null>(null);
  const [reviewLogin, setReviewLogin] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerUsers, setPickerUsers] = useState<{ login: string; avatarUrl: string | null }[]>([]);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);

  const authored = isAuthored(item, feed.viewer);

  useEffect(
    function () {
      setPickerOpen(false);
      setActionError(null);
    },
    [item.key],
  );

  useEffect(
    function () {
      if (!pickerOpen || item.kind !== "pull_request") return;
      let alive = true;
      setPickerLoading(true);
      setPickerError(null);
      setPickerUsers([]);
      collaboratorsRpc({ repo: item.repo })
        .then(function (result) {
          if (!alive) return;
          setPickerUsers(
            result.users.filter(function (user) {
              return !sameLogin(user.login, feed.viewer);
            }),
          );
        })
        .catch(function (error: unknown) {
          if (alive) setPickerError(setupText(error) ?? messageOf(error));
        })
        .finally(function () {
          if (alive) setPickerLoading(false);
        });
      return function () {
        alive = false;
      };
    },
    [pickerOpen, item.kind, item.repo, feed.viewer, collaboratorsRpc],
  );

  function openGitHub(): void {
    setActionError(null);
    void openExternalUrl(item.url).catch(function (error: unknown) {
      setActionError(setupText(error) ?? messageOf(error));
    });
  }

  function startAgent(): void {
    const openAgent = navigation?.openAgent;
    if (!openAgent) {
      setActionError("This host cannot open agent sessions.");
      return;
    }
    setBusy("agent");
    setActionError(null);
    existingSession(paseo, item.key)
      .then(function (existing) {
        if (existing) {
          openAgent({ agentId: existing });
          return;
        }
        if (!project) {
          throw new Error("Add this repository as a Paseo project first.");
        }
        return startSession(paseo, item, project).then(function (agentId) {
          openAgent({ agentId });
        });
      })
      .catch(function (error: unknown) {
        setActionError(setupText(error) ?? messageOf(error));
      })
      .finally(function () {
        setBusy(null);
      });
  }

  function pickReviewer(login: string): void {
    if (item.kind !== "pull_request") return;
    setBusy("review");
    setReviewLogin(login);
    setPickerError(null);
    requestReviewRpc({ repo: item.repo, number: item.number, login })
      .then(function () {
        setPickerOpen(false);
        void refreshFeed(true);
      })
      .catch(function (error: unknown) {
        setPickerError(setupText(error) ?? messageOf(error));
      })
      .finally(function () {
        setBusy(null);
        setReviewLogin(null);
      });
  }

  const waiting = item.kind === "pull_request" ? item.requestedReviewers : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 20, fontWeight: "700" }}>
              {item.title}
            </Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              {item.key} · by {item.author.login} · opened {ageLabel(item.createdAt)} ·
              updated {ageLabel(item.updatedAt)} · {item.commentCount} comments
            </Text>
          </View>
          {compact ? (
            <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: 4 }}>
              <Icon name="X" size={18} color={theme.colors.foreground} />
            </Pressable>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {itemChips(item, feed.viewer, owners).map(function (chip, index) {
            return <ChipView key={`${chip.text}-${index}`} chip={chip} theme={theme} />;
          })}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ActionButton label="Open on GitHub" icon="ExternalLink" onPress={openGitHub} theme={theme} />
          <ActionButton
            label={busy === "agent" ? "Starting…" : "Start agent"}
            icon="Play"
            onPress={startAgent}
            disabled={project === null || busy !== null}
            theme={theme}
          />
          {item.kind === "pull_request" ? (
            <ActionButton
              label="Request review"
              icon="UserPlus"
              onPress={function () {
                setPickerOpen(true);
              }}
              disabled={busy !== null}
              theme={theme}
            />
          ) : null}
        </View>

        {project === null ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            Add {item.repo} as a Paseo project to start an agent.
          </Text>
        ) : null}

        {actionError ? (
          <View
            style={{
              backgroundColor: theme.colors.surface1,
              borderColor: theme.colors.statusDanger,
              borderWidth: 1,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{actionError}</Text>
          </View>
        ) : null}

        <Section title="Description" theme={theme}>
          {item.body ? (
            <Markdown>{item.body}</Markdown>
          ) : (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              No description.
            </Text>
          )}
        </Section>

        {item.kind === "pull_request" ? (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
              <Section title="Checks" theme={theme}>
                <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
                  {checksLabel(item.checks)}
                </Text>
              </Section>
              <Section title="Mergeability" theme={theme}>
                <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
                  {mergeableLabel(item.mergeable)}
                </Text>
              </Section>
            </View>

            <Section title="Waiting on" theme={theme}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
                {waiting.length === 0
                  ? "No pending review requests."
                  : waiting
                      .map(function (reviewer) {
                        return reviewer.login;
                      })
                      .join(", ")}
              </Text>
            </Section>

            {authored ? (
              <Section title="Aggregate decision" theme={theme}>
                <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
                  {aggregateChip(item)?.text ?? "No review required"}
                </Text>
              </Section>
            ) : null}

            <Section title="Reviewers" theme={theme}>
              {item.reviews.length === 0 ? (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
                  No reviews yet.
                </Text>
              ) : (
                <View style={{ gap: 6 }}>
                  {item.reviews.map(function (review) {
                    return (
                      <View
                        key={review.login}
                        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                      >
                        <Avatar
                          login={review.login}
                          avatarUrl={review.avatarUrl}
                          size={20}
                        />
                        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
                          {review.login}
                        </Text>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                          {reviewStateLabel(review.state)} · {ageLabel(review.submittedAt)}
                        </Text>
                      </View>
                    );
                  })}
                  {item.reviews.length >= 20 ? (
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                      Showing the latest 20 reviewers; the list may be truncated.
                    </Text>
                  ) : null}
                </View>
              )}
            </Section>
          </>
        ) : null}

        {item.labels.length > 0 ? (
          <Section title="Labels" theme={theme}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              {item.labels.map(function (label) {
                return (
                  <View
                    key={label.name}
                    style={{
                      backgroundColor: theme.colors.surface1,
                      borderColor: `#${label.color}`,
                      borderWidth: 1,
                      borderRadius: 999,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                    }}
                  >
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>
                      {label.name}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Section>
        ) : null}
      </ScrollView>

      {item.kind === "pull_request" ? (
        <Modal
          title={`Request review on ${item.key}`}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
        >
          <Modal.Content>
            {pickerLoading ? (
              <View style={{ padding: 20, alignItems: "center" }}>
                <ActivityIndicator color={theme.colors.accent} />
              </View>
            ) : pickerError ? (
              <Text style={{ color: theme.colors.statusDanger, fontSize: 13 }}>
                {pickerError}
              </Text>
            ) : pickerUsers.length === 0 ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
                No collaborators found.
              </Text>
            ) : (
              pickerUsers.map(function (user) {
                return (
                  <Pressable
                    key={user.login}
                    accessibilityRole="button"
                    disabled={busy !== null}
                    onPress={function () {
                      pickReviewer(user.login);
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingVertical: 8,
                    }}
                  >
                    <Avatar login={user.login} avatarUrl={user.avatarUrl} size={22} />
                    <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
                      {user.login}
                    </Text>
                    {busy === "review" && reviewLogin === user.login ? (
                      <ActivityIndicator size="small" color={theme.colors.accent} />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </Modal.Content>
        </Modal>
      ) : null}
    </View>
  );
}

function SetupState({ message, theme }: { message: string; theme: PluginTheme }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}>
      <Icon name="Github" size={32} color={theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "700" }}>
        GitHub needs setup
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, textAlign: "center" }}>
        {message}
      </Text>
      <View
        style={{
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 12, fontFamily: "monospace" }}>
          gh auth login
        </Text>
      </View>
    </View>
  );
}

export function GitHubScreen({ theme, layout, navigation, openSettings }: ScreenProps) {
  const list = useRpc(githubList);
  const readConfig = useRpc(githubConfigRead);
  const state = useFeed(list);
  const paseo = usePaseo();
  const feed = state.feed;
  const groups = feed?.groups ?? EMPTY_GROUPS;

  const [owners, setOwners] = useState<string[]>([]);
  const [configError, setConfigError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [selectedKey, setSelectedKey] = useState<string | null>(cachedSelected);
  const [botsOpen, setBotsOpen] = useState(cachedBotsOpen);
  const [issuesOpen, setIssuesOpen] = useState(cachedIssuesOpen);
  const [projects, setProjects] = useState<ProjectMatch[]>([]);

  useEffect(
    function () {
      let alive = true;
      readConfig({})
        .then(function (config) {
          if (!alive) return;
          setOwners(config.owners);
          setConfigError(null);
        })
        .catch(function (error: unknown) {
          if (!alive) return;
          setOwners([]);
          setConfigError(setupText(error) ?? messageOf(error));
        });
      return function () {
        alive = false;
      };
    },
    [readConfig, feed?.fetchedAt],
  );

  useEffect(
    function () {
      let alive = true;
      projectsByRepo(paseo)
        .then(function (found) {
          if (!alive) return;
          setProjects(found);
          setProjectsError(null);
        })
        .catch(function (error: unknown) {
          if (!alive) return;
          setProjects([]);
          setProjectsError(messageOf(error));
        });
      return function () {
        alive = false;
      };
    },
    [paseo],
  );

  const allItems = useMemo(
    function () {
      return [...groups.yourPrs, ...groups.incoming, ...groups.bots, ...groups.myIssues];
    },
    [groups],
  );

  const selected =
    selectedKey === null
      ? null
      : allItems.find(function (item) {
          return item.key === selectedKey;
        }) ?? null;

  const project =
    selected === null
      ? null
      : projects.find(function (candidate) {
          return sameLogin(candidate.repo, selected.repo);
        }) ?? null;

  const yourPrs = groups.yourPrs;
  const incoming = groups.incoming;
  const bots = groups.bots;
  const myIssues = groups.myIssues;

  function select(item: Item): void {
    cachedSelected = item.key;
    setSelectedKey(item.key);
  }

  function row(item: Item, currentFeed: Feed) {
    return (
      <ItemRow
        key={item.key}
        item={item}
        feed={currentFeed}
        owners={owners}
        selected={item.key === selectedKey}
        theme={theme}
        onPress={function () {
          select(item);
        }}
      />
    );
  }

  function toggleBots(): void {
    cachedBotsOpen = !botsOpen;
    setBotsOpen(cachedBotsOpen);
  }

  function toggleIssues(): void {
    cachedIssuesOpen = !issuesOpen;
    setIssuesOpen(cachedIssuesOpen);
  }

  if (state.setup !== null && feed === null) {
    return <SetupState message={state.setup} theme={theme} />;
  }

  const banner =
    state.error !== null
      ? setupText(state.error) ?? state.error
      : state.setup ?? configError ?? projectsError;

  const detail =
    selected === null || feed === null ? (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, textAlign: "center" }}>
          Select an item to see its details.
        </Text>
      </View>
    ) : (
      <DetailPane
        item={selected}
        feed={feed}
        owners={owners}
        project={project}
        compact={layout.compact}
        onClose={function () {
          cachedSelected = null;
          setSelectedKey(null);
        }}
        theme={theme}
        navigation={navigation}
      />
    );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomColor: theme.colors.border,
          borderBottomWidth: 1,
        }}
      >
        <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {feed === null
            ? "Not loaded"
            : `Updated ${new Date(feed.fetchedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={state.loading}
          onPress={function () {
            void refreshFeed(true);
          }}
          style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 4 }}
        >
          {state.loading ? (
            <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          ) : (
            <Icon name="RefreshCw" size={14} color={theme.colors.foregroundMuted} />
          )}
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Refresh</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={openSettings}
          style={{ padding: 4 }}
        >
          <Icon name="Settings" size={16} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>

      {banner ? (
        <View
          style={{
            backgroundColor: theme.colors.surface1,
            borderColor: theme.colors.statusDanger,
            borderWidth: 1,
            borderRadius: 8,
            margin: 12,
            padding: 10,
          }}
        >
          <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{banner}</Text>
        </View>
      ) : null}

      {feed === null ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          {state.loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {state.loading ? "Loading GitHub…" : "No feed loaded."}
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1, flexDirection: layout.compact ? "column" : "row" }}>
          <View
            style={{
              flex: 1,
              borderRightColor: theme.colors.border,
              borderRightWidth: layout.compact ? 0 : 1,
            }}
          >
            <ScrollView contentContainerStyle={{ padding: 14, gap: 18 }}>
              <Group
                title="Your PRs"
                count={yourPrs.length}
                empty="No authored pull requests."
                theme={theme}
              >
                {yourPrs.map(function (item) {
                  return row(item, feed);
                })}
              </Group>

              <Group
                title="Incoming"
                count={incoming.length}
                empty="No human items."
                alwaysShow
                theme={theme}
              >
                {incoming.map(function (item) {
                  return row(item, feed);
                })}
                <Group
                  title={`Bots (${bots.length})`}
                  count={bots.length}
                  empty="No bot items."
                  open={botsOpen}
                  onToggle={toggleBots}
                  hideCount
                  theme={theme}
                >
                  {bots.map(function (item) {
                    return row(item, feed);
                  })}
                </Group>
              </Group>

              <Group
                title="My issues"
                count={myIssues.length}
                empty="No authored issues."
                open={issuesOpen}
                onToggle={toggleIssues}
                theme={theme}
              >
                {myIssues.map(function (item) {
                  return row(item, feed);
                })}
              </Group>
            </ScrollView>
          </View>

          {!layout.compact ? <View style={{ flex: 1 }}>{detail}</View> : null}
        </View>
      )}

      {layout.compact && selected !== null ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.colors.surface0,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            overflow: "hidden",
          }}
        >
          {detail}
        </View>
      ) : null}
    </View>
  );
}
