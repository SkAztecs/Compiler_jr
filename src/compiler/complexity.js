import { TokenType } from '../../token.js';
import {
    BlockStatementNode,
    LetStatementNode,
    AssignmentNode,
    PrintStatementNode,
    IfStatementNode,
    WhileLoopNode,
    ForLoopNode,
    BinaryOpNode,
    UnaryOpNode,
    IdentifierNode,
    NumberNode,
    BooleanNode,
    FunctionDeclarationNode,
    ReturnStatementNode,
    CallNode
} from '../../ast.js';

// The complexity advisor, part 1: Big-O estimates read from the syntax tree.
//
// A cost is a sum of terms, each a product like n², n·m, n log n or 2ⁿ, written in the
// names used in the program. Statements in a row add their costs (the biggest term
// wins), a loop multiplies its body's cost by how many times it runs, and a recursive
// function is solved from how it calls itself. Anything it can't work out is marked
// unknown instead of guessed.

// --- Costs ---

const term = (vars = {}, logs = {}, exp = []) => ({ vars, logs, exp });
export const constantCost = () => ({ terms: [term()], unknown: false });
const unknownCost = () => ({ terms: [term()], unknown: true });

// True when term a grows at least as fast as term b (so b can be dropped from a sum)
function dominates(a, b) {
    if (!b.exp.every(v => a.exp.includes(v))) return false;
    if (a.exp.length > b.exp.length) return true; // 2ⁿ beats any polynomial
    const names = new Set([...Object.keys(a.vars), ...Object.keys(b.vars), ...Object.keys(a.logs), ...Object.keys(b.logs)]);
    for (const name of names) {
        const da = a.vars[name] ?? 0;
        const db = b.vars[name] ?? 0;
        if (da < db) return false;
        if (da === db && (a.logs[name] ?? 0) < (b.logs[name] ?? 0)) return false;
    }
    return true;
}

function simplify(terms) {
    const kept = [];
    terms.forEach((candidate, index) => {
        const covered = terms.some((other, otherIndex) => otherIndex !== index && dominates(other, candidate)
            && (!dominates(candidate, other) || otherIndex < index));
        if (!covered) kept.push(candidate);
    });
    return kept.length > 0 ? kept : [term()];
}

export function addCost(a, b) {
    return { terms: simplify([...a.terms, ...b.terms]), unknown: a.unknown || b.unknown };
}

export function mulCost(a, b) {
    const terms = [];
    for (const x of a.terms) {
        for (const y of b.terms) {
            const vars = { ...x.vars };
            Object.entries(y.vars).forEach(([name, degree]) => { vars[name] = (vars[name] ?? 0) + degree; });
            const logs = { ...x.logs };
            Object.entries(y.logs).forEach(([name, count]) => { logs[name] = (logs[name] ?? 0) + count; });
            terms.push(term(vars, logs, [...new Set([...x.exp, ...y.exp])]));
        }
    }
    return { terms: simplify(terms), unknown: a.unknown || b.unknown };
}

// log of a cost: log(n²·m) grows like log n + log m
function logCost(cost) {
    const names = new Set(cost.terms.flatMap(t => [...Object.keys(t.vars), ...t.exp]));
    if (names.size === 0) return { ...constantCost(), unknown: cost.unknown };
    return { terms: simplify([...names].map(name => term({}, { [name]: 1 }))), unknown: cost.unknown };
}

const SUPERSCRIPT = { 2: '²', 3: '³', 4: '⁴', 5: '⁵' };

function formatTerm(t) {
    const parts = [
        ...t.exp.map(name => `2^${name}`),
        ...Object.entries(t.vars).sort().map(([name, degree]) => degree === 1 ? name : `${name}${SUPERSCRIPT[degree] ?? `^${degree}`}`),
    ];
    const logs = Object.entries(t.logs).sort().map(([name, count]) => count === 1 ? `log ${name}` : `(log ${name})${SUPERSCRIPT[count] ?? `^${count}`}`);
    const text = [parts.join('·'), ...logs].filter(Boolean).join(' ');
    return text || '1';
}

export function formatCost(cost) {
    const text = `O(${cost.terms.map(formatTerm).join(' + ')})`;
    return cost.unknown ? `${text}?` : text;
}

export function isConstant(cost) {
    return !cost.unknown && cost.terms.every(t => t.exp.length === 0 && Object.keys(t.vars).length === 0 && Object.keys(t.logs).length === 0);
}

