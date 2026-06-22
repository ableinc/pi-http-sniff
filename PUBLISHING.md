# Publishing to npm (Production)

This guide is for publishing `pi-http-sniff` as a production Pi package.

## Preconditions

- You have npm publish access to the package name.
- You are logged into npm.
- You have tested locally and the package builds.

## Pi Package Compliance Checklist

Before publishing, confirm these are true in [package.json](package.json):

- `keywords` includes `pi-package`.
- `pi.extensions` points at built extension output: `./dist/index.js`.
- Core Pi package imports are declared in `peerDependencies` with `"*"`.
  - For this package: `@earendil-works/pi-coding-agent: "*"`.
- Runtime build artifacts are included in publish payload via `files`.

## 1. Bump Version

Update package version using one of:

```bash
pnpm version patch
pnpm version minor
pnpm version major
```

## 2. Install and Build

```bash
pnpm install --frozen-lockfile
pnpm build
```

## 3. Verify Tarball Contents

```bash
pnpm pack --pack-destination /tmp
```

Expected files include:

- `dist/index.js`
- `dist/index.d.ts`
- `package.json`
- `README.md`

## 4. npm Authentication

Because this repo enforces `pnpm` in `devEngines`, run npm auth commands outside this repo if needed:

```bash
cd /tmp
npm login
```

## 5. Publish

From repo root:

```bash
cd /home/onyx/programs/node/pi-http-sniff
pnpm publish --access public
```

Optional (recommended for provenance):

```bash
pnpm publish --access public --provenance
```

## 6. Verify Published Package

```bash
cd /tmp
npm view pi-http-sniff version
```

## 7. Verify Install with Pi

Quick test without permanent install:

```bash
pi -e npm:pi-http-sniff@<published-version>
```

Then install permanently:

```bash
pi install npm:pi-http-sniff@<published-version>
```

## Troubleshooting

### EBADDEVENGINES when using npm in repo

If `npm` commands fail with `EBADDEVENGINES` in this project, run them from a neutral directory such as `/tmp`, or use `pnpm` for publish flow.

### Name already taken

If publish fails due to name conflict, switch to a scoped package name, e.g. `@ableinc/pi-http-sniff`, and republish.
