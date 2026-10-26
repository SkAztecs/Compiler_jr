import { TokenType } from '../../token.js';
import {
    ProgramNode,
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
    StringNode,
    BooleanNode,
    FunctionDeclarationNode,
    ReturnStatementNode,
    CallNode
} from '../../ast.js';
import { returnsValue } from '../interpreter/evaluator.js';
import { OPERATOR_SYMBOLS } from './runtime.js';
import { keywordSpellings } from '../interpreter/lexer.js';

// Phase 3: Semantic analysis.
// Walks the AST once to build the symbol table (which 'let' each name refers to),
// then infers the possible types of every variable and reports mistakes that are
// certain to fail, before the program ever runs.

const NUMBER = 'number';
const STRING = 'string';
const BOOLEAN = 'boolean';

// A scope is one level of the symbol table: the whole program, a { block }, or a for loop
class Scope {
    constructor(parent, kind, line) {
        this.parent = parent; // (Module 1) Link to the enclosing scope (stack-like)
        this.kind = kind;
        this.line = line;
        this.symbols = new Map(); // (Module 4) Hash table: name -> symbol
    }

    lookup(name) {
        for (let scope = this; scope !== null; scope = scope.parent) {
            if (scope.symbols.has(name)) return scope.symbols.get(name);
        }
        return null;
    }

    visibleNames() {
        const names = [];
        for (let scope = this; scope !== null; scope = scope.parent) {
            names.push(...scope.symbols.keys());
        }
        return names;
    }

    describe() {
        if (this.kind === 'global') return 'global';
        return `${this.kind} (line ${this.line})`;
    }
}

// Edit distance, used to suggest a name when a beginner mistypes one
function editDistance(a, b) {
    const dist = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dist[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost);
        }
    }
    return dist[a.length][b.length];
}

// The closest candidate to a mistyped name, if it is close enough to be a likely typo
function closestMatch(name, candidates) {
    return candidates
        .map(candidate => ({ candidate, distance: editDistance(name, candidate) }))
        .filter(({ distance }) => distance > 0 && distance <= 2 && distance <= name.length / 2)
        .sort((a, b) => a.distance - b.distance)[0] ?? null;
}

// Where a problem is, for the code frame under the error: line, column and how many characters
function locate(node, length) {
    return { line: node.line, column: node.column ?? null, length };
}

function describeTypes(types) {
    return [...types].join(' or ');
}

// The types an expression can have: a set of 'number', 'string' and 'boolean'.
// Variables have every type ever stored in them (see inferTypes), so this is only
// complete once analysis has finished. Code generators use it too.
export function typeOfExpression(node, resolutions) {
    const typeOf = (child) => typeOfExpression(child, resolutions);
    if (node instanceof NumberNode) return new Set([NUMBER]);
    if (node instanceof StringNode) return new Set([STRING]);
    if (node instanceof BooleanNode) return new Set([BOOLEAN]);
    if (node instanceof IdentifierNode) return resolutions.get(node)?.types ?? new Set();
    if (node instanceof CallNode) return resolutions.get(node.callee)?.types ?? new Set(); // what the function returns
    if (node instanceof AssignmentNode) return typeOf(node.expression);
    if (node instanceof UnaryOpNode) {
        return new Set([node.op.type === TokenType.BANG ? BOOLEAN : NUMBER]);
    }
    if (node instanceof BinaryOpNode) {
        switch (node.op.type) {
            case TokenType.MINUS:
            case TokenType.MULTIPLY:
            case TokenType.DIVIDE:
                return new Set([NUMBER]);
            case TokenType.PLUS: {
                const left = typeOf(node.left);
                const right = typeOf(node.right);
                const result = new Set();
                if (left.has(STRING) || right.has(STRING)) result.add(STRING);
                if (left.has(NUMBER) && right.has(NUMBER)) result.add(NUMBER);
                return result;
            }
            default:
                return new Set([BOOLEAN]); // comparisons and && || always give true/false
        }
    }
    return new Set();
}

export function analyze(ast, settings = {}) {
    return new SemanticAnalyzer(settings).analyze(ast);
}

