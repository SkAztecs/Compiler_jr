import { TokenType } from '../../token.js';
import {
    BlockStatementNode,
    LetStatementNode,
    AssignmentNode,
    IfStatementNode,
    WhileLoopNode,
    ForLoopNode,
    BinaryOpNode,
    UnaryOpNode,
    IdentifierNode,
    NumberNode,
    StringNode,
    BooleanNode,
    FunctionDeclarationNode,
    ReturnStatementNode,
    CallNode
} from '../../ast.js';
import { compile } from './pipeline.js';
import { VM } from './vm.js';
import { formatValue, OPERATOR_SYMBOLS } from './runtime.js';
import { keywordSpellings } from '../interpreter/lexer.js';
import { translateKeywords } from './translate.js';
import {
    analyzeStaticComplexity,
    formatCost,
    growthIn,
    isConstant,
    identifiersIn,
    assignedIn,
    containsCall,
} from './complexity.js';

// The complexity advisor, part 2: run the program to measure it, and suggest improvements.
//   - Busiest lines: how many times each line ran
//   - Measured growth: run again with the input size doubled, and see how the work grows
//   - Suggestions: known patterns with a better version. When the advisor can rewrite the
//     code itself, it runs both versions on the VM and only says "checked" if they agree.

const MEASURE_LIMIT = 400000;   // VM steps per growth run
const PROFILE_LIMIT = 2000000;  // VM steps for the busiest-lines run
const GROWTH_SIZES = [8, 16, 32, 64, 128, 256, 512];

// --- Running ---

// Runs bytecode, counting how often each source line is entered
export function runCounting(bytecode, limit) {
    const output = [];
    const vm = new VM(bytecode, value => output.push(formatValue(value)));
    const visits = new Map();
    let previous = null;
    let finished = false;
    let error = null;
    while (vm.steps < limit) {
        const { line } = bytecode.code[vm.pc];
        if (line !== null && line !== previous) {
            visits.set(line, (visits.get(line) ?? 0) + 1);
            previous = line;
        }
        try {
            finished = vm.step();
        } catch (failure) {
            error = failure.message;
            break;
        }
        if (finished) break;
    }
    return { steps: vm.steps, output, error, finished, visits };
}

// --- Printing code back from the syntax tree (used in suggestions) ---

const PRECEDENCE = {
    [TokenType.OR]: 1, [TokenType.AND]: 2, [TokenType.EQ]: 3, [TokenType.NOT_EQ]: 3,
    [TokenType.LT]: 4, [TokenType.GT]: 4, [TokenType.PLUS]: 5, [TokenType.MINUS]: 5,
    [TokenType.MULTIPLY]: 6, [TokenType.DIVIDE]: 6,
};

export function printExpression(node, minPrecedence = 0) {
    if (node instanceof NumberNode) return String(node.value);
    if (node instanceof StringNode) return `"${node.value}"`;
    if (node instanceof BooleanNode) return node.token.lexeme ?? String(node.value);
    if (node instanceof IdentifierNode) return node.value;
    if (node instanceof CallNode) return `${node.callee.value}(${node.args.map(arg => printExpression(arg)).join(', ')})`;
    if (node instanceof AssignmentNode) return `(${node.identifier.value} = ${printExpression(node.expression)})`;
    if (node instanceof UnaryOpNode) return `${OPERATOR_SYMBOLS[node.op.type]}${printExpression(node.right, 7)}`;
    if (node instanceof BinaryOpNode) {
        const precedence = PRECEDENCE[node.op.type];
        const text = `${printExpression(node.left, precedence)} ${OPERATOR_SYMBOLS[node.op.type]} ${printExpression(node.right, precedence + 1)}`;
        return precedence < minPrecedence ? `(${text})` : text;
    }
    return '?';
}

// --- Finding things in the program ---

function walk(node, visit, parentLoop = null) {
    if (!node || typeof node !== 'object') return;
    const descend = visit(node, parentLoop);
    if (descend === false) return;
    const loop = node instanceof ForLoopNode || node instanceof WhileLoopNode ? node : parentLoop;
    const children = node.statements ?? [
        node.expression, node.condition, node.consequence, node.alternative, node.body,
        node.initializer, node.increment, node.left, node.right, ...(node.args ?? []),
    ];
    children.forEach(child => walk(child, visit, loop));
}

