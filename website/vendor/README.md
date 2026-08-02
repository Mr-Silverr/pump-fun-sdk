# website/vendor

Third-party browser libraries used by the documentation reader, vendored so the
site stays a zero-build, zero-CDN static bundle. Nothing here is edited by hand
except the one documented transform below.

| File | Package | Version | License |
|------|---------|---------|---------|
| `marked.esm.js` | [marked](https://www.npmjs.com/package/marked) | 18.0.7 | MIT (`LICENSE.marked`) |
| `purify.es.mjs` | [dompurify](https://www.npmjs.com/package/dompurify) | 3.4.12 | Apache-2.0 / MPL-2.0 (`LICENSE.dompurify`) |
| `highlight-core.mjs`, `lang-*.mjs` | [highlight.js](https://www.npmjs.com/package/highlight.js) | 11.11.1 | BSD-3-Clause (`LICENSE.highlightjs`) |
| `hljs.mjs` | ours | - | MIT (repo license) |

`marked` parses documentation markdown, `DOMPurify` sanitizes the resulting HTML
before it reaches the DOM, and `highlight.js` colors fenced code blocks.
`hljs.mjs` is our loader: it registers only the languages the docs use.

All three are ES modules loaded with a dynamic `import()` the first time a
document opens, so the landing page downloads none of them.

## Refreshing a vendored copy

```bash
cd website/vendor
npm pack marked dompurify highlight.js --pack-destination /tmp/pumpvendor
mkdir -p /tmp/pumpvendor/x && for t in /tmp/pumpvendor/*.tgz; do tar xzf "$t" -C /tmp/pumpvendor/x --one-top-level="$(basename "$t" .tgz)"; done

cp /tmp/pumpvendor/x/marked-*/package/lib/marked.esm.js marked.esm.js
cp /tmp/pumpvendor/x/dompurify-*/package/dist/purify.es.mjs purify.es.mjs
for l in typescript javascript bash json rust xml; do
  cp /tmp/pumpvendor/x/highlight.js-*/package/es/languages/$l.js lang-$l.mjs
done
```

highlight.js ships no browser-ready ESM core (`es/core.js` re-exports the CommonJS
`lib/core.js`), so `highlight-core.mjs` is `lib/core.js` with its single CommonJS
export line swapped for an ESM one. Reproduce it exactly:

```bash
node -e '
const fs = require("fs");
const src = fs.readFileSync("/tmp/pumpvendor/x/highlight.js-11.11.1/package/lib/core.js", "utf8");
const needle = "module.exports = highlight;";
if (!src.includes(needle)) throw new Error("core.js export shape changed");
fs.writeFileSync("highlight-core.mjs", src.replace(needle, "export default highlight;"));
'
```

After refreshing, bump the versions in the table above and open a doc page to
confirm markdown, sanitization, and highlighting all still work.
