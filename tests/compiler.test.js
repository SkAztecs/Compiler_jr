// Compiler tests: every program is compiled and run on the VM, then checked
// against the original tree-walking interpreter. Run with: npm test
import assert from 'node:assert/strict';
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { generateTarget, runJavaScript } from '../src/compiler/targets.js';
import { explainStep, nextLineStep, previousLineStep, recordExecution, stateAt } from '../src/compiler/debugger.js';
import { compile, runBytecode, runReference, crossCheck } from '../src/compiler/pipeline.js';
import { formatTACInstruction, tacRows } from '../src/compiler/tac.js';
import { bytecodeRows } from '../src/compiler/codegen.js';
import { tokenRows, astTree, traceRows } from '../src/compiler/explorer.js';
import { codeFrame, splitAtCaret } from '../src/compiler/diagnostics.js';
import { translateKeywords } from '../src/compiler/translate.js';
import { LANGUAGE_PACKS } from '../src/languagePacks.js';
import { highlightSegments } from '../src/compiler/highlight.js';
import { completionCandidates, insideTextOrComment, wordBeforeCaret } from '../src/editor/completion.js';
import { DEFAULT_CODE_EXAMPLE } from '../src/constants.js';
import { GUIDE_SECTIONS, NOT_SUPPORTED } from '../src/guide.js';
import { keywordSpellings } from '../src/interpreter/lexer.js';
import { analyzeStaticComplexity, formatCost } from '../src/compiler/complexity.js';
import { adviseComplexity } from '../src/compiler/advisor.js';
import { extractCode, verifySuggestion } from '../src/tutor/verify.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (error) {
        failed++;
        console.log(`  FAIL ${name}\n       ${error.message.split('\n').join('\n       ')}`);
    }
}

// Compiles, runs the optimized and unoptimized bytecode, and requires both to agree
// with the reference interpreter. Optimizing must never make the VM do more work.
function runBoth(source, settings) {
    const compiled = compile(source, settings);
    assert.deepEqual(compiled.analysis.errors, [], 'expected no semantic errors');
    const vm = runBytecode(compiled.bytecode);
    const unoptimized = runBytecode(compiled.unoptimizedBytecode);
    const reference = runReference(compiled.ast);
    const check = crossCheck(vm, reference);
    assert.ok(check.match, `optimized: ${check.differences.join('\n')}`);
    const unoptimizedCheck = crossCheck(unoptimized, reference);
    assert.ok(unoptimizedCheck.match, `unoptimized: ${unoptimizedCheck.differences.join('\n')}`);
    assert.ok(vm.steps <= unoptimized.steps, `optimized ran ${vm.steps} steps, unoptimized ${unoptimized.steps}`);
    return vm;
}

function optimizedTAC(source) {
    return compile(source).optimized.tac.instructions.map(formatTACInstruction);
}

function optimizerPasses(source) {
    return new Set(compile(source).optimized.log.map(change => change.pass));
}

function semanticErrors(source) {
    return compile(source).analysis.errors.map(error => `Line ${error.line}: ${error.message}`);
}

console.log('Cross-check: VM vs reference interpreter');

const crossCheckPrograms = {
    'default example': DEFAULT_CODE_EXAMPLE,
    'arithmetic and precedence': 'print(1 + 2 * 3); print((1 + 2) * 3); print(10 / 4); print(-5 + +2); print(2 - -3);',
    'string joining': 'let name = "Ada"; print("Hi " + name); print("n=" + 3); print(1 + "x"); print(true + "!");',
    'comparisons and equality': 'print(1 < 2); print("a" < "b"); print(3 > 4); print(1 == 1); print("1" == 1); print(true != false);',
    'truthiness: only false is falsy': 'if (0) { print("0 is true"); } if ("") { print("empty is true"); } if (!false) { print("not false"); }',
    'short-circuit && and ||': 'print(false && (1 / 0)); print(true || (1 / 0)); print(true && 5); print(false || 0); print(1 && false);',
    'nested loops': `let total = 0;
for (let i = 0; i < 4; i = i + 1) {
    for (let j = 0; j < i; j = j + 1) {
        total = total + i * j;
    }
}
print(total);`,
    'while loop countdown': 'let n = 5; let fact = 1; while (n > 0) { fact = fact * n; n = n - 1; } print(fact);',
    'else-if chain': `for (let x = 0; x < 4; x = x + 1) {
    if (x == 0) { print("zero"); } else if (x == 1) { print("one"); } else if (x == 2) { print("two"); } else { print("many"); }
}`,
    'block scoping and shadowing': `let x = 1;
{ let x = 2; print(x); { let x = x + 10; print(x); } x = 5; print(x); }
print(x);`,
    'loop body sees outer variable before its own let': `let y = 0;
let k = 0;
while (k < 3) { print(y); let y = k; print(y); k = k + 1; }`,
    'redeclaration in the same scope': 'let a = 1; let a = a + 1; print(a);',
    'assignment as an expression': 'let a = 1; let b = 0; b = a = 7; print(a); print(b); let c = (a = 2) + a; print(c);',
    'left operand read before right side assigns': 'let a = 1; let b = a + (a = 5); print(b); print(a);',
    'for loop with empty parts': 'let i = 0; for (; i < 3;) { i = i + 1; } print(i);',
    'for loop with expression initializer': 'let i = 10; for (i = 0; i < 2; i = i + 1) { print(i); } print(i);',
    'empty program': '',
    'comments and floats': '// a comment\nlet half = 0.5; print(half * 3); // trailing',
    'runtime error: divide by zero': 'let a = 1; print(a); let zero = a - 1; print(a / zero);',
    'runtime error: mixed types not known statically': 'let v = 1; let s = 0; for (let i = 0; i < 2; i = i + 1) { s = v - 1; v = "text"; }',
    'runtime error: runaway loop': 'let i = 0; while (true) { i = i + 1; }',
    'optimizer: constants through a chain of variables': 'let a = 2 * 3 + 4; let b = a * 2; let c = b - a; print(c); print("total: " + (a + b));',
    'optimizer: constant conditions and dead loops': 'if (1 < 2 && true) { print("yes"); } else { print("no"); } while (false) { print("never"); } if (!true || false) { print("nope"); }',
    'optimizer: known values do not leak into loops': 'let x = 1; let n = 0; while (x < 50) { x = x * 2; n = n + 1; } print(x); print(n);',
    'optimizer: value changes after a copy': 'let a = 1; let b = a; a = 2; print(b); print(a); let c = a + (a = 7); print(c);',
    'optimizer: constant runtime errors still happen': 'print("before"); let z = 10 / (5 - 5); print("after");',
    'optimizer: variable that changes type': 'let v = "a"; print(v + 1); v = 1; print(v + 1); v = v + "!"; print(v);',
    'functions: recursion, procedures and loops inside functions': `func fact(n) {
    if (n < 2) { return 1; }
    return n * fact(n - 1);
}
func greet(name) { print("Hello, " + name); }
func sumTo(n) {
    let total = 0;
    for (let i = 1; i < n + 1; i = i + 1) { total = total + i; }
    return total;
}
greet("Ravi");
print(fact(5));
print(sumTo(10) + fact(3));`,
    'functions: mutual recursion': `func isEven(n) { if (n == 0) { return true; } return isOdd(n - 1); }
func isOdd(n) { if (n == 0) { return false; } return isEven(n - 1); }
print(isEven(10));
print(isOdd(7));`,
    'functions: called before they are defined, nested calls': `print(double(add(1, 2)));
let r = add(double(3), 4);
print(r);
func add(a, b) { return a + b; }
func double(x) { return x * 2; }`,
    'functions: each call has its own loop counters': `func count(n) {
    let total = 0;
    for (let i = 0; i < 3; i = i + 1) {
        if (n > 0) { total = total + count(n - 1); }
        total = total + 1;
    }
    return total;
}
print(count(3));`,
    'functions: arguments are worked out left to right': `func show(x) { print(x); return x; }
func pair(a, b) { return a * 10 + b; }
print(pair(show(1), show(2)));`,
    'functions: return from inside a loop': `func firstSquareOver(limit) {
    for (let i = 0; i < 100; i = i + 1) {
        if (i * i > limit) { return i; }
    }
    return -1;
}
print(firstSquareOver(50));
print(firstSquareOver(100000));`,
    'functions: text and true/false as values': `func describe(score) {
    if (score > 50) { return "pass"; }
    return "fail";
}
func both(a, b) { return a && b; }
print(describe(70) + "/" + describe(20));
print(both(true, false));`,
    'runtime error: function ends without its return': `func sign(x) {
    if (x > 0) { return 1; }
}
print(sign(5));
print(sign(-5));`,
    'runtime error: runaway recursion': `func down(n) { return down(n + 1); }
print(down(0));`,
};