function tokenAt(tokens, line, column) {
    return tokens.findIndex(token => token.line === line && token.column === column);
}

// The source text range of a statement that ends with a { block }: from its first token to the matching }
function blockStatementSpan(tokens, statement, body) {
    const first = tokenAt(tokens, statement.line, statement.column);
    let index = tokenAt(tokens, body.line, body.column);
    if (first < 0 || index < 0) return null;
    let depth = 0;
    for (; index < tokens.length; index++) {
        if (tokens[index].type === TokenType.LBRACE) depth++;
        if (tokens[index].type === TokenType.RBRACE && --depth === 0) {
            return { start: tokens[first].start, end: tokens[index].start + 1 };
        }
    }
    return null;
}

function indentOf(source, offset) {
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
    return source.slice(lineStart, offset).match(/^\s*/)[0];
}

// Compiles and runs a rewritten program, and compares it with the original run
function check(build, newSource, original) {
    const compiled = (() => {
        try {
            return compile(newSource, build.settings);
        } catch {
            return null;
        }
    })();
    if (!compiled || !compiled.ok) return { ok: false, reason: 'the rewritten program does not compile' };
    const run = runCounting(compiled.bytecode, PROFILE_LIMIT);
    const same = run.output.join('\n') === original.output.join('\n') && run.error === original.error;
    return same
        ? { ok: true, before: original.steps, after: run.steps }
        : { ok: false, reason: 'the rewritten program printed something different' };
}

// --- Suggestions ---

// for (let i = a; i < E; i = i + 1) { total = total + i; }   (or count = count + 1)
function rangeLoopSuggestions(build, original, words) {
    const suggestions = [];
    walk(build.ast, node => {
        if (!(node instanceof ForLoopNode)) return;
        const init = node.initializer;
        if (!(init instanceof LetStatementNode) || !(init.expression instanceof NumberNode)) return;
        const v = init.identifier.value;
        const a = init.expression.value;
        const cond = node.condition;
        if (!(cond instanceof BinaryOpNode) || cond.op.type !== TokenType.LT
            || !(cond.left instanceof IdentifierNode) || cond.left.value !== v) return;
        const step = node.increment;
        const isPlusOne = step instanceof AssignmentNode && step.identifier.value === v && step.expression instanceof BinaryOpNode
            && step.expression.op.type === TokenType.PLUS && step.expression.left instanceof IdentifierNode
            && step.expression.left.value === v && step.expression.right instanceof NumberNode && step.expression.right.value === 1;
        if (!isPlusOne || node.body.statements.length !== 1) return;
        const statement = node.body.statements[0];
        if (!(statement instanceof AssignmentNode) || !(statement.expression instanceof BinaryOpNode)
            || statement.expression.op.type !== TokenType.PLUS) return;
        const acc = statement.identifier.value;
        const { left, right } = statement.expression;
        const isAcc = (n) => n instanceof IdentifierNode && n.value === acc;
        const other = isAcc(left) ? right : isAcc(right) ? left : null;
        if (!other || acc === v) return;
        const kind = other instanceof IdentifierNode && other.value === v ? 'sum'
            : other instanceof NumberNode && other.value === 1 ? 'count' : null;
        if (!kind) return;
        const boundNames = identifiersIn(cond.right);
        if (boundNames.has(acc) || boundNames.has(v) || containsCall(cond.right) || assignedIn(cond.right).size > 0) return;

        const span = blockStatementSpan(build.tokens, node, node.body);
        if (!span) return;
        const E = printExpression(cond.right, 6);
        const plainE = printExpression(cond.right);
        // The last number added is E - 1; for the common 'i < n + 1' that is just n
        const plusOne = cond.right instanceof BinaryOpNode && cond.right.op.type === TokenType.PLUS
            && cond.right.right instanceof NumberNode && cond.right.right.value === 1;
        const last = plusOne ? printExpression(cond.right.left) : `${printExpression(cond.right, 5)} - 1`;
        const lastFactor = plusOne ? printExpression(cond.right.left, 6) : `(${last})`;
        let formula;
        if (kind === 'count') {
            formula = a === 0 ? plainE : `${printExpression(cond.right, 5)} - ${a}`;
        } else {
            const offset = ((a - 1) * a) / 2;
            formula = `${lastFactor} * ${E} / 2${offset !== 0 ? ` - ${offset}` : ''}`;
        }
        const indent = indentOf(build.source, span.start);
        const replacement = [
            `${words.if} (${printExpression(cond.right, 4)} > ${a}) {`,
            `${indent}    ${acc} = ${acc} + ${kind === 'count' && a === 0 ? plainE : `(${formula})`};`,
            `${indent}}`,
        ].join('\n');
        const newSource = build.source.slice(0, span.start) + replacement + build.source.slice(span.end);
        const title = kind === 'sum' ? `Adding up ${a} to ${last} with a loop` : 'Counting the passes of a loop';
        suggestions.push({
            line: node.line,
            title,
            explanation: kind === 'sum'
                ? `This loop adds every number from ${a} up to ${last}, one at a time: O(n) work. Gauss's formula gives the same total in one step: O(1).`
                : `This loop only counts its own passes, so the answer is just how many times it runs: O(n) work for something you can work out in O(1).`,
            replacement,
            verified: check(build, newSource, original),
        });
    });
    return suggestions;
}

