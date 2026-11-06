# GitHub item descriptions render as Markdown

## Context

The worklist prints an item body as one flat `Text` block, so headings, emphasis, lists, and code fences appear as literal markup. Paseo's plugin client ships a `Markdown` component in `@getpaseo/plugin/client/ui` that renders a string with the host's theme, selection, code blocks, tables, and link handling. The plugin pins `@getpaseo/plugin` 0.11.0, which predates that component; the daemon runs 0.15.0.

## Acceptance criteria

- an item description containing a heading, bold text, and a bullet list
  - → it renders as a heading, bold text, and bullets
  - → no `#`, `**`, or `-` markers appear in the rendered text

- a description containing a fenced code block
  - → it renders in a code block with its newlines and indentation intact

- a description containing a link
  - → pressing it opens the URL through Paseo's link handling

- a description containing a table or a task list
  - → it renders as a table or a checklist, not as raw markup

- an item with an empty body
  - → the pane shows "No description."

- a description that is not valid Markdown
  - → it renders as text without an error

## Out of scope

- Rendering comments; only the item body is formatted.
- Syntax highlighting beyond what the host component does.
- Any change to how the body is fetched: `body` stays the raw markdown string.

## Assumptions

- The host `Markdown` component over a local parser — rejected after building one: ~200 lines of HTML-to-React-Native code for behaviour the host already provides.
- Bumping the SDK pin to 0.15.0 over copying a renderer — rejected: the component is the smaller diff, and the daemon is already on 0.15.0.

## Notes

- `Markdown` takes a single `children: string` prop and supplies theme, selection, and link behaviour itself, so the plugin passes `item.body` unchanged.
- The dev pin bump applies to `@getpaseo/client`, `@getpaseo/plugin`, and `@getpaseo/protocol` together, with the lockfile regenerated. The same bump lands in `plugins/cron` in this change; `README.md` records the pin-tracks-the-daemon rule so the next plugin does not start three versions behind.
- Starting point: `client/screen.tsx`, the "Description" section.
- Verification: `npm run typecheck` and `npm test` in `plugins/github`, then reload the plugin and open an item with a long body.
