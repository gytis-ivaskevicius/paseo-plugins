import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { SecretsScreen } from "./client/secrets";

function SecretsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="KeyRound"
      label="Secrets"
      active={currentScreen?.screenId === "secrets"}
      onPress={() => openScreen({ screenId: "secrets" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "secrets", title: "Secrets", Component: SecretsScreen });
  client.addSidebarHeaderItem({ id: "secrets", title: "Secrets", Component: SecretsItem });
  return () => {};
}
