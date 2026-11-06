import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { githubList } from "../shared/github";
import { useFeed } from "./data";
import { sidebarCount } from "./view";

export function GitHubSidebarItem({
  theme,
  currentScreen,
  openScreen,
}: PluginSidebarItemProps) {
  const list = useRpc(githubList);
  const state = useFeed(list);
  const count = state.feed === null ? 0 : sidebarCount(state.feed);

  return (
    <SidebarRow
      icon="Github"
      label="GitHub"
      active={currentScreen?.screenId === "github"}
      onPress={function () {
        openScreen({ screenId: "github" });
      }}
      trailing={
        state.feed !== null ? (
          <Text
            style={{
              color: state.error ? theme.colors.statusDanger : theme.colors.foregroundMuted,
              fontSize: 12,
            }}
          >
            {count}
          </Text>
        ) : null
      }
    />
  );
}
