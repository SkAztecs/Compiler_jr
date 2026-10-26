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
    StringNode,
    BooleanNode,
    FunctionDeclarationNode,
    ReturnStatementNode,
    CallNode
} from '../../ast.js';
import { typeOfExpression } from './semantic.js';
import { formatValue } from './runtime.js';
import { MAX_CALL_DEPTH, MAX_LOOP_ITERATIONS, callDepthError, missingReturnError } from '../interpreter/evaluator.js';

// Extra back ends: the same checked AST, written out as JavaScript, Python or C.
// This is the front end / back end split real compilers use: one front end
// (lexer, parser, semantic analysis) can feed many back ends, one per target language.
//
// The output keeps this language's rules where the targets differ:
//   - only false counts as false (0 and "" count as true)
//   - && and || always give true or false
//   - dividing by zero is an error
//   - == is strict (1 and "1" are not equal)
// Small helper functions are added only when a program needs them. When the types are
// known (from semantic analysis) the plain operator is used, so most output reads naturally.

const NUMBER = 'number';
const STRING = 'string';
const BOOLEAN = 'boolean';

// Operator precedence, shared by all three targets (higher binds tighter)
const PREC = { assign: 1, ternary: 1.5, or: 2, and: 3, pythonNot: 3.5, equality: 4, compare: 5, add: 6, mul: 7, unary: 8, atom: 9 };
const BINARY_PREC = {
    [TokenType.OR]: PREC.or,
    [TokenType.AND]: PREC.and,
    [TokenType.EQ]: PREC.equality,
    [TokenType.NOT_EQ]: PREC.equality,
    [TokenType.LT]: PREC.compare,
    [TokenType.GT]: PREC.compare,
    [TokenType.PLUS]: PREC.add,
    [TokenType.MINUS]: PREC.add,
    [TokenType.MULTIPLY]: PREC.mul,
    [TokenType.DIVIDE]: PREC.mul,
};
const SYMBOL = {
    [TokenType.PLUS]: '+', [TokenType.MINUS]: '-', [TokenType.MULTIPLY]: '*', [TokenType.DIVIDE]: '/',
    [TokenType.LT]: '<', [TokenType.GT]: '>',
};

export const TARGETS = [
    { id: 'c', label: 'C' },
    { id: 'python', label: 'Python' },
    { id: 'javascript', label: 'JavaScript' },
];

function containsAssignment(node) {
    if (node instanceof AssignmentNode) return true;
    if (node instanceof CallNode) return node.args.some(containsAssignment);
    if (node instanceof BinaryOpNode) return containsAssignment(node.left) || containsAssignment(node.right);
    if (node instanceof UnaryOpNode) return containsAssignment(node.right);
    return false;
}

// The first expression anywhere in the program that matches 'test', or null
// True when working out the expression could change something: an assignment or a call
function hasEffects(node) {
    return findExpression(node, child => child instanceof AssignmentNode || child instanceof CallNode) !== null;
}

function findExpression(node, test) {
    if (!node) return null;
    if (test(node)) return node;
    const children = node.statements ?? [
        node.expression, node.condition, node.consequence, node.alternative, node.body,
        node.initializer, node.increment, node.left, node.right, ...(node.args ?? []),
    ];
    for (const child of children) {
        const found = child && typeof child === 'object' ? findExpression(child, test) : null;
        if (found) return found;
    }
    return null;
}

// --- Shared machinery ---

class TargetGenerator {
    constructor(analysis, reservedWords, options = {}) {
        this.analysis = analysis;
        this.resolutions = analysis.resolutions;
        this.options = options;
        this.rows = [];
        this.depth = 0;
        this.helpers = new Set();   // helper functions this program needs
        this.declared = new Set();  // symbols already declared in the output
        this.loopCount = 0;

        // Every variable gets a unique name that is not a word the target reserves.
        // Unique names also handle shadowing ('let x' inside a block) in Python,
        // which has no block scopes.
        // Names only need to be unique within one function (or the main program), since each
        // has its own scope in every target; function names are shared by all of them
        this.names = new Map(); // symbol (variable or function) -> its name in the target
        const shared = new Set(reservedWords);
        const pick = (symbol, used) => {
            let name = symbol.name;
            if (used.has(name)) {
                let count = 2;
                while (used.has(`${symbol.name}_${count}`)) count++;
                name = `${symbol.name}_${count}`;
            }
            used.add(name);
            this.names.set(symbol, name);
        };
        (analysis.functions ?? []).forEach(fn => pick(fn, shared));
        const usedBy = new Map(); // owner (function name, or null for main) -> names taken there
        for (const symbol of analysis.symbols) {
            if (!usedBy.has(symbol.owner)) usedBy.set(symbol.owner, new Set(shared));
            pick(symbol, usedBy.get(symbol.owner));
        }
        this.functionNodes = (analysis.functions ?? []).map(fn => fn.node);
    }

    name(identifier) {
        return this.names.get(this.resolutions.get(identifier));
    }

    // The main program's statements, without the function definitions
    mainStatements(ast) {
        return ast.statements.filter(statement => !(statement instanceof FunctionDeclarationNode));
    }

    // True when a value function can reach the end of its body without a return
    needsMissingReturn(node) {
        const fn = this.symbolOf(node.name);
        const last = node.body.statements[node.body.statements.length - 1];
        return fn.returnsValue && !(last instanceof ReturnStatementNode);
    }

    callArgs(node, wrapArg) {
        return node.args.map(arg => wrapArg(arg)).join(', ');
    }

    symbolOf(identifier) {
        return this.resolutions.get(identifier);
    }

    types(node) {
        return typeOfExpression(node, this.resolutions);
    }

    is(node, type) {
        const types = this.types(node);
        return types.size === 1 && types.has(type);
    }

    emit(text, line = null) {
        this.rows.push({ text: '    '.repeat(this.depth) + text, line });
    }

    use(helper) {
        this.helpers.add(helper);
    }

    part(code, prec) {
        return { code, prec };
    }