// How a cost grows with one name, as a label used to compare with measurements
export function growthIn(cost, name) {
    let best = { exp: false, degree: 0, logs: 0 };
    for (const t of cost.terms) {
        const candidate = { exp: t.exp.includes(name), degree: t.vars[name] ?? 0, logs: t.logs[name] ?? 0 };
        const better = (candidate.exp && !best.exp)
            || (candidate.exp === best.exp && (candidate.degree > best.degree || (candidate.degree === best.degree && candidate.logs > best.logs)));
        if (better) best = candidate;
    }
    if (best.exp) return 'exponential';
    if (best.degree === 0) return best.logs > 0 ? 'log n' : '1';
    const poly = best.degree === 1 ? 'n' : `n${SUPERSCRIPT[best.degree] ?? `^${best.degree}`}`;
    return best.logs > 0 ? `${poly} log n` : poly;
}

// --- Looking at the syntax tree ---

function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    const children = node.statements ?? [
        node.expression, node.condition, node.consequence, node.alternative, node.body,
        node.initializer, node.increment, node.left, node.right, ...(node.args ?? []),
    ];
    children.forEach(child => walk(child, visit));
}

export function identifiersIn(node) {
    const names = new Set();
    walk(node, child => {
        if (child instanceof IdentifierNode) names.add(child.value);
        if (child instanceof AssignmentNode) names.add(child.identifier.value);
    });
    return names;
}

export function assignedIn(node) {
    const names = new Set();
    walk(node, child => {
        if (child instanceof AssignmentNode) names.add(child.identifier.value);
        if (child instanceof LetStatementNode) names.add(child.identifier.value);
    });
    return names;
}

export function containsCall(node) {
    let found = false;
    walk(node, child => { if (child instanceof CallNode) found = true; });
    return found;
}

const numberValue = (node) => {
    if (node instanceof NumberNode) return node.value;
    if (node instanceof UnaryOpNode && node.op.type === TokenType.MINUS && node.right instanceof NumberNode) return -node.right.value;
    return null;
};

// v = v + c, v = v - c, v = v * c, v = v / c  ->  { variable, kind: '+', amount }
function stepOf(assignment) {
    if (!(assignment instanceof AssignmentNode) || !(assignment.expression instanceof BinaryOpNode)) return null;
    const v = assignment.identifier.value;
    const { left, right, op } = assignment.expression;
    const kinds = { [TokenType.PLUS]: '+', [TokenType.MINUS]: '-', [TokenType.MULTIPLY]: '*', [TokenType.DIVIDE]: '/' };
    const kind = kinds[op.type];
    if (!kind) return null;
    let amount = null;
    if (left instanceof IdentifierNode && left.value === v) amount = numberValue(right);
    else if ((kind === '+' || kind === '*') && right instanceof IdentifierNode && right.value === v) amount = numberValue(left);
    if (amount === null || amount <= 0) return null;
    if ((kind === '*' || kind === '/') && amount <= 1) return null;
    return { variable: v, kind, amount };
}

// v < E, v > E, E > v, E < v  ->  { variable, bound, direction } where direction 'up' means v < E
function comparisonOf(condition, variable = null) {
    if (!(condition instanceof BinaryOpNode)) return null;
    const { left, right, op } = condition;
    if (op.type !== TokenType.LT && op.type !== TokenType.GT && op.type !== TokenType.NOT_EQ) return null;
    const isVar = (node) => node instanceof IdentifierNode && (variable === null || node.value === variable);
    if (isVar(left)) return { variable: left.value, bound: right, direction: op.type === TokenType.GT ? 'down' : 'up' };
    if (isVar(right)) return { variable: right.value, bound: left, direction: op.type === TokenType.LT ? 'down' : 'up' };
    return null;
}

// --- The analysis ---

export function analyzeStaticComplexity(ast, analysis) {
    return new StaticAnalysis(ast, analysis).run();
}

class StaticAnalysis {
    constructor(ast, analysis) {
        this.ast = ast;
        this.functions = new Map((analysis.functions ?? []).map(fn => [fn.name, fn]));
        this.functionCosts = new Map(); // name -> { time, memory, note }
        this.inProgress = new Set();
        this.loops = [];                // one entry per loop: line, iterations, total cost
        this.callMemory = constantCost(); // call-stack memory of the calls in the code being analysed
    }