for (const [name, source] of Object.entries(crossCheckPrograms)) {
    test(name, () => runBoth(source));
}

test('regional keywords (Tamil)', () => {
    const settings = { letKeyword: 'வை', printKeyword: 'காட்டு', forKeyword: 'சுற்று', ifKeyword: 'என்றால்', elseKeyword: 'இல்லை' };
    const vm = runBoth('வை எண் = 0; சுற்று (வை i = 0; i < 3; i = i + 1) { எண் = எண் + i; } என்றால் (எண் > 2) { காட்டு(எண்); } இல்லை { காட்டு(0); }', settings);
    assert.deepEqual(vm.output, ['3']);
});

test('runtime errors report their source line', () => {
    const vm = runBoth('let a = 1;\nlet b = 0;\nprint(a / b);');
    assert.equal(vm.error.line, 3);
});

console.log('\nSemantic analysis');

test('undefined variable, with a "did you mean"', () => {
    assert.deepEqual(semanticErrors('let total = 1;\nprint(totl);'), [
        "Line 2: 'totl' is not declared. Create it first with 'let totl = ...;'. Did you mean 'total'?",
    ]);
});

test('assigning to an undeclared variable', () => {
    assert.match(semanticErrors('count = 1;')[0], /^Line 1: Cannot assign to 'count' because it is not declared/);
});

test('variable used before its declaration', () => {
    assert.match(semanticErrors('print(x);\nlet x = 1;')[0], /declared later, on line 2/);
});

test('variable used outside its block', () => {
    assert.match(semanticErrors('{ let inner = 1; }\nprint(inner);')[0], /inside a block that has already ended/);
});

test('certain type errors are caught before running', () => {
    assert.deepEqual(semanticErrors('let s = "a";\nprint(s - 1);\nprint(1 < "b");\nprint(-s);\nprint(true + 1);'), [
        "Line 2: Operator '-' needs two numbers, but got string and number.",
        "Line 3: Operator '<' compares two numbers or two strings, but got number and string.",
        "Line 4: Operator '-' needs a number, but got string.",
        "Line 5: Operator '+' adds two numbers or joins text, but got boolean and number.",
    ]);
});

test('types are inferred through reassignment', () => {
    const { analysis } = compile('let x = 1; let y = x; y = y + "!"; print(y);');
    const types = Object.fromEntries(analysis.symbols.map(symbol => [symbol.name, [...symbol.types].sort()]));
    assert.deepEqual(types, { x: ['number'], y: ['number', 'string'] });
});

test('error messages use the regional let keyword', () => {
    const { analysis } = compile('print(x);', { letKeyword: 'वर' });
    assert.match(analysis.errors[0].message, /'वर x = \.\.\.;'/);
});

test('warnings: redeclaration and unused variable', () => {
    const warnings = compile('let a = 1;\nlet a = 2;\nlet unused = 3;\nprint(a);').analysis.warnings.map(w => w.line);
    assert.deepEqual(warnings, [2, 3]);
});

test('shadowed variables get unique IR names', () => {
    const { analysis } = compile('let x = 1; { let x = 2; print(x); } print(x);');
    assert.deepEqual(analysis.symbols.map(symbol => symbol.irName), ['x', 'x@2']);
});

console.log('\nOptimizer');