    wrap(part, minPrec) {
        return part.prec < minPrec ? `(${part.code})` : part.code;
    }

    // Left and right operands of a binary operator. Comparisons never chain
    // (Python reads a < b < c differently), so both of their sides are wrapped.
    operands(node, prec) {
        const comparison = prec === PREC.equality || prec === PREC.compare;
        const left = this.wrap(this.expression(node.left), comparison ? prec + 0.5 : prec);
        const right = this.wrap(this.expression(node.right), prec + 0.5);
        return [left, right];
    }

    statements(list) {
        list.forEach(statement => this.statement(statement));
    }

    result(prologue, epilogue = []) {
        const rows = [...prologue, ...this.rows, ...epilogue];
        return { ok: true, rows, code: rows.map(row => row.text).join('\n') };
    }
}

const note = (text) => ({ text, line: null });

// --- JavaScript ---

const JS_RESERVED = ['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
    'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
    'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while',
    'with', 'yield', 'let', 'static', 'implements', 'interface', 'package', 'private', 'protected', 'public',
    'await', 'arguments', 'eval', 'undefined', 'NaN', 'Infinity', 'console',
    'truthy', 'divide', 'checkNumbers', 'arithmetic', 'add', 'compare', 'negate', 'positive'];

const JS_HELPERS = {
    truthy: ['// Only false counts as false in this language: 0 and "" count as true', 'const truthy = (value) => value !== false;'],
    checkNumbers: [
        'function checkNumbers(op, a, b) {',
        "    if (typeof a !== 'number' || typeof b !== 'number') {",
        "        throw new Error(`Operator '${op}' needs two numbers, but got ${typeof a} and ${typeof b}.`);",
        '    }',
        '}',
    ],
    divide: [
        'function divide(a, b) {',
        "    checkNumbers('/', a, b);",
        "    if (b === 0) throw new Error('Cannot divide by zero.'); // JavaScript would give Infinity",
        '    return a / b;',
        '}',
    ],
    arithmetic: [
        'function arithmetic(op, a, b) {',
        '    checkNumbers(op, a, b);',
        "    return op === '-' ? a - b : a * b;",
        '}',
    ],
    add: [
        'function add(a, b) {',
        "    if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b);",
        "    checkNumbers('+', a, b);",
        '    return a + b;',
        '}',
    ],
    compare: [
        'function compare(op, a, b) {',
        "    const same = (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');",
        "    if (!same) throw new Error(`Operator '${op}' compares two numbers or two strings, but got ${typeof a} and ${typeof b}.`);",
        "    return op === '<' ? a < b : a > b;",
        '}',
    ],
    negate: [
        'function negate(a) {',
        "    if (typeof a !== 'number') throw new Error(`Operator '-' needs a number, but got ${typeof a}.`);",
        '    return -a;',
        '}',
    ],
    positive: [
        'function positive(a) {',
        "    if (typeof a !== 'number') throw new Error(`Operator '+' needs a number, but got ${typeof a}.`);",
        '    return a;',
        '}',
    ],
};
const JS_HELPER_NEEDS = { divide: ['checkNumbers'], arithmetic: ['checkNumbers'], add: ['checkNumbers'] };

class JavaScriptGenerator extends TargetGenerator {
    constructor(analysis, options) {
        super(analysis, JS_RESERVED, options);
    }

    generate(ast) {
        this.functionNodes.forEach(node => this.functionDefinition(node));
        this.statements(this.mainStatements(ast));
        const prologue = [note('// JavaScript, generated from your program by the compiler\'s JavaScript back end')];
        if (this.options.guardLoops && this.functionNodes.length > 0) prologue.push(note('let __depth = 0; // calls running inside each other'));
        const helperNames = Object.keys(JS_HELPERS).filter(name =>
            this.helpers.has(name) || [...this.helpers].some(used => JS_HELPER_NEEDS[used]?.includes(name)));
        for (const name of helperNames) {
            prologue.push(note(''), ...JS_HELPERS[name].map(note));
        }
        if (helperNames.length > 0) prologue.push(note(''));
        return this.result(prologue);
    }

    block(node) {
        this.depth++;
        this.statements(node.statements);
        this.depth--;
    }

    functionDefinition(node) {
        const fn = this.symbolOf(node.name);
        fn.paramSymbols.forEach(symbol => this.declared.add(symbol.id));
        const params = fn.paramSymbols.map(symbol => this.names.get(symbol)).join(', ');
        this.emit(`function ${this.name(node.name)}(${params}) {`, node.line);
        this.depth++;
        const guard = this.options.guardLoops;
        if (guard) {
            // Stops recursion that never ends, the same way the VM does (only in the version that is run)
            this.emit(`if (++__depth > ${MAX_CALL_DEPTH}) throw new Error(${JSON.stringify(callDepthError(fn.name))});`, node.line);
            this.emit('try {');
            this.depth++;
        }
        this.statements(node.body.statements);
        if (this.needsMissingReturn(node)) this.emit(`throw new Error(${JSON.stringify(missingReturnError(fn.name))});`, node.line);
        if (guard) {
            this.depth--;
            this.emit('} finally {');
            this.emit('    __depth--;');
            this.emit('}');
        }
        this.depth--;
        this.emit('}');
        this.emit('');
    }

    // Stops a runaway loop the same way the VM does (only in the version that is run)
    loopGuard(line) {
        if (!this.options.guardLoops) return null;
        const counter = `__loop${++this.loopCount}`;
        this.emit(`let ${counter} = 0;`, line);
        return counter;
    }

    emitGuardCheck(counter, line) {
        if (counter) {
            this.emit(`if (++${counter} > ${MAX_LOOP_ITERATIONS}) throw new Error('Loop stopped after ${MAX_LOOP_ITERATIONS} iterations. Check that its condition eventually becomes false.');`, line);
        }
    }

