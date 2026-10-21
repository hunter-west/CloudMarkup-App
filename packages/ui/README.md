# `@cloudmarkup/ui`

Provider-neutral Cloud Markup tokens and accessible reusable React primitives.
The package follows [ADR-0014](../../docs/adr/0014-design-system-ownership.md)
and the [design-system specification](../../docs/design/DESIGN_SYSTEM.md).

The geometric mark and `CloudMarkup` text in `BrandLockup` are provisional shell
assets, not final brand art. Provider-neutral icon abstractions and the neutral
fallback glyph may live here, but provider-owned artwork and provider semantics
may not. This package also contains no domain rules, authorization decisions,
billing logic, or architecture semantics.

## Public imports

```tsx
import {
  BrandLockup,
  ModalDrawer,
  StatePanel,
  StatusBadge,
  Tabs,
  ToastViewport,
} from "@cloudmarkup/ui";
import "@cloudmarkup/ui/styles.css";
```

The package root and stylesheet are the only public import paths. The package
exports source entry points so Vite can consume workspace changes without a
separate prebuild; `build` still emits distributable JavaScript and declarations
as verification evidence.

## Density

Set `data-cm-density="comfortable"` or `data-cm-density="compact"` on an
application ancestor. Density changes spacing and control size only. It does not
change component actions or product meaning.
