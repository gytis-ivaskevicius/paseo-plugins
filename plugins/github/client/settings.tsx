import { useRpc } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsInput,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { githubConfigRead, githubConfigWrite } from "../shared/github";
import { messageOf, requestRefresh, setupText } from "./data";

export function GitHubSettings() {
  const read = useRpc(githubConfigRead);
  const write = useRpc(githubConfigWrite);
  const [text, setText] = useState("");
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(
    function () {
      let alive = true;
      read({})
        .then(function (config) {
          if (!alive) return;
          setText(config.owners.join(", "));
          setVersion(function (current) {
            return current + 1;
          });
        })
        .catch(function (failure: unknown) {
          if (alive) setError(setupText(failure) ?? messageOf(failure));
        })
        .finally(function () {
          if (alive) setLoading(false);
        });
      return function () {
        alive = false;
      };
    },
    [read],
  );

  function save(): void {
    const owners = text
      .split(",")
      .map(function (owner) {
        return owner.trim();
      })
      .filter(Boolean);

    if (owners.length === 0) {
      setError("Add at least one owner.");
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    write({ owners })
      .then(function (config) {
        setText(config.owners.join(", "));
        setVersion(function (current) {
          return current + 1;
        });
        setSaved(true);
        requestRefresh();
      })
      .catch(function (failure: unknown) {
        setError(setupText(failure) ?? messageOf(failure));
      })
      .finally(function () {
        setSaving(false);
      });
  }

  return (
    <SettingsSection
      title="GitHub worklist"
      info="Owners are logins and organizations whose open pull requests and issues fill Incoming. Your own login is always required."
    >
      <SettingsInput
        key={version}
        label="Owners"
        hint="Comma-separated, for example: your-login, your-org"
        initialValue={text}
        onChangeText={setText}
        disabled={loading || saving}
      />
      <SettingsAction
        label="Owner list"
        actionLabel={saving ? "Saving…" : "Save"}
        onPress={save}
        disabled={loading || saving}
        error={error}
        {...(saved ? { hint: "Saved. The next refresh uses the new list." } : {})}
      />
    </SettingsSection>
  );
}