test('constant folding and propagation compute values at compile time', () => {
    assert.deepEqual(optimizedTAC('let a = 2 * 3 + 4;\nlet b = a * 2;\nprint(b);'), ['a = 10', 'b = 20', 'print 20']);
});

test('an always-false while loop disappears entirely', () => {
    assert.deepEqual(optimizedTAC('while (false) { print("never"); }\nprint("done");'), ['print "done"']);
});

test('if with a constant condition keeps only the branch that runs', () => {
    assert.deepEqual(optimizedTAC('if (1 > 2) { print("no"); } else { print("yes"); }'), ['print "yes"']);
});

test('operations that would fail are not folded away', () => {
    assert.deepEqual(optimizedTAC('print(1 / 0);'), ['t1 = 1 / 0', 'print t1']);
});

test('loop bodies are not given values from before the loop', () => {
    const code = optimizedTAC('let i = 0; while (i < 3) { i = i + 1; }');
    assert.ok(code.includes('t1 = i < 3'), code.join('\n'));
    assert.ok(code.includes('i = i + 1'), code.join('\n'));
});

test('every kind of pass fires on a suitable program', () => {
    const passes = optimizerPasses('let a = 1 + 1; let b = a; if (true) { print(b); } else { print(0); } while (false) { print(a); }');
    for (const pass of ['propagation', 'folding', 'branchFolding', 'unreachable', 'jumpToNext', 'unusedLabel', 'unusedLoopGuard']) {
        assert.ok(passes.has(pass), `missing pass: ${pass}`);
    }
    assert.ok(optimizerPasses('print(1 + 2 * 3);').has('deadTemp'));
    assert.ok(optimizerPasses('let k = 0; while (k < 1) { let c = k; k = c; k = k + 1; }').has('uselessCopy'));
});

console.log('\nLexer and parser');

// The error a compile throws, so its message and position can be checked
function thrownBy(source, settings) {
    try {
        compile(source, settings);
    } catch (error) {
        return { message: error.message, line: error.line, column: error.column, length: error.length };
    }
    throw new Error('expected an error');
}

test('lexer errors point at the character and explain it', () => {
    assert.deepEqual(thrownBy('let a = 1;\nlet b = @;'), {
        message: "Line 2: The character '@' is not part of this language.", line: 2, column: 9, length: 1,
    });
    assert.match(thrownBy('for (let i = 0, i < 3; i = i + 1) {}').message, /use ';'/);
    assert.match(thrownBy('let s = "abc').message, /never ends/);
});

test('parser errors name symbols and point at the token', () => {
    assert.deepEqual(thrownBy('let a = 1;\nprint(a;'), {
        message: "Line 2: Expected ')' here, but found ';'. Every '(' needs a matching ')'.", line: 2, column: 8, length: 1,
    });
});

test('parser hints for common beginner mistakes', () => {
    assert.match(thrownBy('if (true) {\n  print(1);\n').message, /The '\{' on line 1 is never closed/);
    assert.match(thrownBy('print(1); }').message, /no matching '\{'/);
    assert.match(thrownBy('let i = 0; while (i <= 3) { i = i + 1; }').message, /'<=' is not supported/);
    assert.match(thrownBy('1 = x;').message, /use '=='/);
    assert.match(thrownBy('வை = 5;', { letKeyword: 'வை' }).message, /after 'வை'/);
});

test('mistyped keywords and English keywords in another language', () => {
    assert.match(semanticErrors('let x = 1;\npirnt(x);')[0], /Did you mean the keyword 'print'\?/);
    assert.match(semanticErrors('let i = 0;\nwihle (i < 3) { i = i + 1; }')[0], /keyword 'while'/);
    const { analysis } = compile('print(1);', { printKeyword: 'பதிப்பி' });
    assert.match(analysis.errors[0].message, /written 'பதிப்பி'/);
    assert.deepEqual(semanticErrors('print(i);'), ["Line 1: 'i' is not declared. Create it first with 'let i = ...;'."]);
});

test('semantic errors know their column and length', () => {
    const [error] = compile('let count = 1;\nprint(cuont);').analysis.errors;
    assert.deepEqual([error.line, error.column, error.length], [2, 7, 5]);
});

console.log('\nPhase explorer');

test('tokens keep the exact text, including regional keywords', () => {
    const { tokens } = compile('காட்டு("hi" + 12);', { printKeyword: 'காட்டு' });
    assert.deepEqual(tokens.map(token => `${token.type}:${token.lexeme}`), [
        'PRINT:காட்டு', 'LPAREN:(', 'STRING:"hi"', 'PLUS:+', 'NUMBER:12', 'RPAREN:)', 'SEMICOLON:;', 'EOF:',
    ]);
});

test('lexer and parser errors carry their line, and parser errors keep the tokens', () => {
    const lexError = (() => { try { compile('let a = 1;\nlet b = @;'); } catch (e) { return e; } })();
    assert.equal(lexError.line, 2);
    const parseError = (() => { try { compile('let a = 1;\n\nprint(a;'); } catch (e) { return e; } })();
    assert.equal(parseError.line, 3);
    assert.ok(parseError.tokens.length > 0);
});

test('the AST tree labels nodes and records their lines', () => {
    const tree = astTree(compile('let x = 1 + 2;\nwhile (x < 5) {\n  x = x + 1;\n}').ast);
    assert.deepEqual(tree.children.map(child => [child.tree.label, child.tree.line]), [['Let x', 1], ['While', 2]]);
    const whileNode = tree.children[1].tree;
    assert.deepEqual(whileNode.children.map(child => child.edge), ['condition', 'body']);
});

test('a trace follows one line through every phase', () => {
    const source = 'let w = 4 * 5;\nprint(w);';
    const text = traceRows({ source, ...compile(source) }, 1).map(row => row.text).join('\n');
    for (const expected of ['1. Lexer', 'NUMBER', '2. Parser', 'Let w', '3. Semantic analysis', 'w -> declared on this line',
        '4. Three-address code', 'w = 4 * 5', '5. Optimizer', 'w = 20', '6. Bytecode', 'PUSH          20']) {
        assert.ok(text.includes(expected), `missing "${expected}" in:\n${text}`);
    }
});