class SemanticAnalyzer {
    constructor(settings) {
        this.keywords = keywordSpellings(settings);
        this.letWord = this.keywords.find(keyword => keyword.defaultWord === 'let').word;
        this.symbols = [];
        this.errors = [];
        this.warnings = [];
        this.resolutions = new Map(); // IdentifierNode -> symbol it refers to
        this.typeSources = [];        // [symbol, expression] for every value stored in a variable
        this.operations = [];         // operator nodes to type-check once types are known
        this.undefinedUses = [];      // names used before (or without) a 'let'
        this.nameCounts = new Map();  // how many symbols share a name, for unique IR names
        this.functions = new Map();   // name -> function symbol (its 'types' are what it returns)
        this.currentFunction = null;  // the function whose body is being analysed
        this.calls = [];              // calls to check once every function's parameters are known
    }

    analyze(ast) {
        this.scope = new Scope(null, 'global', ast.line);
        this.declareFunctions(ast);
        this.visitStatement(ast);
        this.linkCallArguments();
        this.reportUndefinedUses();
        this.inferTypes();
        this.checkOperatorTypes();
        this.reportUnusedSymbols();

        const byLine = (a, b) => a.line - b.line;
        return {
            symbols: this.symbols,
            functions: [...this.functions.values()],
            errors: this.errors.sort(byLine),
            warnings: this.warnings.sort(byLine),
            resolutions: this.resolutions,
        };
    }

    // --- Pass 1: scopes and name resolution ---

    // Functions can be called before the line that defines them, so they are
    // all registered first
    declareFunctions(ast) {
        for (const statement of ast.statements) {
            if (!(statement instanceof FunctionDeclarationNode)) continue;
            const name = statement.name.value;
            if (this.functions.has(name)) {
                this.errors.push({ ...locate(statement.name, name.length), message: `There is already a function called '${name}' (line ${this.functions.get(name).line}). Each function needs its own name.` });
                continue;
            }
            const fn = {
                name,
                irName: name,
                isFunction: true,
                line: statement.line,
                column: statement.name.column,
                params: statement.params.map(param => param.value),
                paramSymbols: [],
                returnsValue: returnsValue(statement.body),
                types: new Set(), // the types it can return
                calls: 0,
                node: statement,
            };
            this.functions.set(name, fn);
            this.resolutions.set(statement.name, fn);
        }
    }

    visitFunction(node) {
        const fn = this.resolutions.get(node.name);
        if (this.scope.kind !== 'global' || !fn || fn.node !== node) {
            if (this.scope.kind !== 'global') {
                this.errors.push({ ...locate(node, 1), message: 'Functions can only be created at the top level of the program, not inside a block, a loop or another function.' });
            }
            return;
        }
        // A function's scope has no parent: it only sees its parameters and its own variables
        const outer = this.scope;
        this.scope = new Scope(null, `function ${fn.name}`, node.line);
        this.currentFunction = fn;
        this.returns = { value: [], bare: [] };
        for (const param of node.params) {
            if (this.scope.symbols.has(param.value)) {
                this.errors.push({ ...locate(param, param.value.length), message: `'${param.value}' is used twice as a parameter of '${fn.name}'. Each parameter needs its own name.` });
                continue;
            }
            fn.paramSymbols.push(this.declare(param, param.line, true));
        }
        this.visitStatement(node.body);
        if (this.returns.value.length > 0 && this.returns.bare.length > 0) {
            const bare = this.returns.bare[0];
            this.errors.push({ ...locate(bare, 1), message: `'${fn.name}' gives back a value on line ${this.returns.value[0].line}, so this return needs a value too.` });
        }
        this.currentFunction = null;
        this.scope = outer;
    }

    visitCall(node, asStatement) {
        node.args.forEach(arg => this.visitExpression(arg)); // worked out left to right, before the call
        const name = node.callee.value;
        const fn = this.functions.get(name);
        const where = locate(node.callee, name.length);
        if (!fn) {
            const english = this.keywords.find(keyword => keyword.defaultWord === name && keyword.word !== name);
            if (english) {
                this.errors.push({ ...where, message: `'${name}' is the English keyword. In your current language it is written '${english.word}'.` });
            } else if (this.scope.lookup(name)) {
                this.errors.push({ ...where, message: `'${name}' is a variable, not a function, so it can't be called with ( ).` });
            } else {
                const keyword = closestMatch(name, this.keywords.map(k => k.word));
                const similar = closestMatch(name, [...this.functions.keys()]);
                const hint = keyword && (!similar || keyword.distance <= similar.distance) ? ` Did you mean the keyword '${keyword.candidate}'?`
                    : similar ? ` Did you mean '${similar.candidate}'?` : '';
                this.errors.push({ ...where, message: `There is no function called '${name}'.${hint}` });
            }
            return;
        }
        fn.calls++;
        this.resolutions.set(node.callee, fn);
        if (node.args.length !== fn.params.length) {
            const wanted = fn.params.length === 1 ? '1 value' : `${fn.params.length} values`;
            const list = fn.params.length > 0 ? ` (${fn.params.join(', ')})` : '';
            this.errors.push({ ...where, message: `'${name}' needs ${wanted}${list}, but got ${node.args.length}.` });
            return;
        }
        if (!asStatement && !fn.returnsValue) {
            this.errors.push({ ...where, message: `'${name}' doesn't give back a value (it has no return with a value), so its result can't be used here. Call it on its own line instead.` });
        }
        this.calls.push({ fn, node });
    }

