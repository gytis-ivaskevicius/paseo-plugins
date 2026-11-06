import type {
  PluginClientContext,
  PluginScreenProps,
} from "@getpaseo/plugin/client";
import { GitHubScreen } from "./client/screen";
import { GitHubSettings } from "./client/settings";
import { GitHubSidebarItem } from "./client/sidebar-item";

export default function contribute(client: PluginClientContext) {
  function Screen(props: PluginScreenProps) {
    return (
      <GitHubScreen
        {...props}
        openSettings={function () {
          client.openSettings("github");
        }}
      />
    );
  }

  client.addSettingsScreen({
    id: "github",
    title: "GitHub",
    icon: "Github",
    Component: GitHubSettings,
  });
  client.addScreen({ id: "github", title: "GitHub", Component: Screen });
  client.addSidebarHeaderItem({
    id: "github",
    title: "GitHub",
    Component: GitHubSidebarItem,
  });

  return function () {};
}
