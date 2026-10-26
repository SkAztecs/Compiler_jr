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
import { OPERATOR_SYMBOLS } from './runtime.js';
import { tacRows } from './tac.js';
import { bytecodeRows } from './codegen.js';
import { PASSES } from './optimizer.js';

// The phase explorer: views of the tokens and the AST, and a trace that follows
// one source line through every phase of the compiler.
// Rows are { text, line, kind } so the UI can link each one back to the source.

const header = (text) => ({ text, line: null, kind: 'header' });
const note = (text) => ({ text, line: null, kind: 'note' });

// --- Tokens ---

export function tokenRows(tokens) {
    const rows = [
        header(`--- Tokens (${tokens.length}) ---`),
        note('The lexer reads the source one character at a time and groups it into tokens.'),
        note('Keywords are matched in your chosen language, so the Text column shows how you wrote them.'),
        note(''),
    ];
    const table = tokens.map(token => [
        `${token.line}:${token.column}`,
        token.type,
        token.lexeme ?? '',
        (token.type === TokenType.NUMBER || token.type === TokenType.IDENTIFIER) ? String(token.value)
            : token.type === TokenType.STRING ? JSON.stringify(token.value) : '',
    ]);
    const titles = ['Pos', 'Type', 'Text', 'Value'];
    const widths = titles.map((title, col) => Math.max(title.length, ...table.map(row => row[col].length)));
    const format = (row) => row.map((cell, col) => cell.padEnd(widths[col])).join('   ').trimEnd();

    rows.push(note(format(titles)), note(format(widths.map(width => '-'.repeat(width)))));
    table.forEach((row, index) => rows.push({ text: format(row), line: tokens[index].line }));
    return rows;
}

// --- AST ---
// A tree of { label, line, children: [{ edge, tree }] } that is easy to draw.

export function astTree(node) {
    const tree = (label, children = []) => ({
        label,
        line: node.line ?? null,
        children: children.filter(([, child]) => child).map(([edge, child]) => ({ edge, tree: astTree(child) })),
    });

    if (node instanceof ProgramNode) return tree('Program', node.statements.map(s => [null, s]));
    if (node instanceof BlockStatementNode) return tree('Block', node.statements.map(s => [null, s]));
    if (node instanceof LetStatementNode) return tree(`Let ${node.identifier.value}`, [['value', node.expression]]);
    if (node instanceof AssignmentNode) return tree(`Assign ${node.identifier.value}`, [['value', node.expression]]);
    if (node instanceof PrintStatementNode) return tree('Print', [['value', node.expression]]);
    if (node instanceof IfStatementNode) {
        return tree('If', [['condition', node.condition], ['then', node.consequence], ['else', node.alternative]]);
    }
    if (node instanceof WhileLoopNode) return tree('While', [['condition', node.condition], ['body', node.body]]);
    if (node instanceof ForLoopNode) {
        return tree('For', [['init', node.initializer], ['condition', node.condition], ['update', node.increment], ['body', node.body]]);
    }
    if (node instanceof BinaryOpNode) return tree(`BinaryOp ${OPERATOR_SYMBOLS[node.op.type]}`, [['left', node.left], ['right', node.right]]);
    if (node instanceof UnaryOpNode) return tree(`UnaryOp ${OPERATOR_SYMBOLS[node.op.type]}`, [['operand', node.right]]);
    if (node instanceof FunctionDeclarationNode) {
        return tree(`Function ${node.name.value}(${node.params.map(param => param.value).join(', ')})`, [['body', node.body]]);
    }
    if (node instanceof ReturnStatementNode) return tree('Return', [['value', node.expression]]);
    if (node instanceof CallNode) {
        return tree(`Call ${node.callee.value}`, node.args.map((arg, index) => [`argument ${index + 1}`, arg]));
    }
    if (node instanceof IdentifierNode) return tree(`Identifier ${node.value}`);
    if (node instanceof NumberNode) return tree(`Number ${node.value}`);
    if (node instanceof StringNode) return tree(`String ${JSON.stringify(node.value)}`);
    if (node instanceof BooleanNode) return tree(`Boolean ${node.value}`);
    return tree(node.constructor.name);
}

// Draws a tree with box characters. Children that start on another line are shown
// as one line (when 'onlyLine' is set) so a trace of a loop header stays short.
function drawTree(tree, onlyLine = null) {
    const lines = [];
    const visit = (node, edge, prefix, childPrefix) => {
        const label = edge ? `${edge}: ${node.label}` : node.label;
        const folded = onlyLine !== null && node.line !== onlyLine && node.children.length > 0;
        lines.push(`${prefix}${label}${folded ? ` ... (line ${node.line})` : ''}`);
        if (folded) return;
        node.children.forEach(({ edge: childEdge, tree: child }, index) => {
            const last = index === node.children.length - 1;
            visit(child, childEdge, childPrefix + (last ? '└─ ' : '├─ '), childPrefix + (last ? '   ' : '│  '));
        });
    };
    visit(tree, null, '', '');
    return lines;
}

