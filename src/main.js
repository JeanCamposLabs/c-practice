import {Compartment, EditorState} from '@codemirror/state';
import {EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {bracketMatching, indentOnInput, foldGutter, syntaxHighlighting, defaultHighlightStyle} from '@codemirror/language';
import {closeBrackets, closeBracketsKeymap, autocompletion} from '@codemirror/autocomplete';
import {searchKeymap, highlightSelectionMatches} from '@codemirror/search';
import {cpp} from '@codemirror/lang-cpp';
import {oneDark} from '@codemirror/theme-one-dark';
import {lessons, welcomeCode} from './lessons.js';
import './style.css';

const $ = id => document.getElementById(id);
const STORAGE = 'jean-c-practice-v1';
let storageAvailable = true;
let state = {files: {'main.c': welcomeCode}, active: 'main.c', stdin: '', args: '', standard: 'c17', theme: 'light', completed: [], selectedLesson: null};
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE));
  if (saved && validFiles(saved.files)) state = {...state, ...saved, completed: Array.isArray(saved.completed) ? saved.completed : []};
} catch { storageAvailable = false; }
if (!state.files[state.active] && state.files[state.active] !== '') state.active = Object.keys(state.files)[0];
if (!['c99', 'c11', 'c17', 'c23'].includes(state.standard)) state.standard = 'c17';
if (!['light', 'dark'].includes(state.theme)) state.theme = 'light';
let switchingFile = false;
let saveTimer;
let worker, ready = false, pending = null, busy = false, waitingInput = false;
let operationTimer, compiledSignature = null, executableName = 'main', inputBuffer;
let programOutput = '', outputBytes = 0, phase = 'idle', currentLesson = state.selectedLesson;
let runContext = null;
let commandHistory = [], historyIndex = 0, historyDraft = '';
let toastTimer;
let compiledBinary = null;
const theme = new Compartment();
const editorTheme = () => state.theme === 'dark' ? oneDark : syntaxHighlighting(defaultHighlightStyle);
document.documentElement.dataset.theme = state.theme;

