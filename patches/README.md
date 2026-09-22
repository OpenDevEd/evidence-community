# Dependency patches

## Citation.js export fixes

The BibTeX 0.9.0 patch keeps Unicode text, escapes TeX characters in literal
names, and includes abstracts, languages, keywords and translators through the
package's existing field converters. The RIS 0.9.0 patch preserves report
editors and translators and removes hard line wrapping that split words during
reimport. Both installed module builds are patched. Citation formatting and
export tests exercise the generated files and reimport their metadata.

## NextUI

These patches backport HeroUI v2 fixes to the locked NextUI packages. They keep
the current component styles and application wrappers. `npm ci` applies them
through the existing `patch-package` postinstall command.

| Packages | Upstream fix |
| --- | --- |
| Tooltip | [#4482](https://github.com/heroui-inc/heroui/pull/4482), released in `@heroui/tooltip@2.2.14`. Keep LazyMotion outside AnimatePresence and use stable animation keys. Includes that release's React 19 trigger-ref fix. |
| aria-utils, Popover, Tooltip, Modal, Select, Autocomplete, Dropdown, DatePicker, use-aria-modal-overlay, use-aria-multiselect, use-aria-button | [#5100](https://github.com/heroui-inc/heroui/pull/5100). Replace the global focus-scope count with the shared overlay stack and upstream pointer handling. The hook is the published `@heroui/use-aria-overlay@2.0.6` implementation, including [#5529](https://github.com/heroui-inc/heroui/pull/5529) and [#5624](https://github.com/heroui-inc/heroui/pull/5624). |
| Select | [#4849](https://github.com/heroui-inc/heroui/pull/4849), released in `@heroui/select@2.4.11`. Prevent page scrolling while the select is open. |
| Tabs, theme | [#5705](https://github.com/heroui-inc/heroui/pull/5705), [#5816](https://github.com/heroui-inc/heroui/pull/5816), and [#5846](https://github.com/heroui-inc/heroui/pull/5846). Replace the shared Framer Motion cursor with the upstream measured cursor, including resize handling. Theme changes are limited to cursor positioning, visibility and transitions. |

The shared overlay hook lives in the existing aria-utils package so all callers
use one stack without upgrading React Aria or the theme. Its added dependencies
already exist at the specified versions in the lockfile. Both ESM and CommonJS
entry points are patched, along with their type declarations.

The existing Select disabled-button fix and FreeSoloPopover exit cleanup remain.
The old Popover accessibility-hiding workaround is superseded by upstream's
removal of the redundant effect.

`tests/e2e/admin.spec.ts` covers tooltip cleanup, nested selects, adjacent
popovers, dropdown-to-dialog transitions, Tabs inside dialogs, and touch input
under `overlay lifecycle`. These tests use the real admin components and mock
only their API data, following the existing admin browser fixtures.