test('every row from the phase views is tagged with a line or marked as text', () => {
    const source = 'let a = 1;\nif (a > 0) { print(a); }';
    const compiled = compile(source);
    const rows = [...tokenRows(compiled.tokens), ...tacRows(compiled.tac), ...bytecodeRows(compiled.bytecode)];
    for (const row of rows) {
        assert.ok(row.line !== undefined, `row without line: ${row.text}`);
    }
    assert.ok(tacRows(compiled.tac).some(row => row.line === 2));
});

console.log('\nFriendly errors and language packs');

test('a code frame shows the line and puts carets under the exact spot', () => {
    const source = 'let total = 0;\nprint(totl);';
    assert.deepEqual(codeFrame(source, { line: 2, column: 7, length: 4 }), [
        '    1 | let total = 0;',
        '  > 2 | print(totl);',
        '      |       ^^^^',
    ]);
});

test('without a column the whole statement is underlined, and tabs stay aligned', () => {
    assert.deepEqual(codeFrame('\tprint(1 / 0);', { line: 1 }), [
        '  > 1 | \tprint(1 / 0);',
        '      | \t^^^^^^^^^^^^^',
    ]);
});

test('the marker finds the right text even after letters with vowel signs', () => {
    const source = 'பதிப்பி(totl);';
    const caretLine = codeFrame(source, { line: 1, column: 9, length: 4 })[1];
    const [, padding, carets] = caretLine.match(/\| ([\s]*)(\^+)$/);
    assert.deepEqual(splitAtCaret(source, padding, carets.length), { before: 'பதிப்பி(', marked: 'totl' });
});

test('every language pack is a valid, unique set of keywords', () => {
    for (const pack of LANGUAGE_PACKS) {
        assert.doesNotThrow(() => compile('', pack.keywords), `pack ${pack.id}`);
        const words = Object.values(pack.keywords);
        assert.equal(words.length, keywordSpellings({}).length, `pack ${pack.id} is missing keywords`);
        assert.equal(new Set(words).size, words.length, `pack ${pack.id} has duplicate keywords`);
    }
});

test('converting a program to every language keeps its output and converts back exactly', () => {
    const english = LANGUAGE_PACKS[0].keywords;
    const expected = runBytecode(compile(DEFAULT_CODE_EXAMPLE, english).bytecode).output;
    for (const pack of LANGUAGE_PACKS) {
        const { code, conflicts } = translateKeywords(DEFAULT_CODE_EXAMPLE, english, pack.keywords);
        assert.deepEqual(conflicts, []);
        assert.deepEqual(runBytecode(compile(code, pack.keywords).bytecode).output, expected, `pack ${pack.id}`);
        assert.equal(translateKeywords(code, pack.keywords, english).code, DEFAULT_CODE_EXAMPLE, `pack ${pack.id} round trip`);
    }
});

test('converting leaves text and variable names alone, and reports names that become keywords', () => {
    const hindi = LANGUAGE_PACKS.find(pack => pack.id === 'hi').keywords;
    const { code, conflicts } = translateKeywords('let अगर = 1; print("if let while");', {}, hindi);
    assert.equal(code, 'माना अगर = 1; छापो("if let while");');
    assert.deepEqual(conflicts, ['अगर']);
});

console.log('\nEditor: highlighting and suggestions');

const tamil = LANGUAGE_PACKS.find(pack => pack.id === 'ta').keywords;

test('highlighting covers every character, even in broken code', () => {
    for (const source of [DEFAULT_CODE_EXAMPLE, 'let a = @ 1; // note\nprint("open', '', '"', '\t\n  ']) {
        assert.equal(highlightSegments(source).map(segment => segment.text).join(''), source);
    }
});

test('highlighting uses the chosen language, exactly like the compiler', () => {
    const kinds = (source, settings) => highlightSegments(source, settings)
        .filter(segment => segment.kind !== 'space')
        .map(segment => `${segment.kind}:${segment.text}`);
    assert.deepEqual(kinds('மாறி x = 1.5; let', tamil), [
        'keyword:மாறி', 'identifier:x', 'operator:=', 'number:1.5', 'punctuation:;', 'identifier:let',
    ]);
    assert.deepEqual(kinds('if (a == true) { print("hi" + 2); } // done'), [
        'keyword:if', 'punctuation:(', 'identifier:a', 'operator:==', 'literal:true', 'punctuation:)',
        'punctuation:{', 'keyword:print', 'punctuation:(', 'string:"hi"', 'operator:+', 'number:2',
        'punctuation:)', 'punctuation:;', 'punctuation:}', 'comment:// done',
    ]);
    assert.deepEqual(kinds('x @ "never'), ['identifier:x', 'error:@', 'error:"never']);
});

test('suggestions offer keywords, regional keywords for English words, and variable names', () => {
    assert.deepEqual(completionCandidates('', 'pr', tamil), [{ label: 'பதிப்பி', detail: 'keyword: print' }]);
    assert.deepEqual(completionCandidates('', 'wh', {}), [{ label: 'while', detail: 'keyword' }]);
    assert.deepEqual(completionCandidates('let total = 0; let tally = 1;', 'ta', {}), [{ label: 'tally', detail: 'variable' }]);
    assert.deepEqual(completionCandidates('let total = 0; to', 'to', {}), [{ label: 'total', detail: 'variable' }]);
});

test('suggestions only start on a word, and not inside text or comments', () => {
    assert.deepEqual(wordBeforeCaret('let tot', 7), { start: 4, prefix: 'tot' });
    assert.equal(wordBeforeCaret('x = 12', 6), null);
    assert.equal(wordBeforeCaret('x = ', 4), null);
    assert.equal(insideTextOrComment('print("pri', 10, {}), true);
    assert.equal(insideTextOrComment('// pri', 6, {}), true);
    assert.equal(insideTextOrComment('pri', 3, {}), false);
});

console.log('\nExtra back ends: C, Python, JavaScript');