    run() {
        const main = this.ast.statements.filter(statement => !(statement instanceof FunctionDeclarationNode));
        const total = this.sequence(main, new Map(), null);
        // Memory: every variable has one fixed slot, so only the call stack can grow
        const memory = this.callMemory;
        const functions = [...this.functions.values()].map(fn => ({ name: fn.name, line: fn.line, params: fn.params, ...this.functionCost(fn) }));
        return { total, memory, loops: this.loops.sort((a, b) => a.line - b.line), functions };
    }

    sequence(statements, env, fn) {
        const starts = new Map(); // variable -> the value it was last given in this list
        let cost = constantCost();
        for (const statement of statements) {
            cost = addCost(cost, this.statement(statement, env, fn, starts));
            if (statement instanceof LetStatementNode || statement instanceof AssignmentNode) {
                starts.set(statement.identifier.value, statement.expression);
            }
        }
        return cost;
    }

    statement(node, env, fn, starts = new Map()) {
        if (node instanceof BlockStatementNode) return this.sequence(node.statements, env, fn);
        if (node instanceof IfStatementNode) {
            const branches = addCost(this.statement(node.consequence, env, fn), node.alternative ? this.statement(node.alternative, env, fn) : constantCost());
            return addCost(this.expression(node.condition, env, fn), branches);
        }
        if (node instanceof ForLoopNode || node instanceof WhileLoopNode) return this.loop(node, env, fn, starts);
        if (node instanceof LetStatementNode || node instanceof PrintStatementNode || node instanceof ReturnStatementNode) {
            return node.expression ? this.expression(node.expression, env, fn) : constantCost();
        }
        if (node instanceof FunctionDeclarationNode) return constantCost();
        return this.expression(node, env, fn);
    }

    // The cost of working out an expression: only function calls cost more than a step
    expression(node, env, fn) {
        let cost = constantCost();
        walk(node, child => {
            if (child instanceof CallNode) {
                if (fn && child.callee.value === fn.name) return; // the recursion is solved separately
                cost = addCost(cost, this.callCost(child, env, 'time'));
                this.callMemory = addCost(this.callMemory, this.callCost(child, env, 'memory'));
            }
        });
        return cost;
    }

    // How big an expression's value can get, in the program's names (used for loop bounds)
    size(node, env) {
        if (numberValue(node) !== null) return constantCost();
        if (node instanceof IdentifierNode) {
            if (env.has(node.value)) return env.get(node.value); // an outer loop's variable
            return { terms: [term({ [node.value]: 1 })], unknown: false };
        }
        if (node instanceof BinaryOpNode) {
            const left = this.size(node.left, env);
            const right = this.size(node.right, env);
            if (node.op.type === TokenType.PLUS || node.op.type === TokenType.MINUS) return addCost(left, right);
            if (node.op.type === TokenType.MULTIPLY) return mulCost(left, right);
            if (node.op.type === TokenType.DIVIDE) return left;
        }
        if (node instanceof UnaryOpNode) return this.size(node.right, env);
        return unknownCost(); // a call or something else whose value can't be predicted
    }