    statement(node) {
        if (node instanceof LetStatementNode) {
            this.emit(`${this.declaration(node)};`, node.line);
        } else if (node instanceof PrintStatementNode) {
            this.emit(`console.log(${this.wrap(this.expression(node.expression), PREC.assign)});`, node.line);
        } else if (node instanceof IfStatementNode) {
            this.ifChain(node, 'if');
        } else if (node instanceof WhileLoopNode) {
            const counter = this.loopGuard(node.line);
            this.emit(`while (${this.condition(node.condition)}) {`, node.line);
            this.depth++;
            this.emitGuardCheck(counter, node.line);
            this.depth--;
            this.block(node.body);
            this.emit('}');
        } else if (node instanceof ForLoopNode) {
            const counter = this.loopGuard(node.line);
            const init = node.initializer instanceof LetStatementNode ? this.declaration(node.initializer)
                : node.initializer ? this.expression(node.initializer).code : '';
            const condition = node.condition ? this.condition(node.condition) : '';
            const update = node.increment ? this.expression(node.increment).code : '';
            this.emit(`for (${init}; ${condition}; ${update}) {`, node.line);
            this.depth++;
            this.emitGuardCheck(counter, node.line);
            this.depth--;
            this.block(node.body);
            this.emit('}');
        } else if (node instanceof BlockStatementNode) {
            this.emit('{', node.line);
            this.block(node);
            this.emit('}');
        } else if (node instanceof ReturnStatementNode) {
            this.emit(node.expression ? `return ${this.wrap(this.expression(node.expression), PREC.assign)};` : 'return;', node.line);
        } else {
            this.emit(`${this.expression(node).code};`, node.line);
        }
    }

    declaration(node) {
        const symbol = this.symbolOf(node.identifier);
        const value = this.wrap(this.expression(node.expression), PREC.assign);
        if (this.declared.has(symbol.id)) return `${this.name(node.identifier)} = ${value}`;
        this.declared.add(symbol.id);
        return `let ${this.name(node.identifier)} = ${value}`;
    }

    ifChain(node, keyword) {
        this.emit(`${keyword} (${this.condition(node.condition)}) {`, node.line);
        this.block(node.consequence);
        if (node.alternative instanceof IfStatementNode) {
            this.ifChain(node.alternative, '} else if');
            return;
        }
        if (node.alternative) {
            this.emit('} else {', node.alternative.line);
            this.block(node.alternative);
        }
        this.emit('}');
    }

    condition(node) {
        return this.asBoolean(node).code;
    }

    asBoolean(node) {
        if (this.is(node, BOOLEAN)) return this.expression(node);
        this.use('truthy');
        return this.part(`truthy(${this.expression(node).code})`, PREC.atom);
    }

    expression(node) {
        if (node instanceof NumberNode) return this.part(String(node.value), PREC.atom);
        if (node instanceof StringNode) return this.part(JSON.stringify(node.value), PREC.atom);
        if (node instanceof BooleanNode) return this.part(String(node.value), PREC.atom);
        if (node instanceof IdentifierNode) return this.part(this.name(node), PREC.atom);
        if (node instanceof AssignmentNode) {
            return this.part(`${this.name(node.identifier)} = ${this.wrap(this.expression(node.expression), PREC.assign)}`, PREC.assign);
        }
        if (node instanceof CallNode) {
            return this.part(`${this.name(node.callee)}(${this.callArgs(node, arg => this.wrap(this.expression(arg), PREC.assign))})`, PREC.atom);
        }
        if (node instanceof UnaryOpNode) return this.unary(node);
        return this.binary(node);
    }

    unary(node) {
        if (node.op.type === TokenType.BANG) {
            return this.part(`!${this.wrap(this.asBoolean(node.right), PREC.unary)}`, PREC.unary);
        }
        const helper = node.op.type === TokenType.MINUS ? 'negate' : 'positive';
        if (!this.is(node.right, NUMBER)) {
            this.use(helper);
            return this.part(`${helper}(${this.expression(node.right).code})`, PREC.atom);
        }
        const sign = node.op.type === TokenType.MINUS ? '-' : '+';
        let operand = this.wrap(this.expression(node.right), PREC.unary);
        if (operand.startsWith('-') || operand.startsWith('+')) operand = `(${operand})`; // not -- or ++
        return this.part(`${sign}${operand}`, PREC.unary);
    }

    binary(node) {
        const type = node.op.type;
        const prec = BINARY_PREC[type];
        const bothNumbers = this.is(node.left, NUMBER) && this.is(node.right, NUMBER);
        const call = (helper, ...args) => {
            this.use(helper);
            return this.part(`${helper}(${args.join(', ')})`, PREC.atom);
        };
        const arg = (child) => this.wrap(this.expression(child), PREC.assign);

        switch (type) {
            case TokenType.AND:
            case TokenType.OR: {
                const left = this.wrap(this.asBoolean(node.left), prec);
                const right = this.wrap(this.asBoolean(node.right), prec + 0.5);
                return this.part(`${left} ${type === TokenType.AND ? '&&' : '||'} ${right}`, prec);
            }
            case TokenType.EQ:
            case TokenType.NOT_EQ: {
                const [left, right] = this.operands(node, prec);
                return this.part(`${left} ${type === TokenType.EQ ? '===' : '!=='} ${right}`, prec);
            }
            case TokenType.LT:
            case TokenType.GT: {
                const bothStrings = this.is(node.left, STRING) && this.is(node.right, STRING);
                if (!bothNumbers && !bothStrings) return call('compare', `'${SYMBOL[type]}'`, arg(node.left), arg(node.right));
                const [left, right] = this.operands(node, prec);
                return this.part(`${left} ${SYMBOL[type]} ${right}`, prec);
            }
            case TokenType.PLUS: {
                // JavaScript joins text the same way this language does
                const hasString = this.is(node.left, STRING) || this.is(node.right, STRING);
                if (!bothNumbers && !hasString) return call('add', arg(node.left), arg(node.right));
                break;
            }
            case TokenType.MINUS:
            case TokenType.MULTIPLY:
                if (!bothNumbers) return call('arithmetic', `'${SYMBOL[type]}'`, arg(node.left), arg(node.right));
                break;
            case TokenType.DIVIDE: {
                const safe = bothNumbers && node.right instanceof NumberNode && node.right.value !== 0;
                if (!safe) return call('divide', arg(node.left), arg(node.right));
                break;
            }
        }
        const [left, right] = this.operands(node, prec);
        return this.part(`${left} ${SYMBOL[type]} ${right}`, prec);
    }
}