// Finds a program on this machine, or null (those tests are then skipped)
function findTool(...names) {
    for (const name of names) {
        const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
        for (const candidate of found.status === 0 ? found.stdout.split(/\r?\n/).filter(Boolean) : []) {
            if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate.trim();
        }
    }
    return null;
}

const PYTHON = findTool('python', 'python3');
const GCC = findTool('gcc');
const workDir = mkdtempSync(path.join(os.tmpdir(), 'compiler-targets-'));
// gcc's helper programs need its own folder first on the PATH (MSYS2 on Windows)
const toolEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: [GCC && path.dirname(GCC), process.env.PATH].filter(Boolean).join(path.delimiter) };

function outputLines(text) {
    const normal = text.replace(/\r\n/g, '\n');
    const trimmed = normal.endsWith('\n') ? normal.slice(0, -1) : normal;
    return trimmed === '' ? [] : trimmed.split('\n');
}

function runPython(code, name) {
    const file = path.join(workDir, `${name}.py`);
    writeFileSync(file, code);
    const run = spawnSync(PYTHON, [file], { encoding: 'utf8', env: toolEnv, timeout: 20000 });
    return { output: outputLines(run.stdout), stderr: run.stderr };
}

function runC(code, name) {
    const source = path.join(workDir, `${name}.c`);
    const exe = path.join(workDir, `${name}.exe`);
    writeFileSync(source, code);
    // Unused variables are the program's own choice (semantic analysis warns about them too)
    const build = spawnSync(GCC, ['-std=c11', '-Wall', '-Wextra', '-Wno-unused-variable', source, '-o', exe], { encoding: 'utf8', env: toolEnv });
    assert.equal(build.status, 0, `gcc failed:\n${build.stderr}\n${code}`);
    assert.equal(build.stderr, '', `gcc warnings:\n${build.stderr}`);
    const run = spawnSync(exe, [], { encoding: 'utf8', env: toolEnv, timeout: 20000 });
    return { output: outputLines(run.stdout), stderr: run.stderr };
}

// The target must print what the VM printed, and stop with the same error if the VM did
function assertSameAsVM(result, vm, label) {
    assert.deepEqual(result.output, vm.output, `${label}: different output`);
    if (vm.error) assert.ok(result.stderr.includes(vm.error.message), `${label}: expected error "${vm.error.message}", got:\n${result.stderr}`);
    else assert.equal(result.stderr, '', `${label}: unexpected error:\n${result.stderr}`);
}

// Python and C have no runaway-loop guard, and their own (different) recursion limits
const RUNAWAY = ['runtime error: runaway loop', 'runtime error: runaway recursion'];
const targetPrograms = Object.entries(crossCheckPrograms).filter(([name]) => !RUNAWAY.includes(name));

test('the JavaScript version prints exactly what the VM prints, for every program', () => {
    for (const [name, source] of Object.entries(crossCheckPrograms)) {
        const { ast, analysis, bytecode } = compile(source);
        const vm = runBytecode(bytecode);
        const js = runJavaScript(ast, analysis);
        assert.deepEqual(js.output, vm.output, `${name}: different output`);
        assert.equal(js.error?.message ?? null, vm.error?.message ?? null, `${name}: different error`);
    }
});

test(PYTHON ? 'the Python version prints exactly what the VM prints, for every program' : 'Python versions (skipped: python not found)', () => {
    if (!PYTHON) return;
    targetPrograms.forEach(([name, source], index) => {
        const { ast, analysis, bytecode } = compile(source);
        const python = generateTarget('python', ast, analysis);
        assertSameAsVM(runPython(python.code, `program${index}`), runBytecode(bytecode), name);
    });
});

test(GCC ? 'the C version compiles without warnings and prints what the VM prints' : 'C versions (skipped: gcc not found)', () => {
    if (!GCC) return;
    const refused = [];
    targetPrograms.forEach(([name, source], index) => {
        const { ast, analysis, bytecode } = compile(source);
        const c = generateTarget('c', ast, analysis);
        if (!c.ok) {
            refused.push(name);
            return;
        }
        assertSameAsVM(runC(c.code, `program${index}`), runBytecode(bytecode), name);
    });
    // Only programs that change a variable's type, assign inside a calculation, or print
    // from two arguments of one call can't be C
    assert.deepEqual(refused.sort(), [
        'assignment as an expression',
        'functions: arguments are worked out left to right',
        'left operand read before right side assigns',
        'optimizer: value changes after a copy',
        'optimizer: variable that changes type',
        'runtime error: mixed types not known statically',
    ]);
});

test('C explains when a program needs dynamic types or an evaluation order C lacks', () => {
    const mixed = compile('let v = 1; v = "text"; print(v);');
    assert.match(generateTarget('c', mixed.ast, mixed.analysis).reason, /'v' \(line 1\) holds number and string/);
    const unordered = compile('let a = 1;\nlet b = a + (a = 5);\nprint(b);');
    assert.match(generateTarget('c', unordered.ast, unordered.analysis).reason, /line 2 assigns a variable in the middle of a calculation/);
    for (const language of ['python', 'javascript']) {
        assert.ok(generateTarget(language, mixed.ast, mixed.analysis).ok, `${language} handles changing types`);
    }
});

test('names that are reserved in the target language are renamed', () => {
    const { ast, analysis } = compile('let def = 1; let int = 2; let x = 3; { let x = 4; print(x); } print(def + int + x);');
    const python = generateTarget('python', ast, analysis).code;
    assert.match(python, /^def_2 = 1$/m);
    assert.match(python, /^x_2 = 4$/m);
    const c = generateTarget('c', ast, analysis).code;
    assert.match(c, /double int_2 = 2\.0;/);
});

test('generated lines are linked back to the source lines they came from', () => {
    const { ast, analysis } = compile('let a = 1;\nprint(a + 1);');
    for (const language of ['c', 'python', 'javascript']) {
        const rows = generateTarget(language, ast, analysis).rows;
        assert.ok(rows.some(row => row.line === 2 && row.text.includes('a + 1')), `${language} line 2`);
    }
});