    // Each argument is a value stored in a parameter, for type inference
    linkCallArguments() {
        for (const { fn, node } of this.calls) {
            node.args.forEach((arg, index) => {
                if (fn.paramSymbols[index]) this.typeSources.push([fn.paramSymbols[index], arg]);
            });
        }
    }

    withScope(kind, line, visit) {
        this.scope = new Scope(this.scope, kind, line);
        visit();
        this.scope = this.scope.parent;
    }

    visitStatement(node) {
        if (node instanceof ProgramNode) {
            node.statements.forEach(statement => this.visitStatement(statement));
        } else if (node instanceof BlockStatementNode) {
            this.withScope('block', node.line, () => {
                node.statements.forEach(statement => this.visitStatement(statement));
            });
        } else if (node instanceof LetStatementNode) {
            // The value is read before the new name exists: 'let x = x + 1' reads an outer x
            this.visitExpression(node.expression);
            const symbol = this.declare(node.identifier, node.line);
            this.typeSources.push([symbol, node.expression]);
        } else if (node instanceof PrintStatementNode) {
            this.visitExpression(node.expression);
        } else if (node instanceof IfStatementNode) {
            this.visitExpression(node.condition);
            this.visitStatement(node.consequence);
            if (node.alternative !== null) this.visitStatement(node.alternative);
        } else if (node instanceof WhileLoopNode) {
            this.visitExpression(node.condition);
            this.visitStatement(node.body);
        } else if (node instanceof ForLoopNode) {
            // The loop variable lives in its own scope around the body
            this.withScope('for loop', node.line, () => {
                if (node.initializer instanceof LetStatementNode) this.visitStatement(node.initializer);
                else if (node.initializer) this.visitExpression(node.initializer);
                if (node.condition) this.visitExpression(node.condition);
                if (node.increment) this.visitExpression(node.increment);
                this.visitStatement(node.body);
            });
        } else if (node instanceof FunctionDeclarationNode) {
            this.visitFunction(node);
        } else if (node instanceof ReturnStatementNode) {
            if (!this.currentFunction) {
                this.errors.push({ ...locate(node, 1), message: "'return' can only be used inside a function." });
                if (node.expression) this.visitExpression(node.expression);
                return;
            }
            if (node.expression) {
                this.visitExpression(node.expression);
                this.typeSources.push([this.currentFunction, node.expression]);
                this.returns.value.push(node);
            } else {
                this.returns.bare.push(node);
            }
        } else if (node instanceof CallNode) {
            this.visitCall(node, true); // a call on its own line: its result is not needed
        } else {
            this.visitExpression(node); // Expression statement
        }
    }

    visitExpression(node) {
        if (node instanceof IdentifierNode) {
            const symbol = this.resolve(node, 'read');
            if (symbol) symbol.reads++;
        } else if (node instanceof AssignmentNode) {
            this.visitExpression(node.expression);
            const symbol = this.resolve(node.identifier, 'assign');
            if (symbol) {
                symbol.writes++;
                this.typeSources.push([symbol, node.expression]);
            }
        } else if (node instanceof BinaryOpNode) {
            this.visitExpression(node.left);
            this.visitExpression(node.right);
            this.operations.push(node);
        } else if (node instanceof UnaryOpNode) {
            this.visitExpression(node.right);
            this.operations.push(node);
        } else if (node instanceof CallNode) {
            this.visitCall(node, false);
        }
        // Number, string and boolean literals need no checks
    }