// A calculation inside a loop whose inputs never change in that loop
function invariantSuggestions(build, original, words) {
    const suggestions = [];
    const seen = new Set();
    walk(build.ast, (node) => {
        if (!(node instanceof ForLoopNode || node instanceof WhileLoopNode)) return;
        const changed = assignedIn(node.body);
        if (node instanceof ForLoopNode) {
            assignedIn(node.increment).forEach(name => changed.add(name));
            if (node.initializer) assignedIn(node.initializer).forEach(name => changed.add(name));
        }
        walk(node.body, (inner) => {
            if (inner instanceof ForLoopNode || inner instanceof WhileLoopNode) return false; // checked on its own
            if (!(inner instanceof BinaryOpNode) || inner.op.type === TokenType.AND || inner.op.type === TokenType.OR) return undefined;
            const names = identifiersIn(inner);
            const fixed = names.size > 0 && [...names].every(name => !changed.has(name)) && !containsCall(inner) && assignedIn(inner).size === 0;
            if (!fixed) return undefined;
            const text = printExpression(inner);
            const key = `${node.line}:${text}`;
            const passes = original.visits.get(inner.line) ?? 0;
            if (!seen.has(key) && passes > 1) {
                seen.add(key);
                suggestions.push({
                    line: inner.line,
                    title: 'The same calculation on every pass',
                    explanation: `${text} gives the same answer on every pass of the loop on line ${node.line}, because ${[...names].join(', ')} never change${names.size === 1 ? 's' : ''} inside it, but it is worked out again each time (this line ran ${passes.toLocaleString()} times). Work it out once before the loop and reuse it. Compilers call this loop-invariant code motion.`,
                    replacement: `${words.let} result = ${text};   // before the loop, then use result inside it`,
                    verified: null,
                });
            }
            return false; // don't also report the parts of this calculation
        });
    });
    return suggestions;
}

// fib(n) = fib(n - 1) + fib(n - 2): exponential; a loop keeping the last two answers is linear
function recursionSuggestions(build, staticResult) {
    const suggestions = [];
    for (const fn of staticResult.functions) {
        if (!fn.time.terms.some(t => t.exp.length > 0)) continue;
        const node = build.analysis.functions.find(f => f.name === fn.name).node;
        const suggestion = {
            line: fn.line,
            title: `'${fn.name}' repeats the same work`,
            explanation: `${fn.name} calls itself twice each time, so the number of calls roughly doubles every time ${fn.params[0] ?? 'the input'} grows by one: O(2^${fn.params[0] ?? 'n'}). Most of those calls work out answers it has already worked out. A loop that keeps the last answers does it in O(${fn.params[0] ?? 'n'}).`,
            replacement: null,
            verified: null,
        };
        // The classic Fibonacci shape gets a ready-made loop version, checked against the original
        const loopVersion = fibonacciLoop(build, node, fn);
        if (loopVersion) Object.assign(suggestion, loopVersion);
        suggestions.push(suggestion);
    }
    return suggestions;
}