console.log('\nStep-through debugger');

test('recording a run gives the same steps, output and error as running it normally', () => {
    for (const [name, source] of Object.entries(crossCheckPrograms)) {
        if (name === 'runtime error: runaway loop') continue; // longer than the recording limit
        const { bytecode } = compile(source);
        const vm = runBytecode(bytecode);
        const recording = recordExecution(bytecode);
        assert.equal(recording.steps.length, vm.steps, `${name}: steps`);
        assert.deepEqual(recording.output, vm.output, `${name}: output`);
        assert.equal(recording.error?.message ?? null, vm.error?.message ?? null, `${name}: error`);
        if (!vm.error) {
            // The last state holds the same final values as the VM's global variables
            const final = stateAt(bytecode, recording, recording.steps.length);
            for (const { name: variable, slot } of bytecode.globals) {
                assert.equal(final.slots[slot], vm.globals[variable], `${name}: ${variable}`);
            }
        }
    }
});

test('very long runs are recorded only up to the limit', () => {
    const { bytecode } = compile('let i = 0; while (true) { i = i + 1; }');
    const recording = recordExecution(bytecode, 500);
    assert.equal(recording.steps.length, 500);
    assert.equal(recording.truncated, true);
});

test('time travel rebuilds the state at any step, forwards or backwards', () => {
    const { bytecode } = compile('let a = 1;\nlet b = a + 2;\nprint(b);');
    const recording = recordExecution(bytecode);
    const start = stateAt(bytecode, recording, 0);
    assert.deepEqual([start.stack, start.output, start.nextPc], [[], [], 0]);
    const slot = (name) => bytecode.slotNames.indexOf(name);
    // a = 1 is stored by the 2nd instruction; b = 3 by the 4th (constant folding made it 3)
    assert.equal(stateAt(bytecode, recording, 2).slots[slot('a')], 1);
    assert.equal(stateAt(bytecode, recording, 2).changed, slot('a'));
    const end = stateAt(bytecode, recording, recording.steps.length);
    assert.deepEqual([end.slots[slot('b')], end.output, end.done], [3, ['3'], true]);
    assert.equal(stateAt(bytecode, recording, 2).slots[slot('b')], undefined); // not set yet
});

test('each step is explained in plain words', () => {
    const { bytecode } = compile('let i = 0;\nwhile (i < 1) { i = i + 1; }');
    const recording = recordExecution(bytecode);
    const explanations = recording.steps.map((_, index) => explainStep(bytecode, recording, index));
    assert.equal(explanations[0], 'Pushed the value 0 onto the stack.');
    assert.equal(explanations[1], 'Took 0 off the stack and stored it in i.');
    assert.ok(explanations.includes('Took 0 and 1 off the stack, compared them (0 < 1), and pushed true.'));
    assert.ok(explanations.some(text => text.startsWith('Took false off the stack, so jumped to instruction')));
    assert.equal(explanations.at(-1), 'The program has finished.');
});

test('next line and previous line jump between source lines', () => {
    const { bytecode } = compile('let a = 1;\nlet b = 2;\nprint(a + b);');
    const recording = recordExecution(bytecode);
    const lineAtStep = (count) => bytecode.code[recording.steps[count].pc].line;
    const second = nextLineStep(bytecode, recording, 0);
    assert.equal(lineAtStep(second), 2);
    const third = nextLineStep(bytecode, recording, second);
    assert.equal(lineAtStep(third), 3);
    assert.equal(previousLineStep(bytecode, recording, third), second);
});

console.log('\nSyntax guide');

test('every guide example compiles and runs cleanly in every language pack', () => {
    for (const section of GUIDE_SECTIONS) {
        const english = compile(section.example);
        assert.deepEqual(english.analysis.errors, [], `${section.id}: semantic errors`);
        const expected = runBytecode(english.bytecode);
        assert.equal(expected.error, null, `${section.id}: runtime error`);
        for (const pack of LANGUAGE_PACKS) {
            const { code } = translateKeywords(section.example, {}, pack.keywords);
            const translated = compile(code, pack.keywords);
            assert.deepEqual(runBytecode(translated.bytecode).output, expected.output, `${section.id} in ${pack.id}`);
        }
    }
});

test('the "write instead" suggestions really compile', () => {
    for (const [, write] of NOT_SUPPORTED) {
        if (!write) continue;
        const declarations = 'let i = 0; let a = 1; let b = 2; let x = 5;';
        assert.doesNotThrow(() => compile(`${declarations} ${write.startsWith('if') ? `${write} { }` : `${write};`}`), write);
    }
});

console.log('\nFunctions');

test('function mistakes are caught before running, with clear messages', () => {
    const errors = semanticErrors(`func add(a, b) { return a + b; }
print(add(1));
print(ad(1, 2));
print(add);
return 5;
func greet(name) { print(name); }
let g = greet("x");
let total = 5;
func useTotal() { return total; }
print(useTotal());`);
    assert.deepEqual(errors, [
        "Line 2: 'add' needs 2 values (a, b), but got 1.",
        "Line 3: There is no function called 'ad'. Did you mean 'add'?",
        "Line 4: 'add' is a function. To use it, call it with ( ), like add(...).",
        "Line 5: 'return' can only be used inside a function.",
        "Line 7: 'greet' doesn't give back a value (it has no return with a value), so its result can't be used here. Call it on its own line instead.",
        "Line 9: 'total' belongs to the main program, and a function can only use its own parameters and variables. Pass it in as a parameter instead: useTotal(total).",
    ]);
});

test('more function rules: placement, names and return forms', () => {
    assert.match(semanticErrors('{ func inner() { return 1; } }')[0], /only be created at the top level/);
    assert.match(semanticErrors('func f() { return 1; }\nfunc f() { return 2; }\nprint(f());')[0], /already a function called 'f'/);
    assert.match(semanticErrors('func f(a, a) { return a; }\nprint(f(1, 2));')[0], /used twice as a parameter/);
    assert.match(semanticErrors('func f(x) { if (x > 0) { return 1; } return; }\nprint(f(1));')[0], /this return needs a value too/);
    assert.match(semanticErrors('func f() { return 1; }\nlet f = 2;')[0], /already the name of a function/);
    assert.match(semanticErrors('let x = 1;\nx(2);')[0], /'x' is a variable, not a function/);
    assert.match(compile('func f() { return 1; }').analysis.warnings[0].message, /never called/);
});