    declare(identifier, line, isParameter = false) {
        const name = identifier.value;
        if (this.functions.has(name)) {
            this.errors.push({ ...locate(identifier, name.length), message: `'${name}' is already the name of a function (line ${this.functions.get(name).line}). Choose a different name for the variable.` });
        }
        const existing = this.scope.symbols.get(name);
        if (existing) {
            // Same scope: the Evaluator just overwrites the value, so it is the same variable
            const where = this.scope.kind === 'global' ? 'in this program' : 'in this block';
            this.warnings.push({
                ...locate(identifier, name.length),
                line,
                message: `'${name}' is already declared ${where} (line ${existing.line}). To change it, write '${name} = ...' without '${this.letWord}'.`,
            });
            existing.writes++;
            this.resolutions.set(identifier, existing);
            return existing;
        }

        const count = (this.nameCounts.get(name) || 0) + 1;
        this.nameCounts.set(name, count);
        const symbol = {
            id: this.symbols.length,
            name,
            // Unique name used in the IR; never the same as a compiler temp (t1, t2...)
            irName: count === 1 && !/^t\d+$/.test(name) ? name : `${name}@${count}`,
            scope: this.scope.describe(),
            isGlobal: this.scope.kind === 'global',
            owner: this.currentFunction?.name ?? null, // the function it belongs to, or null for the main program
            isParameter,
            line,
            column: identifier.column,
            types: new Set(),
            reads: 0,
            writes: 1,
        };
        this.symbols.push(symbol);
        this.scope.symbols.set(name, symbol);
        this.resolutions.set(identifier, symbol);
        return symbol;
    }

    resolve(identifier, use) {
        const symbol = this.scope.lookup(identifier.value);
        if (symbol) {
            this.resolutions.set(identifier, symbol);
            return symbol;
        }
        const where = locate(identifier, identifier.value.length);
        if (this.functions.has(identifier.value)) {
            const message = use === 'assign'
                ? `'${identifier.value}' is a function, so it can't be given a new value.`
                : `'${identifier.value}' is a function. To use it, call it with ( ), like ${identifier.value}(...).`;
            this.errors.push({ ...where, message });
            return null;
        }
        this.undefinedUses.push({ name: identifier.value, ...where, use, visible: this.scope.visibleNames(), inFunction: this.currentFunction?.name ?? null });
        return null;
    }

    reportUndefinedUses() {
        for (const { name, line, column, length, use, visible, inFunction } of this.undefinedUses) {
            const where = { line, column, length };

            // A main-program variable used inside a function
            if (inFunction && this.symbols.some(symbol => symbol.name === name && symbol.owner === null)) {
                this.errors.push({ ...where, message: `'${name}' belongs to the main program, and a function can only use its own parameters and variables. Pass it in as a parameter instead: ${inFunction}(${name}).` });
                continue;
            }

            // An English keyword typed while the keywords are set to another language
            const english = this.keywords.find(keyword => keyword.defaultWord === name && keyword.word !== name);
            if (english) {
                this.errors.push({ ...where, message: `'${name}' is the English keyword. In your current language it is written '${english.word}'.` });
                continue;
            }

            let message = use === 'assign'
                ? `Cannot assign to '${name}' because it is not declared. Create it with '${this.letWord} ${name} = ...;'.`
                : `'${name}' is not declared. Create it first with '${this.letWord} ${name} = ...;'.`;

            // Declared somewhere, just not where it can be seen from here
            const later = this.symbols.find(symbol => symbol.name === name && symbol.line > line)
                || this.symbols.find(symbol => symbol.name === name);
            if (later) {
                message += later.line > line
                    ? ` It is declared later, on line ${later.line}; a variable must be declared before it is used.`
                    : ` A '${name}' is declared on line ${later.line}, but inside a block that has already ended.`;
            } else {
                // A mistyped keyword (pirnt, wihle) or a mistyped variable name
                const keyword = closestMatch(name, this.keywords.map(k => k.word));
                const variable = closestMatch(name, visible);
                if (keyword && (!variable || keyword.distance <= variable.distance)) {
                    message = `'${name}' is not a keyword or a declared variable. Did you mean the keyword '${keyword.candidate}'?`;
                } else if (variable) {
                    message += ` Did you mean '${variable.candidate}'?`;
                }
            }
            this.errors.push({ ...where, message });
        }
    }