function fibonacciLoop(build, node, fn) {
    const [p] = fn.params;
    if (fn.params.length !== 1) return null;
    const statements = node.body.statements;
    if (statements.length !== 2) return null;
    const [base, rest] = statements;
    const isFibBase = base instanceof IfStatementNode && !base.alternative
        && base.condition instanceof BinaryOpNode && base.condition.op.type === TokenType.LT
        && base.condition.left instanceof IdentifierNode && base.condition.left.value === p
        && base.condition.right instanceof NumberNode && base.condition.right.value === 2
        && base.consequence.statements.length === 1 && base.consequence.statements[0] instanceof ReturnStatementNode
        && base.consequence.statements[0].expression instanceof IdentifierNode && base.consequence.statements[0].expression.value === p;
    const isCall = (n, minus) => n instanceof CallNode && n.callee.value === fn.name && n.args.length === 1
        && n.args[0] instanceof BinaryOpNode && n.args[0].op.type === TokenType.MINUS
        && n.args[0].left instanceof IdentifierNode && n.args[0].left.value === p
        && n.args[0].right instanceof NumberNode && n.args[0].right.value === minus;
    const sum = rest instanceof ReturnStatementNode ? rest.expression : null;
    const isFibStep = sum instanceof BinaryOpNode && sum.op.type === TokenType.PLUS
        && ((isCall(sum.left, 1) && isCall(sum.right, 2)) || (isCall(sum.left, 2) && isCall(sum.right, 1)));
    if (!isFibBase || !isFibStep) return null;

    const loopName = `${fn.name}Loop`;
    const english = `func ${loopName}(${p}) {
    let a = 0;
    let b = 1;
    for (let i = 0; i < ${p}; i = i + 1) {
        let next = a + b;
        a = b;
        b = next;
    }
    return a;
}`;
    let replacement;
    try {
        replacement = translateKeywords(english, {}, build.settings).code;
    } catch {
        return null;
    }
    // Check: both versions give the same answers for 0 to 15
    const span = blockStatementSpan(build.tokens, node, node.body);
    if (!span) return null;
    const original = build.source.slice(span.start, span.end);
    const words = Object.fromEntries(keywordSpellings(build.settings).map(k => [k.defaultWord, k.word]));
    const tester = (name) => `${words.for} (${words.let} k = 0; k < 16; k = k + 1) { ${words.print}(${name}(k)); }`;
    const runProgram = (source) => {
        try {
            const compiled = compile(source, build.settings);
            return compiled.ok ? runCounting(compiled.bytecode, PROFILE_LIMIT) : null;
        } catch {
            return null;
        }
    };
    const slow = runProgram(`${original}\n${tester(fn.name)}`);
    const fast = runProgram(`${replacement}\n${tester(loopName)}`);
    const ok = slow && fast && slow.finished && fast.finished && slow.output.join() === fast.output.join();
    return {
        replacement,
        verified: ok
            ? { ok: true, before: slow.steps, after: fast.steps, note: 'same answers for 0 to 15' }
            : { ok: false, reason: 'the loop version gave different answers' },
    };
}

// Loops that can never stop, or never start
function loopWarnings(build) {
    const warnings = [];
    walk(build.ast, node => {
        if (node instanceof WhileLoopNode && node.condition instanceof BooleanNode && !node.condition.value) {
            warnings.push({
                line: node.line,
                title: 'This loop never runs',
                explanation: `Its condition is ${printExpression(node.condition)}, so the body is skipped. The optimizer removes it.`,
                replacement: null,
                verified: null,
            });
        } else if (node instanceof WhileLoopNode) {
            const names = identifiersIn(node.condition);
            const changes = assignedIn(node.body);
            const stuck = [...names].every(name => !changes.has(name)) && !containsCall(node.condition);
            if (stuck) {
                const what = names.size > 0 ? `${[...names].join(', ')} never change${names.size === 1 ? 's' : ''} inside it` : 'it never changes';
                warnings.push({
                    line: node.line,
                    title: 'This loop never stops once it starts',
                    explanation: `The condition can't become false, because ${what}. Change something in the condition inside the loop (the compiler stops a loop after 1,000,000 passes).`,
                    replacement: null,
                    verified: null,
                });
            }
        }
        if (node instanceof ForLoopNode && node.initializer instanceof LetStatementNode && node.initializer.expression instanceof NumberNode
            && node.condition instanceof BinaryOpNode && node.condition.right instanceof NumberNode
            && node.condition.left instanceof IdentifierNode && node.condition.left.value === node.initializer.identifier.value) {
            const start = node.initializer.expression.value;
            const limit = node.condition.right.value;
            const runs = node.condition.op.type === TokenType.LT ? start < limit : node.condition.op.type === TokenType.GT ? start > limit : true;
            if (!runs) {
                const symbol = OPERATOR_SYMBOLS[node.condition.op.type];
                warnings.push({
                    line: node.line,
                    title: 'This loop never runs',
                    explanation: `${node.initializer.identifier.value} starts at ${start}, and ${start} ${symbol} ${limit} is already false, so the body is skipped.`,
                    replacement: null,
                    verified: null,
                });
            }
        }
        return undefined;
    });
    return warnings;
}