test('parameter and return types are inferred from the calls', () => {
    const { analysis } = compile('func label(n) { return "n=" + n; }\nfunc half(x) { return x / 2; }\nprint(label(half(9)));');
    const types = Object.fromEntries(analysis.functions.map(fn => [fn.name, [[...fn.types], fn.paramSymbols.map(p => [...p.types])]]));
    assert.deepEqual(types, { label: [['string'], [['number']]], half: [['number'], [['number']]] });
});

test('functions in TAC use param, call and return, and an unreachable missing-return check is optimized away', () => {
    const { tac, optimized } = compile('func sq(n) { return n * n; }\nprint(sq(3));');
    const main = tac.instructions.map(formatTACInstruction);
    assert.deepEqual(main.slice(0, 2), ['param 3', 't1 = call sq, 1']);
    const body = tac.functions[0].instructions.map(formatTACInstruction);
    assert.deepEqual(body.slice(0, 2), ['t2 = n * n', 'return t2']);
    assert.ok(body.at(-1).startsWith('fail'), 'the check is there before optimizing');
    assert.ok(!optimized.tac.functions[0].instructions.some(i => i.op === 'fail'), 'and gone after');
});

test('the debugger shows the call stack inside recursive calls', () => {
    const { bytecode } = compile('func fact(n) {\n    if (n < 2) { return 1; }\n    return n * fact(n - 1);\n}\nprint(fact(3));');
    const recording = recordExecution(bytecode);
    const calls = recording.steps.map((step, index) => [step, index]).filter(([step]) => bytecode.code[step.pc].op === 'CALL');
    assert.equal(calls.length, 3); // fact(3), fact(2), fact(1)
    const deepest = calls[2][1] + 1;
    const state = stateAt(bytecode, recording, deepest);
    assert.deepEqual(state.frames.map(frame => frame.name), [null, 'fact', 'fact', 'fact']);
    assert.equal(state.slots[0], 1); // n in the newest frame
    assert.equal(explainStep(bytecode, recording, calls[0][1]), 'Called fact with 3. A new frame on the call stack holds its variables, and the program jumped to instruction ' + bytecode.functions[0].entry + '.');
    const end = stateAt(bytecode, recording, recording.steps.length);
    assert.deepEqual([end.frames.length, end.output], [1, ['6']]);
});

test('func and return can be written in every language pack', () => {
    for (const pack of LANGUAGE_PACKS) {
        const english = 'func twice(x) { return x * 2; }\nprint(twice(21));';
        const { code } = translateKeywords(english, {}, pack.keywords);
        assert.deepEqual(runBytecode(compile(code, pack.keywords).bytecode).output, ['42'], pack.id);
    }
});

console.log('\nComplexity advisor');

function bigO(source) {
    const { ast, analysis } = compile(source);
    return analyzeStaticComplexity(ast, analysis);
}

function advise(source, settings = {}) {
    const compiled = compile(source, settings);
    return adviseComplexity({ source, settings, ...compiled });
}

test('Big-O is worked out from the loops in the code', () => {
    const cases = {
        'let n = 9; let c = 0;\nfor (let i = 0; i < n; i = i + 1) { c = c + 1; }': 'O(n)',
        'let n = 9; let c = 0;\nfor (let i = 0; i < n; i = i + 1) { for (let j = 0; j < n; j = j + 1) { c = c + 1; } }': 'O(n²)',
        'let n = 9; let c = 0;\nfor (let i = 0; i < n; i = i + 1) { for (let j = 0; j < i; j = j + 1) { c = c + 1; } }': 'O(n²)',
        'let n = 9; let m = 4; let c = 0;\nfor (let i = 0; i < n; i = i + 1) { for (let j = 0; j < m; j = j + 1) { c = c + 1; } }': 'O(m·n)',
        'let n = 1000; let i = 1;\nwhile (i < n) { i = i * 2; }': 'O(log n)',
        'let n = 1000;\nwhile (n > 1) { n = n / 2; }': 'O(log n)',
        'for (let i = 0; i < 10; i = i + 1) { print(i); }': 'O(1)',
        'let x = 100;\nwhile (x > 1) { if (x > 50) { x = x - 1; } else { x = x / 2; } }': 'O(1)?',
    };
    for (const [source, expected] of Object.entries(cases)) {
        assert.equal(formatCost(bigO(source).total), expected, source);
    }
});

test('recursive functions are solved from how they call themselves', () => {
    const fns = (source) => Object.fromEntries(bigO(source).functions.map(fn => [fn.name, `${formatCost(fn.time)} / ${formatCost(fn.memory)}`]));
    assert.deepEqual(fns('func fib(n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }\nprint(fib(9));'), { fib: 'O(2^n) / O(n)' });
    assert.deepEqual(fns('func fact(n) { if (n < 2) { return 1; } return n * fact(n - 1); }\nprint(fact(9));'), { fact: 'O(n) / O(n)' });
    assert.deepEqual(fns('func halves(n) { if (n < 2) { return 0; } return 1 + halves(n / 2); }\nprint(halves(9));'), { halves: 'O(log n) / O(log n)' });
    const nested = bigO('func fact(n) { if (n < 2) { return 1; } return n * fact(n - 1); }\nfunc sumTo(k) { let t = 0; for (let i = 0; i < k; i = i + 1) { t = t + fact(i); } return t; }\nlet n = 10;\nprint(sumTo(n));');
    assert.equal(formatCost(nested.total), 'O(n²)');
    assert.equal(formatCost(nested.memory), 'O(n)'); // fact's call stack, reached through sumTo
});

