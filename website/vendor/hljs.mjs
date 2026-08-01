// Syntax highlighter for the docs reader. Loaded lazily (dynamic import) the
// first time a documentation page renders, so the landing page stays light.
//
// Languages match what the docs actually use (see `grep '^```' docs/*.md`):
// typescript, bash, json, rust, javascript, html. Anything else falls back to
// plaintext, which highlight.js handles without a language module.
import hljs from './highlight-core.mjs';
import typescript from './lang-typescript.mjs';
import javascript from './lang-javascript.mjs';
import bash from './lang-bash.mjs';
import json from './lang-json.mjs';
import rust from './lang-rust.mjs';
import xml from './lang-xml.mjs';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('xml', xml);

hljs.registerAliases(['ts'], { languageName: 'typescript' });
hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' });
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });

hljs.configure({ ignoreUnescapedHTML: true, throwUnescapedHTML: false });

export default hljs;