// --- Measured growth ---

// Labels for how the work grows, from the exponent of the step counts
function classifyGrowth(points) {
    const exponents = [];
    for (let i = 1; i < points.length; i++) exponents.push(Math.log2(points[i].steps / points[i - 1].steps));
    if (exponents.length === 0) return null;
    const recent = exponents.slice(-2);
    const e = recent.reduce((sum, x) => sum + x, 0) / recent.length;
    if (e >= 3.5) return 'exponential';
    if (exponents.length >= 2 && exponents.at(-1) > exponents[0] + 1) return 'exponential';
    if (e < 0.3) {
        const gains = points.slice(1).map((point, i) => point.steps - points[i].steps);
        const growing = gains.length >= 2 && gains.every(gain => gain > 0);
        return growing ? 'log n' : '1';
    }
    if (e < 1.15) return 'n';
    if (e < 1.6) return 'n log n';
    if (e < 2.5) return 'n²';
    return 'n³';
}

function measureGrowth(build, staticResult) {
    // The input size: a variable set to a number at the top level and used in the cost
    const inCost = (name) => staticResult.total.terms.some(t => name in t.vars || name in t.logs || t.exp.includes(name));
    const candidates = build.ast.statements.filter(statement =>
        statement instanceof LetStatementNode && statement.expression instanceof NumberNode && inCost(statement.identifier.value));
    if (candidates.length === 0) return null;
    const sizeVar = candidates[0];
    const name = sizeVar.identifier.value;
    const token = sizeVar.expression.token;

    const points = [];
    let stoppedBecause = null;
    for (const size of GROWTH_SIZES) {
        const source = build.source.slice(0, token.start) + String(size) + build.source.slice(token.start + token.lexeme.length);
        let compiled;
        try {
            compiled = compile(source, build.settings);
        } catch {
            break;
        }
        if (!compiled.ok) break;
        const run = runCounting(compiled.bytecode, MEASURE_LIMIT);
        if (!run.finished) {
            stoppedBecause = run.error ? `${name} = ${size} stopped with an error: ${run.error}` : `${name} = ${size} needs more than ${MEASURE_LIMIT.toLocaleString()} steps`;
            break;
        }
        points.push({ size, steps: run.steps });
    }
    const measured = points.length >= 2 ? classifyGrowth(points) : null;
    const predicted = growthIn(staticResult.total, name);
    return { name, points, measured, predicted, stoppedBecause };
}

// --- Everything together ---