    // How many times a loop runs: { cost, text, variable } or an unknown cost with a reason
    iterations(node, env, starts = new Map()) {
        const unknown = (text) => ({ cost: unknownCost(), text, variable: null });
        let step;
        let comparison;
        let start = null;
        if (node instanceof ForLoopNode) {
            step = node.increment ? stepOf(node.increment) : null;
            if (!step) return unknown("can't tell how many times it runs (the update isn't a simple + - * / by a number)");
            comparison = node.condition ? comparisonOf(node.condition, step.variable) : null;
            if (node.initializer instanceof LetStatementNode || node.initializer instanceof AssignmentNode) start = node.initializer.expression;
        } else if (node.condition instanceof BooleanNode && !node.condition.value) {
            return { cost: constantCost(), text: 'runs 0 times (its condition is always false)', variable: null, fixed: 0 };
        } else {
            comparison = comparisonOf(node.condition);
            if (!comparison) return unknown("can't tell how many times it runs (the condition isn't a simple comparison)");
            // The update must happen on every pass: a statement directly in the body
            const update = node.body.statements.find(statement => stepOf(statement)?.variable === comparison.variable);
            step = update ? stepOf(update) : null;
            if (!step) return unknown(`can't tell how many times it runs ('${comparison.variable}' doesn't change by a fixed amount on every pass)`);
            // Counting up from the value set just before the loop (like 'let i = 0;'). Counting down,
            // the variable itself is what shrinks, so its size is the input: 'while (n > 1) n = n / 2'
            if (comparison.direction === 'up') start = starts.get(comparison.variable) ?? null;
        }
        if (!comparison) return unknown("can't tell how many times it runs (the condition doesn't compare the loop variable)");

        const v = step.variable;
        const changedInside = assignedIn(node.body);
        const updatesInBody = node instanceof ForLoopNode && changedInside.has(v);
        const boundChanges = [...identifiersIn(comparison.bound)].some(name => changedInside.has(name) && name !== v);
        if (updatesInBody || boundChanges || containsCall(comparison.bound)) {
            return unknown("can't tell how many times it runs (its limit or its variable also changes inside the loop)");
        }
        const goesUp = step.kind === '+' || step.kind === '*';
        if (goesUp !== (comparison.direction === 'up')) {
            return unknown(`'${v}' moves away from its limit, so the loop either never runs or never stops`);
        }

        const bound = this.size(comparison.bound, env);
        const countingDownWhile = node instanceof WhileLoopNode && comparison.direction === 'down';
        const from = countingDownWhile ? this.size(new IdentifierNode({ value: v }), env)
            : start ? this.size(start, env) : constantCost();
        const startValue = start && !countingDownWhile ? numberValue(start) : null;
        const boundValue = numberValue(comparison.bound);

        if (step.kind === '+' || step.kind === '-') {
            // Counting by a fixed step: as many passes as the distance to the limit
            if (startValue !== null && boundValue !== null) {
                const distance = comparison.direction === 'up' ? boundValue - startValue : startValue - boundValue;
                const passes = Math.max(0, Math.ceil(distance / step.amount));
                return { cost: constantCost(), text: `runs ${passes} ${passes === 1 ? 'time' : 'times'} (a fixed number)`, variable: v, fixed: passes };
            }
            const distance = step.kind === '+' ? addCost(bound, from) : addCost(from, bound);
            const per = step.amount === 1 ? '' : ` (counting by ${step.amount})`;
            return { cost: distance, text: `runs about ${formatCost(distance).slice(2, -1)} times${per}`, variable: v };
        }
        // Multiplying or dividing: the distance shrinks by a factor each pass, so log of it
        const range = step.kind === '*' ? bound : from;
        const cost = logCost(range);
        const verb = step.kind === '*' ? `multiplies by ${step.amount}` : `divides by ${step.amount}`;
        if (isConstant(range)) return { cost: constantCost(), text: `runs a fixed number of times ('${v}' ${verb} each pass)`, variable: v };
        return { cost, text: `runs about ${formatCost(cost).slice(2, -1)} times ('${v}' ${verb} each pass)`, variable: v };
    }

    loop(node, env, fn, starts) {
        const passes = this.iterations(node, env, starts);
        const inner = new Map(env);
        if (passes.variable && !passes.cost.unknown) {
            const bound = comparisonOf(node.condition, passes.variable)?.bound;
            if (bound) inner.set(passes.variable, this.size(bound, env));
        }
        let body = this.statement(node.body, inner, fn);
        if (node.condition) body = addCost(body, this.expression(node.condition, inner, fn));
        if (node instanceof ForLoopNode && node.increment) body = addCost(body, this.expression(node.increment, inner, fn));
        const total = mulCost(passes.cost, body);
        const setup = node instanceof ForLoopNode && node.initializer ? this.statement(node.initializer, env, fn) : constantCost();
        this.loops.push({
            line: node.line,
            kind: node instanceof ForLoopNode ? 'for loop' : 'while loop',
            text: passes.text,
            fixed: passes.fixed ?? null,
            total,
            inFunction: fn?.name ?? null,
        });
        return addCost(setup, total);
    }