function validFiles(files) {
  return files && typeof files === 'object' && !Array.isArray(files) && Object.keys(files).length > 0 && Object.entries(files).every(([name, content]) => /^[\w-]+\.(c|h)$/.test(name) && typeof content === 'string');
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4000); }
function save() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); storageAvailable = true; $('save-status').textContent = 'All changes saved'; $('saved-dot').classList.remove('unsaved'); }
  catch { storageAvailable = false; $('save-status').textContent = 'Storage full — download a backup'; }
}
function saveSoon() { $('save-status').textContent = 'Saving…'; $('saved-dot').classList.add('unsaved'); clearTimeout(saveTimer); saveTimer = setTimeout(save, 350); }
function cursorStatus(view) { const at = view.state.selection.main.head; const line = view.state.doc.lineAt(at); $('cursor-position').textContent = `Ln ${line.number}, Col ${at - line.from + 1}`; }
const editorExtensions = [
    lineNumbers(), foldGutter(), history(), drawSelection(), indentOnInput(), bracketMatching(), closeBrackets(), autocompletion(),
    highlightActiveLine(), highlightActiveLineGutter(), highlightSelectionMatches(), cpp(), theme.of(editorTheme()),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
    EditorState.tabSize.of(4),
    EditorView.updateListener.of(update => {
      if (update.docChanged && !switchingFile) { state.files[state.active] = update.state.doc.toString(); saveSoon(); }
      if (update.selectionSet || update.docChanged) cursorStatus(update.view);
    }),
    EditorView.contentAttributes.of({'aria-label': 'C source code', spellcheck: 'false'}),
    EditorView.theme({'&': {height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)'}, '&.cm-focused': {outline: 'none'}, '.cm-scroller': {overflow: 'auto', fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize: '14px', lineHeight: '1.8'}, '.cm-content': {padding: '22px 0', caretColor: 'var(--text)'}, '.cm-gutters': {backgroundColor: 'var(--bg)', border: 'none', color: 'var(--muted)', padding: '0 12px'}, '.cm-activeLine': {backgroundColor: 'var(--chrome)'}, '.cm-activeLineGutter': {backgroundColor: 'var(--chrome)'}, '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {backgroundColor: 'var(--selection)'}, '.cm-cursor': {borderLeftColor: 'var(--text)'}, '.cm-panels': {backgroundColor: 'var(--chrome)', color: 'var(--text)'}, '.cm-search input, .cm-search button': {color: 'var(--text)', background: 'var(--bg)'}})
];
const editor = new EditorView({state: EditorState.create({doc: state.files[state.active], extensions: editorExtensions}), parent: $('editor')});
// Reconfigure the document without sharing undo history between different files.
const fileStates = new Map();
function selectFile(name) {
  if (!(name in state.files)) return;
  fileStates.set(state.active, editor.state);
  state.active = name; switchingFile = true;
  const stored = fileStates.get(name);
  if (stored && stored.doc.toString() === state.files[name]) { editor.setState(stored); editor.dispatch({effects: theme.reconfigure(editorTheme())}); }
  else editor.setState(EditorState.create({doc: state.files[name], extensions: editorExtensions}));
  switchingFile = false;
  $('active-filename').textContent = name; cursorStatus(editor); renderFiles(); save();
  $('download-btn').textContent = `Download ${name.endsWith('.h') ? '.h' : '.c'} file`;
}
function renderFiles() {
  $('file-list').replaceChildren();
  Object.keys(state.files).forEach(name => {
    const row = document.createElement('div'); row.className = 'file-row' + (name === state.active ? ' selected' : '');
    const button = document.createElement('button'); button.className = 'file-button'; button.setAttribute('aria-label', name); button.title = name;
    const icon = document.createElement('span'); icon.className = 'c-icon'; icon.textContent = name.endsWith('.h') ? 'H' : 'C';
    const label = document.createElement('span'); label.textContent = name; button.append(icon, label); button.onclick = () => { selectFile(name); $('workspace-dialog').close(); editor.focus(); };
    const remove = document.createElement('button'); remove.className = 'delete-file'; remove.textContent = '×'; remove.title = `Delete ${name}`; remove.setAttribute('aria-label', `Delete ${name}`);
    remove.onclick = () => {
      if (Object.keys(state.files).length === 1) return toast('Keep at least one file in your workspace.');
      if (!confirm(`Delete ${name}? Download a backup first if you want to keep it.`)) return;
      const nextName = Object.keys(state.files).find(n => n !== name);
      if (state.active === name) selectFile(nextName);
      delete state.files[name]; fileStates.delete(name); renderFiles(); save();
    };
    row.append(button, remove); $('file-list').append(row);
  });
}
function print(text, type = 'info') {
  const output = $('terminal-output');
  const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 70;
  const last = output.lastChild;
  if (last && last.dataset.type === type && (type === 'stdout' || type === 'stderr' || type === 'diagnostic')) last.textContent += text;
  else { const span = document.createElement('span'); span.className = `terminal-${type}`; span.dataset.type = type; span.textContent = text; output.append(span); }
  if (output.childNodes.length > 500) output.firstChild.remove();
  if (atBottom) output.scrollTop = output.scrollHeight;
}
function status(text, kind = 'ready') { $('compiler-status').replaceChildren(); const dot = document.createElement('span'); dot.className = 'tiny-dot ' + kind; $('compiler-status').append(dot, document.createTextNode(' ' + text)); }
function buttons() {
  $('compile-btn').disabled = busy || !ready; $('run-btn').disabled = busy || !ready;
  $('binary-btn').disabled = busy || !ready;
  $('stop-btn').disabled = !busy; $('stop-btn').hidden = !busy; $('standard').disabled = busy;
  $('terminal-badge').textContent = waitingInput ? 'INPUT' : busy ? 'RUNNING' : 'READY';
  $('terminal-badge').classList.toggle('is-active', busy);
  // Keep the prompt focusable while running so Ctrl+C can always interrupt.
  $('terminal-input').readOnly = busy && !waitingInput;
  $('terminal-input').placeholder = waitingInput ? 'Type input and press Enter (Ctrl+D ends input)' : 'Type help for commands';
  $('prompt-symbol').textContent = waitingInput ? 'stdin ›' : '❯';
}
function watchdog(ms, message) { clearTimeout(operationTimer); operationTimer = setTimeout(() => stop(message), ms); }
function startWorker() {
  ready = false; buttons();
  worker = new Worker(new URL('compiler-worker.js', document.baseURI), {type: 'module'});
  status('Loading compiler — first visit downloads about 27 MB', 'loading');
  worker.onmessage = ({data}) => {
    if (data.type === 'progress') status(`Loading compiler · ${Math.min(100, data.percent)}%`, 'loading');
    if (data.type === 'status') status(data.text, 'loading');
    if (data.type === 'ready') { ready = true; buttons(); status('Compiler ready'); }
    if (data.type === 'output') {
      if (phase === 'run') { outputBytes += data.text.length; if (data.stream === 'stdout') programOutput += data.text; }
      if (outputBytes > 150000) { stop('Stopped: output exceeded 150 KB. Check for an endless loop.'); return; }
      print(data.text, data.stream);
    }
    if (data.type === 'input') { waitingInput = true; clearTimeout(operationTimer); buttons(); status('Waiting for terminal input', 'loading'); $('terminal-input').focus(); }
    if (data.type === 'preparing-input') { status('Preparing terminal input…', 'loading'); watchdog(90000, 'Terminal input setup timed out. Please run again.'); }
    if (data.type === 'running') { phase = 'run'; status('Program running', 'loading'); watchdog(10000, 'Stopped after 10 seconds of execution. Check for an endless loop.'); }
    if (data.type === 'compiled' || data.type === 'finished') { clearTimeout(operationTimer); const p = pending; pending = null; p?.resolve(data); }
    if (data.type === 'error') {
      clearTimeout(operationTimer); print(`\n${data.text}\n`, 'error'); status('Check the terminal for details', 'error');
      const p = pending; pending = null; const error = new Error(data.text); error.reported = true; p?.reject(error);
      if (!p) { ready = false; buttons(); status('Compiler failed to load — refresh to retry', 'error'); }
    }
  };
  worker.onerror = event => { event.preventDefault(); stop('Compiler worker failed. Refresh the page if this continues.'); };
  worker.postMessage({type: 'load'});
}
function request(type, payload) { return new Promise((resolve, reject) => { pending = {resolve, reject}; worker.postMessage({type, ...payload}); }); }
function stop(message = 'Program stopped.') {
  if (!busy && ready) return;
  clearTimeout(operationTimer); worker?.terminate(); compiledSignature = null; waitingInput = false;
  const p = pending; pending = null; p?.reject(new Error('stopped'));
  busy = false; phase = 'idle'; print(`\n${message}\n`, 'error'); startWorker();
}
function signature() { return JSON.stringify([state.files, state.standard, state.active]); }
async function compile(flags, sources) {
  save(); phase = 'compile'; compiledSignature = null; compiledBinary = null; executableName = 'main'; outputBytes = 0;
  const selectedSources = sources || (state.active.endsWith('.c') ? [state.active] : Object.keys(state.files).filter(n => n.endsWith('.c')));
  if (!selectedSources.length) throw new Error('Create a .c source file first.');
  print(`❯ clang ${selectedSources.join(' ')} ${(flags || [`-std=${state.standard}`, '-Wall', '-Wextra', '-O0']).join(' ')} -lm -o main\n`, 'command');
  watchdog(90000, 'Compilation timed out. The compiler has been restarted.');
  const result = await request('compile', {files: {...state.files}, sources: selectedSources, flags: flags || [`-std=${state.standard}`, '-Wall', '-Wextra', '-O0']});
  compiledSignature = signature(); compiledBinary = result.binary;
  print(`Compiled successfully · ${(result.ms / 1000).toFixed(2)}s · ${(result.size / 1024).toFixed(1)} KB\n`, 'success'); status('Compiled successfully'); return result;
}
async function execute(args) {
  phase = 'run'; programOutput = ''; outputBytes = 0; waitingInput = false;
  const live = $('interactive').checked;
  inputBuffer = live && globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(65544) : null;
  runContext = {lesson: currentLesson, input: state.stdin, source: state.files[state.active]};
  print(`❯ ./${executableName}${args?.length ? ' ' + args.join(' ') : ''}\n`, 'command');
  watchdog(10000, 'Stopped after 10 seconds of execution. Check for an endless loop.');
  const stdin = state.stdin && !state.stdin.endsWith('\n') ? state.stdin + '\n' : state.stdin;
  const result = await request('run', {stdin, args: args || splitArgs(state.args), inputBuffer, interactive: live});
  waitingInput = false;
  if (programOutput && !programOutput.endsWith('\n')) print('\n', 'stdout');
  print(`Process exited with code ${result.code} · ${result.ms}ms\n`, result.code === 0 ? 'success' : 'error');
  status(result.code === 0 ? 'Program finished successfully' : `Program exited with code ${result.code}`, result.code === 0 ? 'ready' : 'error');
  if (result.code === 0) checkLesson(); return result;
}
async function withBusy(action) {
  if (busy) return;
  if (!ready) return toast('The compiler is still loading.');
  busy = true; buttons();
  try { await action(); }
  catch (error) { if (error.message !== 'stopped' && !error.reported) print(error.message + '\n', 'error'); }
  finally { busy = false; waitingInput = false; clearTimeout(operationTimer); phase = 'idle'; buttons(); }
}
function compileOnly() { return withBusy(() => compile()); }
function compileAndRun() { return withBusy(async () => { await compile(); await execute(); }); }
function splitArgs(text) {
  const args = []; let current = '', quote = null, started = false;
  for (const c of text.trim()) {
    if (quote) { if (c === quote) quote = null; else current += c; started = true; }
    else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) { if (started) { args.push(current); current = ''; started = false; } }
    else { current += c; started = true; }
  }
  if (quote) throw new Error('Close the quoted argument first.');
  if (started) args.push(current); return args;
}
async function command(text) {
  const [cmd, ...args] = splitArgs(text);
  if (!cmd) return;
  if (!['run', 'compile', 'clang', 'gcc'].includes(cmd) && !cmd.startsWith('./')) print(`❯ ${text}\n`, 'command');
  if (cmd === 'help') print('Commands:\n  run                 Compile and run the active C file\n  compile             Compile the active C file\n  clang main.c -o main Compile with flags / multiple .c files\n  ./main [arguments]  Run the last compiled program\n  ls                  List workspace files\n  cat main.c          Show a file\n  clear               Clear terminal output\n  pwd                 Show the virtual workspace path\n  help                Show these commands\n\n⌘/Ctrl+Enter runs · ⌘K or Ctrl+L clears · Ctrl+C stops\nCtrl+D ends live input · ↑/↓ browses command history\nCtrl+A/E moves to start/end · Ctrl+U/K deletes before/after cursor\nCtrl+W deletes the previous word · Ctrl+` switches panes\n\nUse the workspace menu for input settings, source and binary downloads.\nThis is a browser practice terminal with the commands above.\n');
  else if (cmd === 'clear') $('terminal-output').replaceChildren();
  else if (cmd === 'ls') print(Object.keys(state.files).join('  ') + '\n');
  else if (cmd === 'pwd') print('/c-practice\n');
  else if (cmd === 'cat') print(args[0] in state.files ? state.files[args[0]] + '\n' : 'File not found. Use ls to see your files.\n');
  else if (cmd === 'run') await compileAndRun();
  else if (cmd === 'compile') await compileOnly();
  else if (cmd === 'clang' || cmd === 'gcc') {
    if (args.includes('--version')) return print('Clang 22.0.0 (YoWASP 22.0.0-git20542-10) · target wasm32-wasi\n');
    const sources = [], flags = []; let out = 'main';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-o') { out = args[++i] || 'main'; continue; }
      if (args[i].endsWith('.c')) { if (!(args[i] in state.files)) throw new Error(`No such file: ${args[i]}`); sources.push(args[i]); }
      else flags.push(args[i]);
    }
    if (cmd === 'gcc') print('Using Clang for this browser workspace (gcc is an alias).\n');
    await withBusy(async () => { await compile([`-std=${state.standard}`, '-Wall', '-Wextra', '-O0', ...flags], sources.length ? sources : undefined); executableName = out; });
  }
  else if (cmd.startsWith('./')) {
    if (!compiledSignature) return print('Compile first with Compile or clang main.c -o main.\n', 'error');
    if (cmd !== './' + executableName) return print(`Executable not found. Try ./${executableName}.\n`, 'error');
    if (compiledSignature !== signature()) print('Note: source changed since compilation. Running the last build. Use run to rebuild.\n', 'info');
    await withBusy(() => execute(args));
  }
  else print(`Unknown command: ${cmd}. Type help for available commands.\n`, 'error');
}
function sendInput(text, eof = false) {
  if (!waitingInput) return;
  const data = new TextEncoder().encode(text + '\n');
  if (data.length > 65536) return toast('Please enter less than 64 KB at once.');
  if (!eof) print(text + '\n', 'input');
  else print('[end of input]\n', 'info');
  waitingInput = false; buttons(); status('Program running', 'loading');
  watchdog(10000, 'Stopped after 10 seconds of execution. Check for an endless loop.');
  if (inputBuffer) {
    const control = new Int32Array(inputBuffer);
    if (!eof) { new Uint8Array(inputBuffer, 8, data.length).set(data); Atomics.store(control, 1, data.length); }
    Atomics.store(control, 0, eof ? 2 : 1); Atomics.notify(control, 0);
  } else worker.postMessage({type: 'stdin', bytes: data, eof});
}
function renderLessons() {
  $('lesson-list').replaceChildren();
  lessons.forEach((lesson, index) => {
    const button = document.createElement('button'); button.className = 'lesson-item' + (index === currentLesson ? ' active' : '') + (state.completed.includes(index) ? ' complete' : '');
    const number = document.createElement('span'); number.className = 'lesson-number'; number.textContent = state.completed.includes(index) ? '✓' : String(index + 1).padStart(2, '0');
    const title = document.createElement('span'); title.textContent = lesson.title; button.append(number, title); button.setAttribute('aria-label', `Exercise ${index + 1}: ${lesson.title}`); button.title = lesson.title; button.onclick = () => showLesson(index); $('lesson-list').append(button);
  });
  $('progress-count').textContent = `${state.completed.length} / ${lessons.length}`; $('path-progress').style.width = `${state.completed.length / lessons.length * 100}%`;
}
function showLesson(index) {
  if (!lessons[index]) return;
  currentLesson = index; state.selectedLesson = index; save(); renderLessons();
  const lesson = lessons[index]; $('workspace-dialog').close();
  if (!$('lesson-panel').open) $('lesson-panel').showModal();
  $('lesson-content').innerHTML = `<div class="lesson-kicker">EXERCISE ${String(index + 1).padStart(2, '0')} / 08</div><h2></h2><p class="lesson-description"></p><div class="concept-card"><span>THE IDEA</span><p></p></div><h3>Your challenge</h3><p class="lesson-task"></p><div class="expected-label">EXPECTED OUTPUT</div><pre class="expected-output"></pre><button id="load-lesson" class="primary-button">Open starter file <span>↗</span></button><p class="starter-note">Opens in a separate file. Your other files stay saved.</p><details class="hint"><summary>Need a hint?</summary><p></p></details><div id="lesson-result"></div><div class="lesson-bottom">${lesson.tag}</div>`;
  const panel = $('lesson-content'); panel.querySelector('h2').textContent = lesson.title; panel.querySelector('.lesson-description').textContent = lesson.description; panel.querySelector('.concept-card p').textContent = lesson.concept; panel.querySelector('.lesson-task').textContent = lesson.task; panel.querySelector('.expected-output').textContent = lesson.expected; panel.querySelector('.hint p').textContent = lesson.hint;
  $('load-lesson').onclick = () => {
    const name = `exercise-${String(index + 1).padStart(2, '0')}.c`;
    if (!(name in state.files)) state.files[name] = lesson.starter;
    selectFile(name); state.stdin = lesson.input; $('stdin').value = lesson.input; save();
    $('lesson-panel').close(); toast('Starter opened. Complete the challenge, then Run.'); editor.focus();
  };
}
function checkLesson() {
  if (runContext?.lesson == null || runContext.lesson !== currentLesson) return;
  const expectedFile = `exercise-${String(currentLesson + 1).padStart(2, '0')}.c`;
  if (state.active !== expectedFile || runContext.source !== state.files[expectedFile]) return;
  const lesson = lessons[currentLesson];
  const normalize = s => s.replace(/\r\n/g, '\n').trimEnd();
  const passed = normalize(programOutput) === normalize(lesson.expected);
  if (passed) {
    if (!state.completed.includes(currentLesson)) state.completed.push(currentLesson);
    save(); renderLessons(); print('✓ Output matches the exercise example. Try another input to explore.\n', 'success');
  } else print('Exercise output differs from the example. Compare it with the expected output in the lesson.\n', 'info');
  const result = $('lesson-result'); if (result) { result.textContent = passed ? '✓ Example passed. Keep experimenting!' : 'Try again — compare the output above.'; result.className = passed ? 'passed' : 'try-again'; }
}
function download(name, content, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], {type: mime})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function clearTerminal() { $('terminal-output').replaceChildren(); }
function saveShortcut() { save(); toast(storageAvailable ? 'Saved in this browser' : 'Storage unavailable. Download a backup.'); }
// Capture workspace shortcuts before editor bindings or browser defaults consume them.
window.addEventListener('keydown', event => {
  if (event.isComposing || document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase();
  const mod = (event.metaKey || event.ctrlKey) && !event.altKey;
  if (mod && key === 'enter') { event.preventDefault(); event.stopPropagation(); event.shiftKey ? compileOnly() : compileAndRun(); }
  else if (event.metaKey && !event.ctrlKey && !event.altKey && key === 'k') { event.preventDefault(); event.stopPropagation(); clearTerminal(); }
  else if (mod && key === 's') { event.preventDefault(); event.stopPropagation(); saveShortcut(); }
  else if (event.ctrlKey && !event.metaKey && !event.altKey && key === 'l' && document.activeElement?.closest('.console-panel')) { event.preventDefault(); event.stopPropagation(); clearTerminal(); }
  else if (event.ctrlKey && !event.metaKey && !event.altKey && key === 'c' && busy) { event.preventDefault(); event.stopPropagation(); stop(); }
  else if (event.ctrlKey && !event.metaKey && event.code === 'Backquote') { event.preventDefault(); event.stopPropagation(); document.activeElement?.closest('.console-panel') ? editor.focus() : $('terminal-input').focus(); }
}, true);
function recallCommand(direction) {
  const input = $('terminal-input');
  if (historyIndex === commandHistory.length) historyDraft = input.value;
  historyIndex = Math.max(0, Math.min(commandHistory.length, historyIndex + direction));
  input.value = historyIndex === commandHistory.length ? historyDraft : commandHistory[historyIndex];
  input.setSelectionRange(input.value.length, input.value.length);
}
$('run-btn').onclick = compileAndRun; $('compile-btn').onclick = compileOnly; $('stop-btn').onclick = () => stop();
$('clear-btn').onclick = clearTerminal;
$('binary-btn').onclick = () => {
  $('workspace-dialog').close();
  return withBusy(async () => {
    if (!compiledBinary || compiledSignature !== signature()) await compile();
    download(`${executableName.replace(/\.wasm$/, '')}.wasm`, compiledBinary, 'application/wasm');
    toast('WASI WebAssembly binary downloaded.');
  });
};
$('workspace-btn').onclick = () => $('workspace-dialog').showModal();
$('close-workspace').onclick = () => $('workspace-dialog').close();
$('stdin').value = state.stdin; $('arguments').value = state.args; $('standard').value = state.standard; $('active-filename').textContent = state.active;
$('download-btn').textContent = `Download ${state.active.endsWith('.h') ? '.h' : '.c'} file`;
$('editor-standard').textContent = state.standard.toUpperCase(); $('theme').value = state.theme;
$('theme').onchange = event => {
  state.theme = event.target.value; document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]').content = state.theme === 'dark' ? '#191c21' : '#fafafa';
  editor.dispatch({effects: theme.reconfigure(editorTheme())}); save();
};
$('stdin').oninput = event => { state.stdin = event.target.value; saveSoon(); };
$('arguments').oninput = event => { state.args = event.target.value; saveSoon(); };
$('standard').onchange = event => { state.standard = event.target.value; $('editor-standard').textContent = state.standard.toUpperCase(); save(); };
$('terminal-form').onsubmit = async event => {
  event.preventDefault(); const text = $('terminal-input').value; $('terminal-input').value = '';
  if (waitingInput) return sendInput(text);
  if (busy) return;
  if (text.trim()) commandHistory.push(text); historyIndex = commandHistory.length; historyDraft = '';
  try { await command(text); } catch (error) { print(error.message + '\n', 'error'); }
};
$('terminal-input').onkeydown = event => {
  if (event.isComposing) return;
  const input = event.currentTarget, key = event.key.toLowerCase();
  if (event.ctrlKey && !event.metaKey && !event.altKey) {
    if (key === 'd' && waitingInput) { event.preventDefault(); sendInput('', true); return; }
    if (key === 'c') { event.preventDefault(); input.value = ''; historyIndex = commandHistory.length; historyDraft = ''; return; }
    if (!waitingInput && (key === 'p' || key === 'n')) { event.preventDefault(); recallCommand(key === 'p' ? -1 : 1); return; }
    const start = input.selectionStart, end = input.selectionEnd;
    if (key === 'a' || key === 'e') { event.preventDefault(); const at = key === 'a' ? 0 : input.value.length; input.setSelectionRange(at, at); }
    if (!input.readOnly && ['u', 'k', 'w'].includes(key)) {
      event.preventDefault();
      const from = key === 'k' ? start : key === 'u' ? 0 : start - (input.value.slice(0, start).match(/\S+\s*$/)?.[0].length || start);
      const to = key === 'k' ? input.value.length : end;
      input.setRangeText('', from, to, 'start');
    }
  }
  if (!busy && !event.metaKey && !event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); recallCommand(event.key === 'ArrowUp' ? -1 : 1); }
};
$('new-file').onclick = () => { $('workspace-dialog').close(); $('file-name').value = ''; $('file-dialog').showModal(); $('file-name').focus(); };
$('cancel-file').onclick = () => $('file-dialog').close();
$('file-form').onsubmit = event => {
  event.preventDefault(); const name = $('file-name').value.trim();
  if (!/^[\w-]+\.(c|h)$/.test(name)) return toast('Use a simple filename ending in .c or .h.');
  if (name in state.files) return toast('That file already exists.');
  state.files[name] = name.endsWith('.h') ? '#pragma once\n\n' : '#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n';
  selectFile(name); $('file-dialog').close(); editor.focus();
};
$('download-btn').onclick = () => download(state.active, state.files[state.active]);
$('backup-btn').onclick = () => { save(); download('c-practice-backup.json', JSON.stringify({...state, version: 1}, null, 2), 'application/json'); };
$('import-btn').onclick = () => $('import-file').click();
$('import-file').onchange = async event => {
  for (const file of event.target.files) {
    if (file.size > 2 * 1024 * 1024) { toast('Please import files smaller than 2 MB.'); continue; }
    const text = await file.text();
    if (file.name.endsWith('.json')) {
      try {
        const backup = JSON.parse(text); if (!validFiles(backup.files)) throw new Error();
        if (!confirm('Restore this backup? Files with matching names will be replaced.')) continue;
        state.files = {...state.files, ...backup.files}; state.completed = [...new Set([...state.completed, ...(Array.isArray(backup.completed) ? backup.completed.filter(n => Number.isInteger(n) && n >= 0 && n < lessons.length) : [])])];
        fileStates.clear(); selectFile(backup.active in state.files ? backup.active : state.active); renderLessons(); save(); toast('Workspace restored.');
      } catch { toast('That file is not a valid workspace backup.'); }
    } else if (/^[\w-]+\.(c|h)$/.test(file.name)) {
      if (file.name in state.files && !confirm(`Replace ${file.name}?`)) continue;
      state.files[file.name] = text; fileStates.delete(file.name); selectFile(file.name);
    } else toast('Use .c, .h, or a workspace .json backup.');
  }
  event.target.value = '';
};
$('reference-btn').onclick = () => { $('workspace-dialog').close(); $('reference-dialog').showModal(); }; $('close-reference').onclick = () => $('reference-dialog').close();
$('close-lesson').onclick = () => $('lesson-panel').close();
window.addEventListener('beforeunload', save);
renderFiles(); renderLessons(); cursorStatus(editor);
if (!storageAvailable) toast('Browser storage is unavailable. Download your code before leaving.');
$('interactive').checked = true;
$('input-mode-note').textContent = 'Type directly in the terminal when prompted. Turn off to use only preloaded input.';
startWorker();