export function adviseComplexity(build) {
    const staticResult = analyzeStaticComplexity(build.ast, build.analysis);
    const original = runCounting(build.bytecode, PROFILE_LIMIT);
    const words = Object.fromEntries(keywordSpellings(build.settings).map(k => [k.defaultWord, k.word]));
    const suggestions = [
        ...rangeLoopSuggestions(build, original, words),
        ...invariantSuggestions(build, original, words),
        ...recursionSuggestions(build, staticResult),
        ...loopWarnings(build),
    ].sort((a, b) => a.line - b.line);
    return {
        static: staticResult,
        growth: measureGrowth(build, staticResult),
        busiest: [...original.visits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
        profileComplete: original.finished,
        suggestions,
    };
}

// Display rows: { text, line, kind } for the Complexity tab
export function adviceRows(build, advice) {
    const rows = [];
    const header = (text) => rows.push({ text, line: null, kind: 'header' });
    const note = (text) => rows.push({ text, line: null, kind: 'note' });
    const lineRow = (text, line) => rows.push({ text, line });
    const sourceLines = build.source.split('\n');
    const { total, memory, loops, functions } = advice.static;

    header('--- Complexity ---');
    note('Big-O tells how the work grows as the input gets bigger, ignoring small details:');
    note('O(n) doubles when n doubles, O(n²) becomes four times as much, O(1) stays the same.');
    note('');
    if (isConstant(total)) {
        lineRow('Time:   O(1). Every loop runs a fixed number of times, so the work never grows.', null);
        note('        To see growth, keep the input size in a variable (let n = 100;) and use it in your loops.');
    } else {
        lineRow(`Time:   ${formatCost(total)}${total.unknown ? '   (? = parts the advisor could not work out)' : ''}`, null);
    }
    lineRow(`Memory: ${formatCost(memory)}${isConstant(memory) ? '   each variable has one fixed slot, and no recursion grows the call stack' : '   the call stack grows with recursion'}`, null);

    if (loops.length > 0 || functions.length > 0) {
        note('');
        header('--- Loops and functions ---');
        for (const loop of loops) {
            const where = loop.inFunction ? ` (in ${loop.inFunction})` : '';
            lineRow(`line ${String(loop.line).padEnd(4)} ${loop.kind}${where}: ${loop.text}`, loop.line);
            if (!isConstant(loop.total)) lineRow(`           with everything inside it: ${formatCost(loop.total)}`, loop.line);
        }
        for (const fn of functions) {
            lineRow(`line ${String(fn.line).padEnd(4)} function ${fn.name}(${fn.params.join(', ')}): time ${formatCost(fn.time)}, memory ${formatCost(fn.memory)}`, fn.line);
            if (fn.note) lineRow(`           ${fn.note}`, fn.line);
        }
    }

    note('');
    header('--- Measured growth ---');
    const growth = advice.growth;
    if (!growth) {
        note('No input size to vary. Put the size in a variable at the top, like let n = 100;, and use n in your loops.');
    } else {
        note(`Ran the program again with ${growth.name} doubled each time, counting VM instructions:`);
        growth.points.forEach((point, index) => {
            const factor = index > 0 ? `   x${(point.steps / growth.points[index - 1].steps).toFixed(1)}` : '';
            lineRow(`  ${growth.name} = ${String(point.size).padEnd(5)} ${point.steps.toLocaleString().padStart(10)} steps${factor}`, null);
        });
        if (growth.stoppedBecause) note(`  (stopped: ${growth.stoppedBecause})`);
        if (growth.measured) {
            const agrees = growth.measured === growth.predicted;
            lineRow(`Measured: grows like ${growth.measured}.  Predicted from the code: ${growth.predicted}.  ${agrees ? 'They agree.' : 'They differ: the estimate may be rough for this program.'}`, null);
        } else {
            note('Not enough runs finished to measure the growth.');
        }
    }

    if (advice.busiest.length > 0) {
        note('');
        header('--- Busiest lines (this run) ---');
        for (const [line, count] of advice.busiest) {
            lineRow(`line ${String(line).padEnd(4)} ran ${count.toLocaleString().padStart(9)} times   ${(sourceLines[line - 1] ?? '').trim()}`, line);
        }
        if (!advice.profileComplete) note(`(the run was long, so only its first ${PROFILE_LIMIT.toLocaleString()} instructions were counted)`);
    }

    note('');
    header('--- Suggestions ---');
    if (advice.suggestions.length === 0) note('No known patterns to improve in this program.');
    for (const suggestion of advice.suggestions) {
        lineRow(`line ${suggestion.line}: ${suggestion.title}`, suggestion.line);
        note(`  ${suggestion.explanation}`);
        if (suggestion.replacement) {
            note('  Instead:');
            suggestion.replacement.split('\n').forEach(text => lineRow(`      ${text}`, suggestion.line));
        }
        if (suggestion.verified?.ok) {
            const extra = suggestion.verified.note ? ` (${suggestion.verified.note})` : '';
            lineRow(`  Checked on the VM: same output${extra}, ${suggestion.verified.before.toLocaleString()} -> ${suggestion.verified.after.toLocaleString()} instructions.`, suggestion.line);
        } else if (suggestion.verified) {
            note(`  Not checked: ${suggestion.verified.reason}.`);
        }
        note('');
    }
    return rows;
}