// --- Python ---

const PYTHON_RESERVED = ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
    'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
    'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
    'print', 'str', 'int', 'float', 'bool', 'type', 'len', 'input', 'sum', 'min', 'max', 'abs', 'repr', 'isinstance',
    'truthy', 'fmt', 'kind', 'check_numbers', 'divide', 'arithmetic', 'add', 'compare', 'same', 'negate', 'positive'];

const PYTHON_HELPERS = {
    truthy: ['def truthy(value):', '    return value is not False  # only false counts as false: 0 and "" count as true'],
    fmt: [
        'def fmt(value):',
        '    # Shows values the way this language prints them: true, not True; 2, not 2.0',
        '    if isinstance(value, bool):',
        '        return "true" if value else "false"',
        '    if isinstance(value, float) and value.is_integer() and abs(value) < 1e21:',
        '        return str(int(value))',
        '    return str(value)',
    ],
    kind: [
        'def kind(value):',
        '    if isinstance(value, bool):',
        '        return "boolean"',
        '    return "string" if isinstance(value, str) else "number"',
    ],
    check_numbers: [
        'def check_numbers(op, a, b):',
        '    if kind(a) != "number" or kind(b) != "number":',
        '        raise RuntimeError(f"Operator \'{op}\' needs two numbers, but got {kind(a)} and {kind(b)}.")',
    ],
    divide: [
        'def divide(a, b):',
        '    check_numbers("/", a, b)',
        '    if b == 0:',
        '        raise RuntimeError("Cannot divide by zero.")',
        '    return a / b',
    ],
    arithmetic: [
        'def arithmetic(op, a, b):',
        '    check_numbers(op, a, b)',
        '    return a - b if op == "-" else a * b',
    ],
    add: [
        'def add(a, b):',
        '    if isinstance(a, str) or isinstance(b, str):',
        '        return fmt(a) + fmt(b)',
        '    check_numbers("+", a, b)',
        '    return a + b',
    ],
    compare: [
        'def compare(op, a, b):',
        '    if kind(a) != kind(b) or kind(a) == "boolean":',
        '        raise RuntimeError(f"Operator \'{op}\' compares two numbers or two strings, but got {kind(a)} and {kind(b)}.")',
        '    return a < b if op == "<" else a > b',
    ],
    same: [
        'def same(a, b):',
        '    # == in this language is strict: true is not 1, "1" is not 1',
        '    return kind(a) == kind(b) and a == b',
    ],
    negate: [
        'def negate(a):',
        '    if kind(a) != "number":',
        '        raise RuntimeError(f"Operator \'-\' needs a number, but got {kind(a)}.")',
        '    return -a',
    ],
    positive: [
        'def positive(a):',
        '    if kind(a) != "number":',
        '        raise RuntimeError(f"Operator \'+\' needs a number, but got {kind(a)}.")',
        '    return a',
    ],
};
const PYTHON_HELPER_NEEDS = {
    check_numbers: ['kind'], divide: ['check_numbers', 'kind'], arithmetic: ['check_numbers', 'kind'],
    add: ['fmt', 'check_numbers', 'kind'], compare: ['kind'], same: ['kind'], negate: ['kind'], positive: ['kind'],
};

class PythonGenerator extends TargetGenerator {
    constructor(analysis, options) {
        super(analysis, PYTHON_RESERVED, options);
    }

    generate(ast) {
        // Python runs a def when it reaches it, so functions go first
        this.functionNodes.forEach(node => this.functionDefinition(node));
        const main = this.mainStatements(ast);
        this.statements(main);
        if (main.length === 0 && this.functionNodes.length === 0) this.emit('pass');
        const prologue = [note('# Python, generated from your program by the compiler\'s Python back end')];
        const needed = new Set(this.helpers);
        for (const used of this.helpers) (PYTHON_HELPER_NEEDS[used] ?? []).forEach(name => needed.add(name));
        const helperNames = Object.keys(PYTHON_HELPERS).filter(name => needed.has(name));
        for (const name of helperNames) {
            prologue.push(note(''), ...PYTHON_HELPERS[name].map(note));
        }
        if (helperNames.length > 0) prologue.push(note(''), note(''));
        return this.result(prologue);
    }

    functionDefinition(node) {
        const fn = this.symbolOf(node.name);
        const params = fn.paramSymbols.map(symbol => this.names.get(symbol)).join(', ');
        this.emit(`def ${this.name(node.name)}(${params}):`, node.line);
        this.depth++;
        if (node.body.statements.length === 0) this.emit('pass', node.line);
        this.statements(node.body.statements);
        if (this.needsMissingReturn(node)) this.emit(`raise RuntimeError(${JSON.stringify(missingReturnError(fn.name))})`, node.line);
        this.depth--;
        this.emit('');
        this.emit('');
    }

    // Python marks blocks by indentation, and an empty block needs 'pass'
    block(statements, line) {
        this.depth++;
        if (statements.length === 0) this.emit('pass', line);
        this.statements(statements);
        this.depth--;
    }

