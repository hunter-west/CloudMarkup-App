# Cloud Markup web brand assets

This directory owns the reviewed Cloud Markup product-brand files used by the
web application. It is deliberately separate from official provider artwork in
`packages/provider-aws/assets` and from provider-neutral interface icons in
`packages/ui`.

## Source record

- Source: supplied directly by the Cloud Markup product owner in the 2026-09-04
  full-functionality and UI request.
- Approved surfaces: Cloud Markup web application, browser favicon, Apple touch
  icon, and web app manifest.
- Canonical local file: `public/cloudmarkup-logo.png`.
- Media type and dimensions: PNG, 1,254 × 1,254 RGBA pixels.
- Byte length: 313,933 bytes.
- SHA-256: `5de84bce69f6348cb1c8a2272c4bc966dcde444c87df0808f48dbae953e70bf6`.
- Transformation: none. The canonical file remains byte-identical to the
  supplied file.

The direct product-owner supply authorizes the stated product use. This record
does not claim an outside legal opinion, provider endorsement, or permission to
mix the mark with provider icons.

## Runtime files

Vite copies only `public/` to the build root. Keeping the runtime files under
this one reviewed source folder makes their public paths stable while leaving
provider assets in their independently governed package.

| File                   | Purpose                       | Derivation                                 | SHA-256                                                            |
| ---------------------- | ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `cloudmarkup-logo.png` | Canonical supplied logo       | None; exact supplied bytes                 | `5de84bce69f6348cb1c8a2272c4bc966dcde444c87df0808f48dbae953e70bf6` |
| `apple-touch-icon.png` | 180 px Apple touch icon       | Pinned local resvg render of canonical PNG | `72821d128eb2a35071c1bcaea0509c8c47278991a09c5c0c579c1f8dc52bacbe` |
| `app-icon-192.png`     | 192 px manifest/browser icon  | Pinned local resvg render of canonical PNG | `095ac95ff35ffd1827f575517d1e21d793d338517eb04b505321ea7dc69124b2` |
| `app-icon-512.png`     | 512 px manifest icon          | Pinned local resvg render of canonical PNG | `e709f179d32d7cf347310deaa7336257aecded9a28efe80c02f3f2e13c47890f` |
| `favicon.ico`          | Root browser/favicon fallback | ICO with 16–256 px PNG renderings          | `642c6ea593ac33a7af644bb6fb3e5fec71abd33b52095b5782b564d14889bcc2` |
| `site.webmanifest`     | Installed-web-app metadata    | Reviewed deterministic JSON                | Verified by the web/release tests                                  |

Run the deterministic byte check after changing this folder:

```powershell
node scripts/generate-cloudmarkup-brand-assets.mjs --check
```

`--write` may be used only after intentionally replacing the canonical source
and updating its reviewed source identity in the generator and this record.
