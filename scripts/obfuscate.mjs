import * as esbuild from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const tmpBundle = path.join(root, '.obf-bundle.js');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  outfile: tmpBundle,
  external: ['three', 'three/*'],
  minify: true,
  legalComments: 'none',
  target: 'es2022'
});

const source = fs.readFileSync(tmpBundle, 'utf8');
// Không mã hóa chuỗi và không bẻ luồng điều khiển: mỗi lần đọc chuỗi sẽ giải mã lại,
// vòng mô phỏng vải mỗi khung hình sẽ giật. Chỉ đổi tên định danh.
const result = JavaScriptObfuscator.obfuscate(source, {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  ignoreImports: true,
  numbersToExpressions: false,
  renameGlobals: false,
  renameProperties: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: false,
  transformObjectKeys: false,
  unicodeEscapeSequence: false
});

fs.writeFileSync(path.join(dist, 'game.js'), result.getObfuscatedCode());
fs.rmSync(tmpBundle, { force: true });

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace('./src/main.js', './game.js');
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.copyFileSync(path.join(root, 'styles.css'), path.join(dist, 'styles.css'));

const assetsDest = path.join(dist, 'assets');
fs.cpSync(path.join(root, 'assets'), assetsDest, { recursive: true });

const out = fs.readFileSync(path.join(dist, 'game.js'), 'utf8');
const leaked = ['tearPatch', 'consumePullTear', 'DiamondFishnetStocking', 'character.glb'].filter((name) => out.includes(name));
const kb = (out.length / 1024).toFixed(0);
console.log(`dist/game.js ${kb} KB`);
if (leaked.length) {
  console.warn('Còn chuỗi đọc được:', leaked.join(', '));
} else {
  console.log('Không còn tên hàm hay đường dẫn model ở dạng chữ thường.');
}