    statement(node) {
        if (node instanceof LetStatementNode) {
            this.emit(`${this.name(node.identifier)} = ${this.expression(node.expression).code}`, node.line);
        } else if (node instanceof PrintStatementNode) {
            this.emit(`print(${this.printable(node.expression)})`, node.line);
        } else if (node instanceof IfStatementNode) {
            this.ifChain(node, 'if');
        } else if (node instanceof WhileLoopNode) {
            this.emit(`while ${this.condition(node.condition)}:`, node.line);
            this.block(node.body.statements, node.line);
        } else if (node instanceof ForLoopNode) {
            // Python has no C-style for loop, so it becomes: setup, then while, with the update at the end
            if (node.initializer) this.statement(node.initializer);
            this.emit(`while ${node.condition ? this.condition(node.condition) : 'True'}:`, node.line);
            this.depth++;
            this.statements(node.body.statements);
            if (node.increment) this.statement(node.increment);
            if (node.body.statements.length === 0 && !node.increment) this.emit('pass', node.line);
            this.depth--;
        } else if (node instanceof BlockStatementNode) {
            // Python has no separate blocks; unique names already keep inner variables apart
            this.statements(node.statements);
        } else if (node instanceof AssignmentNode) {
            this.emit(`${this.name(node.identifier)} = ${this.expression(node.expression).code}`, node.line);
        } else if (node instanceof ReturnStatementNode) {
            this.emit(node.expression ? `return ${this.expression(node.expression).code}` : 'return', node.line);
        } else {
            this.emit(this.expression(node).code, node.line);
        }
    }

    printable(node) {
        if (this.is(node, STRING)) return this.expression(node).code;
        this.use('fmt');
        return `fmt(${this.expression(node).code})`;
    }

    ifChain(node, keyword) {
        this.emit(`${keyword} ${this.condition(node.condition)}:`, node.line);
        this.block(node.consequence.statements, node.line);
        if (node.alternative instanceof IfStatementNode) {
            this.ifChain(node.alternative, 'elif');
        } else if (node.alternative) {
            this.emit('else:', node.alternative.line);
            this.block(node.alternative.statements, node.alternative.line);
        }
    }

    condition(node) {
        return this.asBoolean(node).code;
    }

    asBoolean(node) {
        if (this.is(node, BOOLEAN)) return this.expression(node);
        this.use('truthy');
        return this.part(`truthy(${this.expression(node).code})`, PREC.atom);
    }

    // Text for the non-text side of "a" + b
    asText(node) {
        if (this.is(node, STRING)) return this.wrap(this.expression(node), PREC.add + 0.5);
        this.use('fmt');
        return `fmt(${this.expression(node).code})`;
    }

    expression(node) {
        if (node instanceof NumberNode) return this.part(String(node.value), PREC.atom);
        if (node instanceof StringNode) return this.part(JSON.stringify(node.value), PREC.atom);
        if (node instanceof BooleanNode) return this.part(node.value ? 'True' : 'False', PREC.atom);
        if (node instanceof IdentifierNode) return this.part(this.name(node), PREC.atom);
        if (node instanceof AssignmentNode) {
            // An assignment used as a value needs Python's := operator
            return this.part(`(${this.name(node.identifier)} := ${this.expression(node.expression).code})`, PREC.atom);
        }
        if (node instanceof CallNode) {
            return this.part(`${this.name(node.callee)}(${this.callArgs(node, arg => this.expression(arg).code)})`, PREC.atom);
        }
        if (node instanceof UnaryOpNode) return this.unary(node);
        return this.binary(node);
    }

    unary(node) {
        if (node.op.type === TokenType.BANG) {
            return this.part(`not ${this.wrap(this.asBoolean(node.right), PREC.pythonNot)}`, PREC.pythonNot);
        }
        const helper = node.op.type === TokenType.MINUS ? 'negate' : 'positive';
        if (!this.is(node.right, NUMBER)) {
            this.use(helper);
            return this.part(`${helper}(${this.expression(node.right).code})`, PREC.atom);
        }
        const sign = node.op.type === TokenType.MINUS ? '-' : '+';
        return this.part(`${sign}${this.wrap(this.expression(node.right), PREC.unary)}`, PREC.unary);
    }

    binary(node) {
        const type = node.op.type;
        const prec = BINARY_PREC[type];
        const bothNumbers = this.is(node.left, NUMBER) && this.is(node.right, NUMBER);
        const bothStrings = this.is(node.left, STRING) && this.is(node.right, STRING);
        const call = (helper, ...args) => {
            this.use(helper);
            return this.part(`${helper}(${args.join(', ')})`, PREC.atom);
        };
        const arg = (child) => this.expression(child).code;

        switch (type) {
            case TokenType.AND:
            case TokenType.OR: {
                const left = this.wrap(this.asBoolean(node.left), prec);
                const right = this.wrap(this.asBoolean(node.right), prec + 0.5);
                return this.part(`${left} ${type === TokenType.AND ? 'and' : 'or'} ${right}`, prec);
            }
            case TokenType.EQ:
            case TokenType.NOT_EQ: {
                const sameType = [NUMBER, STRING, BOOLEAN].some(t => this.is(node.left, t) && this.is(node.right, t));
                if (!sameType) {
                    const result = call('same', arg(node.left), arg(node.right));
                    return type === TokenType.EQ ? result : this.part(`not ${result.code}`, PREC.pythonNot);
                }
                const [left, right] = this.operands(node, prec);
                return this.part(`${left} ${type === TokenType.EQ ? '==' : '!='} ${right}`, prec);
            }
            case TokenType.LT:
            case TokenType.GT:
                if (!bothNumbers && !bothStrings) return call('compare', `"${SYMBOL[type]}"`, arg(node.left), arg(node.right));
                break;
            case TokenType.PLUS: {
                if (bothNumbers || bothStrings) break;
                const knownText = this.is(node.left, STRING) || this.is(node.right, STRING);
                const knownOther = this.types(node.left).size === 1 && this.types(node.right).size === 1;
                if (knownText && knownOther) {
                    return this.part(`${this.asText(node.left)} + ${this.asText(node.right)}`, PREC.add);
                }
                return call('add', arg(node.left), arg(node.right));
            }
            case TokenType.MINUS:
            case TokenType.MULTIPLY:
                if (!bothNumbers) return call('arithmetic', `"${SYMBOL[type]}"`, arg(node.left), arg(node.right));
                break;
            case TokenType.DIVIDE: {
                const safe = bothNumbers && node.right instanceof NumberNode && node.right.value !== 0;
                if (!safe) return call('divide', arg(node.left), arg(node.right));
                break;
            }
        }
        const [left, right] = this.operands(node, prec);
        return this.part(`${left} ${SYMBOL[type]} ${right}`, prec);
    }
}