// The outermost AST nodes that start on a line (not counting the whole Program)
function nodesOnLine(tree, line) {
    const found = [];
    const visit = (node, parentLine) => {
        if (node.line === line && parentLine !== line) {
            found.push(node);
            return;
        }
        node.children.forEach(({ tree: child }) => visit(child, node.line));
    };
    tree.children.forEach(({ tree: child }) => visit(child, null));
    return found;
}

// --- Trace: one source line through every phase ---

export function traceRows(build, line) {
    const sourceLine = build.source.split('\n')[line - 1] ?? '';
    const rows = [header(`--- Line ${line} ---`), { text: sourceLine.trim() === '' ? '(blank line)' : sourceLine, line: null, kind: 'source' }];
    const section = (title) => rows.push(note(''), header(title));
    const indent = (text) => ({ text: `    ${text}`, line: null });

    // 1. Lexer
    section('1. Lexer: tokens');
    const tokens = (build.tokens ?? []).filter(token => token.line === line && token.type !== TokenType.EOF);
    if (!build.tokens) rows.push(note('    The lexer stopped with an error, so there are no tokens.'));
    else if (tokens.length === 0) rows.push(note('    No tokens: this line is blank or only a comment.'));
    tokens.forEach(token => rows.push(indent(`${token.type.padEnd(11)} ${token.lexeme}`)));

    // 2. Parser
    section('2. Parser: syntax tree');
    if (!build.ast) {
        rows.push(note('    The parser stopped with an error, so there is no syntax tree.'));
        return rows;
    }
    const nodes = nodesOnLine(astTree(build.ast), line);
    if (nodes.length === 0) rows.push(note('    Nothing starts on this line; it belongs to a statement from an earlier line.'));
    nodes.forEach(node => drawTree(node, line).forEach(text => rows.push(indent(text))));

    // 3. Semantic analysis
    section('3. Semantic analysis: names and types');
    const { analysis } = build;
    const used = new Map();
    for (const [identifier, symbol] of analysis.resolutions) {
        if (identifier.line === line) used.set(symbol.id, symbol);
    }
    for (const symbol of used.values()) {
        const types = [...symbol.types].join(' or ') || 'unknown';
        const where = symbol.line === line ? 'declared on this line' : `declared on line ${symbol.line}`;
        rows.push(indent(`${symbol.name} -> ${where}, scope ${symbol.scope}, type ${types}`));
    }
    const problems = [
        ...analysis.errors.filter(error => error.line === line).map(error => `error: ${error.message}`),
        ...analysis.warnings.filter(warning => warning.line === line).map(warning => `warning: ${warning.message}`),
    ];
    problems.forEach(text => rows.push(indent(text)));
    if (used.size === 0 && problems.length === 0) rows.push(note('    No variables used here, and no problems found.'));

    if (!build.tac) {
        section('4-6. Code generation');
        rows.push(note('    Not generated: fix the errors above first.'));
        return rows;
    }

    // 4. Intermediate code
    section('4. Three-address code');
    const tac = tacRows(build.tac).filter(row => row.line === line);
    if (tac.length === 0) rows.push(note('    No instructions: nothing on this line runs by itself.'));
    tac.forEach(row => rows.push({ text: row.text.replace(/\s+; line \d+$/, ''), line: null }));

    // 5. Optimizer
    section('5. Optimizer');
    const changes = build.optimized.log.filter(change => change.line === line);
    changes.forEach(change => rows.push(indent(`${PASSES[change.pass].title}: ${change.before} => ${change.after ?? '(removed)'}`)));
    const optimized = tacRows(build.optimized.tac).filter(row => row.line === line);
    if (changes.length === 0) rows.push(note('    No changes on this line.'));
    if (optimized.length === 0 && tac.length > 0) rows.push(note('    Every instruction for this line was optimized away.'));
    else if (changes.length > 0) {
        rows.push(note('    Result:'));
        optimized.forEach(row => rows.push({ text: row.text.replace(/\s+; line \d+$/, ''), line: null }));
    }

    // 6. Bytecode
    section('6. Bytecode');
    const bytecode = bytecodeRows(build.bytecode).filter(row => row.line === line);
    if (bytecode.length === 0) rows.push(note('    No bytecode for this line.'));
    bytecode.forEach(row => rows.push(indent(row.text.replace(/, line \d+$|; line \d+$/, '').trimEnd())));
    return rows;
}
