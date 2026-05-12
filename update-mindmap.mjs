import fs from 'fs';
const path = 'src/extension.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  /const options = \{[\s\S]*?theme: \{ name: prefersDark \? 'Dark' : 'Latte' \},\s*\};/,
`const options = {
          el: mapEl,
          direction: MindElixir.SIDE,
          editable: false,
          toolBar: true,
          nodeMenu: false,
          keypress: true,
          theme: { name: prefersDark ? 'Dark' : 'Latte' },
        };`
);

fs.writeFileSync(path, code);