    // The cost of one call, written in the caller's names
    callCost(call, env, which) {
        const fn = this.functions.get(call.callee.value);
        if (!fn) return constantCost();
        const cost = this.functionCost(fn);
        const own = which === 'memory' ? cost.memory : cost.time;
        // Replace each parameter name by how big the argument is
        let result = { terms: [], unknown: own.unknown };
        for (const t of own.terms) {
            let part = constantCost();
            for (const [name, degree] of Object.entries(t.vars)) {
                const index = fn.params.indexOf(name);
                const size = index >= 0 && call.args[index] ? this.size(call.args[index], env) : unknownCost();
                for (let i = 0; i < degree; i++) part = mulCost(part, size);
            }
            for (const [name, count] of Object.entries(t.logs)) {
                const index = fn.params.indexOf(name);
                const size = index >= 0 && call.args[index] ? logCost(this.size(call.args[index], env)) : unknownCost();
                for (let i = 0; i < count; i++) part = mulCost(part, size);
            }
            for (const name of t.exp) {
                const index = fn.params.indexOf(name);
                const size = index >= 0 && call.args[index] ? this.size(call.args[index], env) : unknownCost();
                const names = new Set(size.terms.flatMap(s => Object.keys(s.vars)));
                if (names.size > 0) part = mulCost(part, { terms: [term({}, {}, [...names])], unknown: size.unknown });
            }
            result = { terms: [...result.terms, ...part.terms], unknown: result.unknown || part.unknown };
        }
        return { terms: simplify(result.terms), unknown: result.unknown };
    }

    // A function's time and memory, written in its parameter names
    functionCost(fn) {
        if (this.functionCosts.has(fn.name)) return this.functionCosts.get(fn.name);
        if (this.inProgress.has(fn.name)) {
            return { time: unknownCost(), memory: unknownCost(), note: 'calls itself through another function' };
        }
        this.inProgress.add(fn.name);
        const outerMemory = this.callMemory;
        this.callMemory = constantCost();
        const body = this.statement(fn.node.body, new Map(), fn);
        const calleeMemory = this.callMemory; // stack space of the functions this one calls
        this.callMemory = outerMemory;

        // Find how it calls itself
        const selfCalls = [];
        let callInLoop = false;
        walk(fn.node.body, node => {
            if ((node instanceof ForLoopNode || node instanceof WhileLoopNode)) {
                walk(node.body, inner => { if (inner instanceof CallNode && inner.callee.value === fn.name) callInLoop = true; });
            }
            if (node instanceof CallNode && node.callee.value === fn.name) selfCalls.push(node);
        });

        let result;
        if (selfCalls.length === 0) {
            result = { time: body, memory: constantCost(), note: null };
        } else {
            // Each call must shrink a parameter: n - c (one step smaller) or n / c (a fraction)
            const shrink = selfCalls.map(call => {
                for (let i = 0; i < fn.params.length; i++) {
                    const arg = call.args[i];
                    if (arg instanceof BinaryOpNode && arg.left instanceof IdentifierNode && arg.left.value === fn.params[i] && numberValue(arg.right) > 0) {
                        if (arg.op.type === TokenType.MINUS) return { param: fn.params[i], kind: 'minus' };
                        if (arg.op.type === TokenType.DIVIDE && numberValue(arg.right) > 1) return { param: fn.params[i], kind: 'divide', by: numberValue(arg.right) };
                    }
                }
                return null;
            });
            const p = shrink[0]?.param;
            const sameParam = shrink.every(s => s && s.param === p);
            const kind = sameParam ? shrink[0].kind : null;
            const a = selfCalls.length;
            const n = { terms: [term({ [p]: 1 })], unknown: false };
            const logN = { terms: [term({}, { [p]: 1 })], unknown: false };
            if (!sameParam || callInLoop || (kind === 'divide' && !shrink.every(s => s.by === shrink[0].by))) {
                result = { time: unknownCost(), memory: unknownCost(), note: "calls itself in a way this advisor can't solve" };
            } else if (kind === 'minus' && a === 1) {
                result = { time: mulCost(n, body), memory: n, note: `calls itself once with a smaller '${p}': about ${p} calls deep` };
            } else if (kind === 'minus') {
                result = {
                    time: { terms: [term({}, {}, [p])], unknown: body.unknown },
                    memory: n,
                    note: `calls itself ${a} times each time: the number of calls about doubles with every step of '${p}'`,
                };
            } else if (a === 1) {
                result = { time: mulCost(logN, body), memory: logN, note: `calls itself once with '${p}' divided: about log ${p} calls deep` };
            } else if (a === shrink[0].by && isConstant(body)) {
                result = { time: n, memory: logN, note: `splits '${p}' into ${a} parts each time` };
            } else {
                result = { time: unknownCost(), memory: logN, note: "calls itself in a way this advisor can't solve" };
            }
        }
        result.memory = addCost(result.memory, calleeMemory);
        this.inProgress.delete(fn.name);
        this.functionCosts.set(fn.name, result);
        return result;
    }
}