// --- C ---

const C_RESERVED = ['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
    'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short',
    'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while',
    'bool', 'true', 'false', 'main', 'printf', 'puts', 'snprintf', 'fprintf', 'strcmp', 'strlen', 'strcpy', 'strcat',
    'strtod', 'malloc', 'free', 'exit', 'NULL', 'stdout', 'stderr', 'text',
    'print_number', 'format_number', 'number_text', 'concat', 'divide', 'fail'];

const C_TYPES = { [NUMBER]: 'double', [STRING]: 'const char *', [BOOLEAN]: 'bool' };

const C_HELPERS = {
    format_number: [
        '// Writes a number the way this language prints it: 3, not 3.000000; 2.5, not 2.500000',
        'static void format_number(double value, char *text, size_t size) {',
        '    if (value > -1e18 && value < 1e18 && value == (double)(long long)value) {',
        '        snprintf(text, size, "%lld", (long long)value);',
        '        return;',
        '    }',
        '    for (int digits = 1; digits <= 17; digits++) {  // the shortest form that reads back exactly',
        '        snprintf(text, size, "%.*g", digits, value);',
        '        if (strtod(text, NULL) == value) return;',
        '    }',
        '}',
    ],
    print_number: [
        'static void print_number(double value) {',
        '    char text[40];',
        '    format_number(value, text, sizeof text);',
        '    puts(text);',
        '}',
    ],
    number_text: [
        'static const char *number_text(double value) {',
        '    char *text = malloc(40);',
        '    format_number(value, text, 40);',
        '    return text;',
        '}',
    ],
    concat: [
        '// Joins two pieces of text. C has no + for text, so new memory is made for the result',
        '// (this short program never frees it, which is fine because it ends straight away).',
        'static const char *concat(const char *a, const char *b) {',
        '    char *text = malloc(strlen(a) + strlen(b) + 1);',
        '    strcpy(text, a);',
        '    strcat(text, b);',
        '    return text;',
        '}',
    ],
    divide: [
        'static double divide(double a, double b) {',
        '    if (b == 0) {  // C would give inf; this language stops with an error',
        '        fflush(stdout);',
        '        fprintf(stderr, "Runtime error: Cannot divide by zero.\\n");',
        '        exit(1);',
        '    }',
        '    return a / b;',
        '}',
    ],
};
C_HELPERS.fail = [
    '// Stops the program with an error, like this language does',
    '_Noreturn static void fail(const char *message) {',
    '    fflush(stdout);',
    '    fprintf(stderr, "Runtime error: %s\\n", message);',
    '    exit(1);',
    '}',
];
const C_HELPER_NEEDS = { print_number: ['format_number'], number_text: ['format_number'] };

// Functions whose calls can print something (directly or through other calls).
// Only those make the order of calls visible, since a function can't change the caller's variables.
function printingFunctions(analysis) {
    const printing = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const fn of analysis.functions ?? []) {
            if (printing.has(fn.name)) continue;
            const prints = findExpression(fn.node.body, node => node instanceof PrintStatementNode
                || (node instanceof CallNode && printing.has(node.callee.value)));
            if (prints) {
                printing.add(fn.name);
                changed = true;
            }
        }
    }
    return printing;
}