    reportUnusedSymbols() {
        for (const fn of this.functions.values()) {
            if (fn.calls === 0) {
                this.warnings.push({ line: fn.line, column: fn.column, length: fn.name.length, message: `Function '${fn.name}' is never called.` });
            }
        }
        for (const symbol of this.symbols) {
            if (symbol.reads === 0) {
                this.warnings.push({ line: symbol.line, column: symbol.column, length: symbol.name.length, message: `'${symbol.name}' is declared but its value is never used.` });
            }
        }
    }

    // --- Pass 2: type inference ---
    // A variable's type is every type ever stored in it. Stored values can depend on other
    // variables (x = x + 1), so repeat until nothing changes (a fixed point).

    inferTypes() {
        let changed = true;
        while (changed) {
            changed = false;
            for (const [symbol, expression] of this.typeSources) {
                for (const type of this.typeOf(expression)) {
                    if (!symbol.types.has(type)) {
                        symbol.types.add(type);
                        changed = true;
                    }
                }
            }
        }
    }

    typeOf(node) {
        return typeOfExpression(node, this.resolutions);
    }

    // --- Pass 3: type checking ---
    // Report an error only when every possible combination of types would fail.

    checkOperatorTypes() {
        for (const node of this.operations) {
            const symbol = OPERATOR_SYMBOLS[node.op.type];

            if (node instanceof UnaryOpNode) {
                const types = this.typeOf(node.right);
                if (node.op.type !== TokenType.BANG && types.size > 0 && !types.has(NUMBER)) {
                    this.errors.push({ ...locate(node, symbol.length), message: `Operator '${symbol}' needs a number, but got ${describeTypes(types)}.` });
                }
                continue;
            }

            const left = this.typeOf(node.left);
            const right = this.typeOf(node.right);
            if (left.size === 0 || right.size === 0) continue;
            const both = (type) => left.has(type) && right.has(type);
            const got = `${describeTypes(left)} and ${describeTypes(right)}`;

            switch (node.op.type) {
                case TokenType.MINUS:
                case TokenType.MULTIPLY:
                case TokenType.DIVIDE:
                    if (!both(NUMBER)) {
                        this.errors.push({ ...locate(node, symbol.length), message: `Operator '${symbol}' needs two numbers, but got ${got}.` });
                    }
                    break;
                case TokenType.PLUS:
                    if (!left.has(STRING) && !right.has(STRING) && !both(NUMBER)) {
                        this.errors.push({ ...locate(node, symbol.length), message: `Operator '+' adds two numbers or joins text, but got ${got}.` });
                    }
                    break;
                case TokenType.LT:
                case TokenType.GT:
                    if (!both(NUMBER) && !both(STRING)) {
                        this.errors.push({ ...locate(node, symbol.length), message: `Operator '${symbol}' compares two numbers or two strings, but got ${got}.` });
                    }
                    break;
            }
        }
    }
}

// Display rows: { text, line, kind }. 'line' links a row back to the source for tracing.
export function symbolTableRows(analysis) {
    const rows = analysis.symbols.map(symbol => [
        symbol.name,
        symbol.irName,
        symbol.scope,
        String(symbol.line),
        describeTypes(symbol.types) || '?',
        String(symbol.reads),
        String(symbol.writes),
    ]);
    const header = ['Name', 'IR name', 'Scope', 'Line', 'Type', 'Reads', 'Writes'];
    const widths = header.map((title, col) => Math.max(title.length, ...rows.map(row => row[col].length)));
    const formatRow = (row) => row.map((cell, col) => cell.padEnd(widths[col])).join('  ').trimEnd();

    // Functions are listed too: their type is what they give back
    for (const fn of analysis.functions ?? []) {
        const gives = fn.returnsValue ? (describeTypes(fn.types) || '?') : 'nothing';
        rows.push([fn.name, fn.irName, 'global', String(fn.line), `function(${fn.params.join(', ')}) -> ${gives}`, `${fn.calls} calls`, '-']);
    }
    const symbolLines = [...analysis.symbols, ...(analysis.functions ?? [])].map(entry => entry.line);

    const lines = [{ text: '--- Symbol Table ---', line: null, kind: 'header' }];
    if (rows.length === 0) {
        lines.push({ text: '(no variables declared)', line: null, kind: 'note' });
    } else {
        lines.push(
            { text: formatRow(header), line: null, kind: 'note' },
            { text: formatRow(widths.map(width => '-'.repeat(width))), line: null, kind: 'note' },
        );
        rows.forEach((row, index) => lines.push({ text: formatRow(row), line: symbolLines[index] }));
    }
    return lines;
}