test('fixed loops say how many times they run, including zero', () => {
    const loops = bigO('let i = 0;\nwhile (i < 3) { i = i + 1; }\nfor (let k = 10; k < 5; k = k + 1) { }').loops.map(loop => loop.text);
    assert.deepEqual(loops, ['runs 3 times (a fixed number)', 'runs 0 times (a fixed number)']);
});

test('measured growth agrees with the estimate', () => {
    const quadratic = advise('let n = 10; let c = 0;\nfor (let i = 0; i < n; i = i + 1) { for (let j = 0; j < n; j = j + 1) { c = c + 1; } }\nprint(c);').growth;
    assert.deepEqual([quadratic.measured, quadratic.predicted], ['n²', 'n²']);
    const linear = advise('let n = 10; let c = 0;\nfor (let i = 0; i < n; i = i + 1) { c = c + i; }\nprint(c);').growth;
    assert.deepEqual([linear.measured, linear.predicted], ['n', 'n']);
    const fib = advise('func fib(n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }\nlet n = 12;\nprint(fib(n));').growth;
    assert.deepEqual([fib.measured, fib.predicted], ['exponential', 'exponential']);
    assert.equal(advise('print(1);').growth, null);
});

test('adding up or counting with a loop is rewritten as a formula, and checked on the VM', () => {
    const sum = advise('let n = 100;\nlet total = 0;\nfor (let i = 1; i < n + 1; i = i + 1) {\n    total = total + i;\n}\nprint(total);').suggestions[0];
    assert.equal(sum.title, 'Adding up 1 to n with a loop');
    assert.ok(sum.replacement.includes('total = total + (n * (n + 1) / 2);'), sum.replacement);
    assert.equal(sum.verified.ok, true);
    assert.ok(sum.verified.after < sum.verified.before / 10);
    const count = advise('let n = 50;\nlet c = 0;\nfor (let i = 0; i < n; i = i + 1) { c = c + 1; }\nprint(c);').suggestions[0];
    assert.equal(count.title, 'Counting the passes of a loop');
    assert.equal(count.verified.ok, true);
});

test('suggestions are written in the chosen keywords and still checked', () => {
    const tamil = LANGUAGE_PACKS.find(pack => pack.id === 'ta').keywords;
    const english = 'let n = 30;\nlet total = 0;\nfor (let i = 0; i < n; i = i + 1) { total = total + i; }\nprint(total);';
    const { code } = translateKeywords(english, {}, tamil);
    const [suggestion] = advise(code, tamil).suggestions;
    assert.ok(suggestion.replacement.startsWith(`${tamil.ifKeyword} (`), suggestion.replacement);
    assert.equal(suggestion.verified.ok, true);
});

test('Fibonacci-style recursion gets a loop version, checked on 16 inputs', () => {
    const [suggestion] = advise('func fib(n) {\n    if (n < 2) { return n; }\n    return fib(n - 1) + fib(n - 2);\n}\nlet n = 10;\nprint(fib(n));').suggestions;
    assert.ok(suggestion.replacement.includes('func fibLoop(n)'));
    assert.deepEqual([suggestion.verified.ok, suggestion.verified.note], [true, 'same answers for 0 to 15']);
});

test('repeated calculations, stuck loops and loops that never run are pointed out', () => {
    const titles = advise(`let n = 20;
let rate = 3;
let total = 0;
for (let i = 0; i < n; i = i + 1) {
    total = total + rate * 2 + i;
}
let x = 0;
while (x < 3) { print(x); }
for (let k = 10; k < 5; k = k + 1) { print(k); }
while (false) { print(x); }`).suggestions.map(s => `${s.line}: ${s.title}`);
    assert.deepEqual(titles, [
        '5: The same calculation on every pass',
        '8: This loop never stops once it starts',
        '9: This loop never runs',
        '10: This loop never runs',
    ]);
});

test('the busiest lines come from counting the real run', () => {
    const { busiest } = advise('let c = 0;\nfor (let i = 0; i < 5; i = i + 1) {\n    c = c + 1;\n}');
    assert.deepEqual(busiest[0], [2, 6]); // the loop header: 5 passes + the final check
    assert.deepEqual(busiest[1], [3, 5]);
});

console.log('\nChecking code the AI tutor suggests');

const slowSum = 'let n = 50;\nlet total = 0;\nfor (let i = 1; i < n + 1; i = i + 1) { total = total + i; }\nprint(total);';
const buildOf = (source, settings = {}) => ({ source, settings, ...compile(source, settings) });

test('code is taken from the last fenced block of an answer', () => {
    assert.equal(extractCode('No code here.'), null);
    assert.equal(extractCode('Try:\n```\nprint(1);\n```\nor better:\n```js\nprint(2);\n```'), 'print(2);');
});

test('a correct faster version is checked: same output, fewer steps, better Big-O', () => {
    const faster = 'let n = 50;\nlet total = n * (n + 1) / 2;\nprint(total);';
    const result = verifySuggestion(buildOf(slowSum), faster);
    assert.equal(result.status, 'checked');
    assert.deepEqual([result.before.bigO, result.after.bigO], ['O(n)', 'O(1)']);
    assert.ok(result.after.steps < result.before.steps);
});

test('a suggestion that prints something else, or does not compile, is rejected', () => {
    const wrong = verifySuggestion(buildOf(slowSum), 'let n = 50;\nprint(n * n / 2);');
    assert.equal(wrong.status, 'different');
    const broken = verifySuggestion(buildOf(slowSum), 'let n = 50;\nprint(n % 2);');
    assert.equal(broken.status, 'broken');
    assert.match(broken.reason, /does not compile/);
    const undeclared = verifySuggestion(buildOf(slowSum), 'print(totl);');
    assert.match(undeclared.reason, /line 1: 'totl' is not declared/);
});

test('suggestions in regional keywords are checked with those keywords', () => {
    const tamil = LANGUAGE_PACKS.find(pack => pack.id === 'ta').keywords;
    const original = translateKeywords(slowSum, {}, tamil).code;
    const faster = translateKeywords('let n = 50;\nprint(n * (n + 1) / 2);', {}, tamil).code;
    assert.equal(verifySuggestion(buildOf(original, tamil), faster).status, 'checked');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