function cString(text) {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

function cNumber(value) {
    const text = String(value);
    return /^-?\d+$/.test(text) ? `${text}.0` : text; // always a double, so 7 / 2 is 3.5, not 3
}

class CGenerator extends TargetGenerator {
    constructor(analysis, options) {
        super(analysis, C_RESERVED, options);
        this.usesBool = false;
        this.usesStrings = false; // strcmp needs <string.h>
    }

    generate(ast) {
        // Functions nobody calls are left out: without calls, C can't know their parameter types
        this.cFunctions = this.functionNodes.filter(node => this.symbolOf(node.name).calls > 0);
        const skipped = this.functionNodes.filter(node => !this.cFunctions.includes(node));
        const checkedSymbols = this.analysis.symbols.filter(symbol =>
            symbol.owner === null || this.cFunctions.some(node => node.name.value === symbol.owner));

        for (const node of this.cFunctions) {
            const fn = this.symbolOf(node.name);
            if (fn.returnsValue && fn.types.size !== 1) {
                const types = fn.types.size === 0 ? 'no value it can ever reach' : [...fn.types].join(' and ');
                return {
                    ok: false,
                    reason: `This program can't be written as C: '${fn.name}' (line ${fn.line}) gives back ${types}, but a C function must give back one type. `
                        + 'The Python and JavaScript versions still work.',
                };
            }
        }

        // C needs one fixed type per variable; this language lets a variable change type
        for (const symbol of checkedSymbols) {
            if (symbol.types.size !== 1) {
                const types = [...symbol.types].join(' and ');
                return {
                    ok: false,
                    reason: `This program can't be written as C: '${symbol.name}' (line ${symbol.line}) holds ${types} at different times, `
                        + 'but every C variable must keep one type. This is the difference between dynamic typing (this language, '
                        + 'Python, JavaScript) and static typing (C). The Python and JavaScript versions still work.',
                };
            }
            if (symbol.types.has(BOOLEAN)) this.usesBool = true;
        }

        // C doesn't fix which side of an operator runs first, so an assignment inside
        // one (a + (a = 5)) could give a different answer on every compiler
        const unordered = findExpression(ast, node => node instanceof BinaryOpNode
            && node.op.type !== TokenType.AND && node.op.type !== TokenType.OR
            && (containsAssignment(node.left) || containsAssignment(node.right)));
        if (unordered) {
            return {
                ok: false,
                reason: `This program can't be written as C: line ${unordered.line} assigns a variable in the middle of a calculation. `
                    + 'This language works out the left side first, but C leaves the order up to the compiler, so the result '
                    + 'would not be reliable. Move the assignment onto its own line to see the C version.',
            };
        }
        // The same goes for two calls that print, or an assignment among several arguments
        const printing = printingFunctions(this.analysis);
        const prints = (node) => findExpression(node, child => child instanceof CallNode && printing.has(child.callee.value)) !== null;
        const unorderedCalls = findExpression(ast, node =>
            (node instanceof BinaryOpNode && node.op.type !== TokenType.AND && node.op.type !== TokenType.OR
                && prints(node.left) && prints(node.right))
            || (node instanceof CallNode && (node.args.filter(prints).length > 1
                || (node.args.length > 1 && node.args.some(containsAssignment)))));
        if (unorderedCalls) {
            return {
                ok: false,
                reason: `This program can't be written as C: on line ${unorderedCalls.line}, two parts that print or change a variable `
                    + 'are worked out in the same calculation or call. This language does them left to right, but C lets the '
                    + 'compiler pick the order, so the output could change. Work them out on separate lines to see the C version.',
            };
        }
        this.skippedFunctions = skipped;

        // Function definitions first, then main()
        this.depth = 0;
        this.cFunctions.forEach(node => this.functionDefinition(node));
        const functionRows = this.rows;
        this.rows = [];
        this.depth = 1;
        this.statements(this.mainStatements(ast));

        const needed = new Set(this.helpers);
        for (const used of this.helpers) (C_HELPER_NEEDS[used] ?? []).forEach(name => needed.add(name));
        const helperNames = Object.keys(C_HELPERS).filter(name => needed.has(name));
        const prologue = [note('// C, generated from your program by the compiler\'s C back end'), note('#include <stdio.h>')];
        if (this.usesBool) prologue.push(note('#include <stdbool.h>'));
        if (helperNames.length > 0) prologue.push(note('#include <stdlib.h>'));            // strtod, malloc, exit
        if (this.usesStrings || needed.has('concat')) prologue.push(note('#include <string.h>')); // strcmp, strlen
        for (const name of helperNames) prologue.push(note(''), ...C_HELPERS[name].map(note));
        if (this.cFunctions.length > 0) {
            // Prototypes let functions call each other in any order
            prologue.push(note(''), ...this.cFunctions.map(node => note(`${this.signature(node)};`)), note(''));
            prologue.push(...functionRows);
        }
        for (const node of this.skippedFunctions) {
            prologue.push(note(`// '${node.name.value}' is never called, so it is left out: C would need to know its parameter types.`));
        }
        prologue.push(note(''), note('int main(void) {'));
        return this.result(prologue, [note('    return 0;'), note('}')]);
    }

    typeOf(node) {
        return [...this.types(node)][0];
    }

    signature(node) {
        const fn = this.symbolOf(node.name);
        const returns = fn.returnsValue ? C_TYPES[[...fn.types][0]] : 'void';
        const params = fn.paramSymbols.map(symbol => {
            const type = C_TYPES[[...symbol.types][0]];
            return type.endsWith('*') ? `${type}${this.names.get(symbol)}` : `${type} ${this.names.get(symbol)}`;
        });
        const head = returns.endsWith('*') ? `static ${returns}${this.name(node.name)}` : `static ${returns} ${this.name(node.name)}`;
        return `${head}(${params.join(', ') || 'void'})`;
    }

    functionDefinition(node) {
        const fn = this.symbolOf(node.name);
        fn.paramSymbols.forEach(symbol => {
            this.declared.add(symbol.id);
            if (symbol.types.has(BOOLEAN)) this.usesBool = true;
        });
        if (fn.types.has(BOOLEAN)) this.usesBool = true;
        this.emit(`${this.signature(node)} {`, node.line);
        this.depth++;
        this.statements(node.body.statements);
        if (this.needsMissingReturn(node)) {
            this.use('fail');
            this.emit(`fail(${cString(missingReturnError(fn.name))});`, node.line);
        }
        this.depth--;
        this.emit('}');
        this.emit('');
    }

    block(node) {
        this.depth++;
        this.statements(node.statements);
        this.depth--;
    }

    statement(node) {
        if (node instanceof LetStatementNode) {
            this.emit(`${this.declaration(node)};`, node.line);
        } else if (node instanceof PrintStatementNode) {
            this.emit(`${this.print(node.expression)};`, node.line);
        } else if (node instanceof IfStatementNode) {
            this.ifChain(node, 'if');
        } else if (node instanceof WhileLoopNode) {
            this.emit(`while (${this.condition(node.condition)}) {`, node.line);
            this.block(node.body);
            this.emit('}');
        } else if (node instanceof ForLoopNode) {
            const init = node.initializer instanceof LetStatementNode ? this.declaration(node.initializer)
                : node.initializer ? this.expression(node.initializer).code : '';
            const condition = node.condition ? this.condition(node.condition) : '';
            const update = node.increment ? this.expression(node.increment).code : '';
            this.emit(`for (${init}; ${condition}; ${update}) {`, node.line);
            this.block(node.body);
            this.emit('}');
        } else if (node instanceof BlockStatementNode) {
            this.emit('{', node.line);
            this.block(node);
            this.emit('}');
        } else if (node instanceof ReturnStatementNode) {
            this.emit(node.expression ? `return ${this.wrap(this.expression(node.expression), PREC.assign)};` : 'return;', node.line);
        } else {
            this.emit(`${this.expression(node).code};`, node.line);
        }
    }

    declaration(node) {
        const symbol = this.symbolOf(node.identifier);
        const name = this.name(node.identifier);
        const value = this.wrap(this.expression(node.expression), PREC.assign);
        if (this.declared.has(symbol.id)) return `${name} = ${value}`;
        this.declared.add(symbol.id);
        const type = C_TYPES[[...symbol.types][0]];
        return type.endsWith('*') ? `${type}${name} = ${value}` : `${type} ${name} = ${value}`;
    }

    print(node) {
        const type = this.typeOf(node);
        if (type === NUMBER) {
            this.use('print_number');
            return `print_number(${this.expression(node).code})`;
        }
        if (type === BOOLEAN) return `puts(${this.wrap(this.expression(node), PREC.or)} ? "true" : "false")`;
        return `puts(${this.expression(node).code})`;
    }

    ifChain(node, keyword) {
        this.emit(`${keyword} (${this.condition(node.condition)}) {`, node.line);
        this.block(node.consequence);
        if (node.alternative instanceof IfStatementNode) {
            this.ifChain(node.alternative, '} else if');
            return;
        }
        if (node.alternative) {
            this.emit('} else {', node.alternative.line);
            this.block(node.alternative);
        }
        this.emit('}');
    }

    condition(node) {
        return this.asBoolean(node).code;
    }

    // Numbers and text always count as true in this language, so only a bool is really tested.
    // Anything else is still evaluated (it may assign a variable) and then counts as true.
    asBoolean(node) {
        if (this.typeOf(node) === BOOLEAN) return this.expression(node);
        this.usesBool = true;
        if (!hasEffects(node)) return this.part('true /* numbers and text count as true */', PREC.atom);
        return this.part(`(${this.expression(node).code}, true)`, PREC.atom);
    }

    // C text for a value that is being joined onto text
    asText(node) {
        const type = this.typeOf(node);
        if (type === STRING) return this.expression(node).code;
        if (type === NUMBER) {
            this.use('number_text');
            return `number_text(${this.expression(node).code})`;
        }
        return `(${this.wrap(this.expression(node), PREC.or)} ? "true" : "false")`;
    }

    expression(node) {
        if (node instanceof NumberNode) return this.part(cNumber(node.value), PREC.atom);
        if (node instanceof StringNode) return this.part(cString(node.value), PREC.atom);
        if (node instanceof BooleanNode) {
            this.usesBool = true;
            return this.part(String(node.value), PREC.atom);
        }
        if (node instanceof IdentifierNode) return this.part(this.name(node), PREC.atom);
        if (node instanceof AssignmentNode) {
            return this.part(`${this.name(node.identifier)} = ${this.wrap(this.expression(node.expression), PREC.assign)}`, PREC.assign);
        }
        if (node instanceof CallNode) {
            return this.part(`${this.name(node.callee)}(${this.callArgs(node, arg => this.wrap(this.expression(arg), PREC.assign))})`, PREC.atom);
        }
        if (node instanceof UnaryOpNode) return this.unary(node);
        return this.binary(node);
    }

    unary(node) {
        if (node.op.type === TokenType.BANG) {
            return this.part(`!${this.wrap(this.asBoolean(node.right), PREC.unary)}`, PREC.unary);
        }
        const sign = node.op.type === TokenType.MINUS ? '-' : '+';
        let operand = this.wrap(this.expression(node.right), PREC.unary);
        if (operand.startsWith('-') || operand.startsWith('+')) operand = `(${operand})`;
        return this.part(`${sign}${operand}`, PREC.unary);
    }

    binary(node) {
        const type = node.op.type;
        const prec = BINARY_PREC[type];
        const leftType = this.typeOf(node.left);
        const rightType = this.typeOf(node.right);
        const arg = (child) => this.wrap(this.expression(child), PREC.assign);

        switch (type) {
            case TokenType.AND:
            case TokenType.OR: {
                const left = this.wrap(this.asBoolean(node.left), prec);
                const right = this.wrap(this.asBoolean(node.right), prec + 0.5);
                return this.part(`${left} ${type === TokenType.AND ? '&&' : '||'} ${right}`, prec);
            }
            case TokenType.EQ:
            case TokenType.NOT_EQ: {
                const isEqual = type === TokenType.EQ;
                if (leftType !== rightType) {
                    // Different types are never equal in this language, and C can't compare them anyway
                    this.usesBool = true;
                    const answer = isEqual ? 'false' : 'true';
                    if (!hasEffects(node)) return this.part(`${answer} /* different types are never equal */`, PREC.atom);
                    return this.part(`((void)(${arg(node.left)}), (void)(${arg(node.right)}), ${answer})`, PREC.atom);
                }
                if (leftType === STRING) {
                    this.usesStrings = true;
                    return this.part(`strcmp(${arg(node.left)}, ${arg(node.right)}) ${isEqual ? '==' : '!='} 0`, PREC.equality);
                }
                const [left, right] = this.operands(node, prec);
                return this.part(`${left} ${isEqual ? '==' : '!='} ${right}`, prec);
            }
            case TokenType.LT:
            case TokenType.GT:
                if (leftType === STRING) {
                    this.usesStrings = true;
                    return this.part(`strcmp(${arg(node.left)}, ${arg(node.right)}) ${SYMBOL[type]} 0`, PREC.compare);
                }
                break;
            case TokenType.PLUS:
                if (leftType === STRING || rightType === STRING) {
                    this.use('concat');
                    return this.part(`concat(${this.asText(node.left)}, ${this.asText(node.right)})`, PREC.atom);
                }
                break;
            case TokenType.DIVIDE: {
                const safe = node.right instanceof NumberNode && node.right.value !== 0;
                if (!safe) {
                    this.use('divide');
                    return this.part(`divide(${arg(node.left)}, ${arg(node.right)})`, PREC.atom);
                }
                break;
            }
        }
        const [left, right] = this.operands(node, prec);
        return this.part(`${left} ${SYMBOL[type]} ${right}`, prec);
    }
}

const GENERATORS = { javascript: JavaScriptGenerator, python: PythonGenerator, c: CGenerator };

// Returns { ok, rows, code } or { ok: false, reason }.
// Rows are { text, line } so the output can be traced back to the source.
export function generateTarget(language, ast, analysis, options = {}) {
    return new GENERATORS[language](analysis, options).generate(ast);
}

// Runs the JavaScript version (with the same runaway-loop guard as the VM) and
// returns what it printed, so it can be checked against the VM
export function runJavaScript(ast, analysis) {
    const program = generateTarget('javascript', ast, analysis, { guardLoops: true });
    const output = [];
    const capture = { log: (value) => output.push(formatValue(value)) };
    try {
        new Function('console', program.code)(capture);
        return { output, error: null };
    } catch (error) {
        return { output, error: { message: error.message } };
    }
}
