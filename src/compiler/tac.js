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
import { missingReturnError } from '../interpreter/evaluator.js';

// Phase 4: Intermediate code generation.
// Flattens the AST into Three-Address Code (TAC): simple instructions with at most
// one operator each, like  t1 = a * b . Loops and ifs become labels and jumps.
//
// Instructions:
//   copy     dst = src
//   binary   dst = left op right
//   unary    dst = op arg
//   print    print arg
//   label    L1:
//   goto     goto L1
//   ifFalse  ifFalse cond goto L1
//   ifTrue   ifTrue cond goto L1
//   loopStart / loopTick   runtime guard that stops a runaway loop
//   param    param x                 pass x to the next call
//   call     t1 = call f, 2          call f with the last 2 params (dst is null when unused)
//   return   return x  /  return     leave the function, giving back x
//   fail     fail "message"          stop with an error (a function that ends without its return)
//
// The main program and each function get their own instruction list.
//
// Operands: { kind: 'const', value } | { kind: 'var', name } | { kind: 'temp', name }

const constant = (value) => ({ kind: 'const', value });

export function generateTAC(ast, analysis) {
    return new TACGenerator(analysis).generate(ast);
}

class TACGenerator {
    constructor(analysis) {
        this.analysis = analysis;
        this.resolutions = analysis.resolutions;
        this.instructions = [];
        this.temps = [];
        this.tempCount = 0;
        this.labelCount = 0;
        this.loopCount = 0;
    }

    generate(ast) {
        const declarations = ast.statements.filter(statement => statement instanceof FunctionDeclarationNode);
        ast.statements.filter(statement => !(statement instanceof FunctionDeclarationNode))
            .forEach(statement => this.statement(statement));
        const main = { instructions: this.instructions, temps: this.temps };

        // Each function's body becomes its own list of instructions
        const functions = declarations.map(node => {
            const fn = this.resolutions.get(node.name);
            this.instructions = [];
            this.temps = [];
            this.statement(node.body);
            // Reaching the end: a function that gives back values on other paths has
            // forgotten a return; one that never gives back a value simply returns
            if (fn.returnsValue) this.emit({ op: 'fail', message: missingReturnError(fn.name) }, node.line);
            else this.emit({ op: 'return', arg: null }, node.line);
            return {
                name: fn.name,
                line: node.line,
                params: fn.paramSymbols.map(symbol => symbol.irName),
                instructions: this.instructions,
                temps: this.temps,
            };
        });
        return { ...main, functions, loops: this.loopCount };
    }

    emit(instruction, line) {
        this.instructions.push({ ...instruction, line });
    }

    newTemp() {
        this.tempCount++;
        const name = `t${this.tempCount}`;
        this.temps.push(name);
        return { kind: 'temp', name };
    }

    newLabel() {
        this.labelCount++;
        return `L${this.labelCount}`;
    }

    variable(identifier) {
        return { kind: 'var', name: this.resolutions.get(identifier).irName };
    }

    // --- Statements ---

    statement(node) {
        if (node instanceof ProgramNode || node instanceof BlockStatementNode) {
            node.statements.forEach(statement => this.statement(statement));
        } else if (node instanceof LetStatementNode) {
            this.store(this.variable(node.identifier), node.expression, node.line);
        } else if (node instanceof PrintStatementNode) {
            const value = this.expression(node.expression);
            this.emit({ op: 'print', arg: value }, node.line);
        } else if (node instanceof IfStatementNode) {
            this.ifStatement(node);
        } else if (node instanceof WhileLoopNode) {
            this.whileLoop(node);
        } else if (node instanceof ForLoopNode) {
            this.forLoop(node);
        } else if (node instanceof ReturnStatementNode) {
            const value = node.expression ? this.expression(node.expression) : null;
            this.emit({ op: 'return', arg: value }, node.line);
        } else if (node instanceof CallNode) {
            this.call(node, null, false); // a call on its own line: its result is not kept
        } else {
            this.expression(node); // Expression statement: keep side effects, drop the value
        }
    }

    // Arguments are worked out left to right, then passed with 'param' just before the call.
    // In f(a, a = 5) the first argument must be read before the second one changes it.
    call(node, target, wantValue = true) {
        const args = node.args.map((arg, index) => {
            const value = this.expression(arg);
            const changedLater = node.args.slice(index + 1).some(containsAssignment);
            if (value.kind === 'var' && changedLater) {
                const saved = this.newTemp();
                this.emit({ op: 'copy', dst: saved, src: value }, node.line);
                return saved;
            }
            return value;
        });
        args.forEach(arg => this.emit({ op: 'param', arg }, node.line));
        const dst = wantValue ? (target ?? this.newTemp()) : null;
        this.emit({ op: 'call', dst, fn: node.callee.value, argc: args.length }, node.line);
        return dst;
    }

    // Writes an expression's value into a variable, computing it straight into the
    // variable when possible (x = a + b) instead of via a temp (t1 = a + b; x = t1)
    store(target, expression, line) {
        const value = this.expression(expression, target);
        if (value !== target) this.emit({ op: 'copy', dst: target, src: value }, line);
        return target;
    }

    ifStatement(node) {
        const condition = this.expression(node.condition);
        const elseLabel = this.newLabel();
        this.emit({ op: 'ifFalse', cond: condition, target: elseLabel }, node.line);
        this.statement(node.consequence);

        if (node.alternative === null) {
            this.emit({ op: 'label', name: elseLabel }, node.line);
            return;
        }
        const endLabel = this.newLabel();
        this.emit({ op: 'goto', target: endLabel }, node.line);
        this.emit({ op: 'label', name: elseLabel }, node.line);
        this.statement(node.alternative);
        this.emit({ op: 'label', name: endLabel }, node.line);
    }

    whileLoop(node) {
        const loop = this.loopCount++;
        const startLabel = this.newLabel();

        this.emit({ op: 'loopStart', loop }, node.line);
        this.emit({ op: 'label', name: startLabel }, node.line);
        const condition = this.expression(node.condition);
        const endLabel = this.newLabel();
        this.emit({ op: 'ifFalse', cond: condition, target: endLabel }, node.line);
        this.emit({ op: 'loopTick', loop }, node.line);
        this.statement(node.body);
        this.emit({ op: 'goto', target: startLabel }, node.line);
        this.emit({ op: 'label', name: endLabel }, node.line);
    }

    forLoop(node) {
        if (node.initializer) this.statement(node.initializer);
        const loop = this.loopCount++;
        const startLabel = this.newLabel();
        this.emit({ op: 'loopStart', loop }, node.line);
        this.emit({ op: 'label', name: startLabel }, node.line);
        let endLabel = null;
        if (node.condition) {
            const condition = this.expression(node.condition);
            endLabel = this.newLabel();
            this.emit({ op: 'ifFalse', cond: condition, target: endLabel }, node.line);
        }
        this.emit({ op: 'loopTick', loop }, node.line);
        this.statement(node.body);
        if (node.increment) this.expression(node.increment);
        this.emit({ op: 'goto', target: startLabel }, node.line);
        if (endLabel) this.emit({ op: 'label', name: endLabel }, node.line);
    }

    // --- Expressions ---
    // Returns the operand holding the result. 'target', when given, is a variable the
    // caller wants the result in; it is only written by the final instruction.

    expression(node, target = null) {
        if (node instanceof NumberNode || node instanceof StringNode || node instanceof BooleanNode) {
            return constant(node.value);
        }
        if (node instanceof IdentifierNode) {
            return this.variable(node);
        }
        if (node instanceof AssignmentNode) {
            return this.store(this.variable(node.identifier), node.expression, node.line);
        }
        if (node instanceof CallNode) {
            return this.call(node, target);
        }
        if (node instanceof UnaryOpNode) {
            const arg = this.expression(node.right);
            const dst = target ?? this.newTemp();
            this.emit({ op: 'unary', dst, operator: node.op.type, arg }, node.line);
            return dst;
        }
        if (node instanceof BinaryOpNode) {
            if (node.op.type === TokenType.AND || node.op.type === TokenType.OR) {
                return this.logical(node, target);
            }
            let left = this.expression(node.left);
            // In  a + (a = 5)  the left 'a' must be read before the right side changes it
            if (left.kind === 'var' && containsAssignment(node.right)) {
                const saved = this.newTemp();
                this.emit({ op: 'copy', dst: saved, src: left }, node.line);
                left = saved;
            }
            const right = this.expression(node.right);
            const dst = target ?? this.newTemp();
            this.emit({ op: 'binary', dst, left, operator: node.op.type, right }, node.line);
            return dst;
        }
        throw new Error(`No TAC generation for node type: ${node.constructor.name}`);
    }

    // && and || become jumps ("short-circuit code"): the right side is skipped
    // when the left side already decides the answer
    logical(node, target) {
        const left = this.expression(node.left);
        const trueLabel = this.newLabel();
        const falseLabel = this.newLabel();
        const endLabel = this.newLabel();
        if (node.op.type === TokenType.AND) {
            this.emit({ op: 'ifFalse', cond: left, target: falseLabel }, node.line);
        } else {
            this.emit({ op: 'ifTrue', cond: left, target: trueLabel }, node.line);
        }
        const right = this.expression(node.right);
        this.emit({ op: 'ifFalse', cond: right, target: falseLabel }, node.line);
        const dst = target ?? this.newTemp();
        this.emit({ op: 'label', name: trueLabel }, node.line);
        this.emit({ op: 'copy', dst, src: constant(true) }, node.line);
        this.emit({ op: 'goto', target: endLabel }, node.line);
        this.emit({ op: 'label', name: falseLabel }, node.line);
        this.emit({ op: 'copy', dst, src: constant(false) }, node.line);
        this.emit({ op: 'label', name: endLabel }, node.line);
        return dst;
    }
}

function containsAssignment(node) {
    if (node instanceof AssignmentNode) return true;
    if (node instanceof CallNode) return node.args.some(containsAssignment);
    if (node instanceof BinaryOpNode) return containsAssignment(node.left) || containsAssignment(node.right);
    if (node instanceof UnaryOpNode) return containsAssignment(node.right);
    return false;
}

export function formatOperand(operand) {
    if (operand.kind === 'const') {
        return typeof operand.value === 'string' ? JSON.stringify(operand.value) : String(operand.value);
    }
    return operand.name;
}

export function formatTACInstruction(instruction) {
    const op = (type) => OPERATOR_SYMBOLS[type];
    switch (instruction.op) {
        case 'copy': return `${formatOperand(instruction.dst)} = ${formatOperand(instruction.src)}`;
        case 'binary': return `${formatOperand(instruction.dst)} = ${formatOperand(instruction.left)} ${op(instruction.operator)} ${formatOperand(instruction.right)}`;
        case 'unary': return `${formatOperand(instruction.dst)} = ${op(instruction.operator)}${formatOperand(instruction.arg)}`;
        case 'print': return `print ${formatOperand(instruction.arg)}`;
        case 'label': return `${instruction.name}:`;
        case 'goto': return `goto ${instruction.target}`;
        case 'ifFalse': return `ifFalse ${formatOperand(instruction.cond)} goto ${instruction.target}`;
        case 'ifTrue': return `ifTrue ${formatOperand(instruction.cond)} goto ${instruction.target}`;
        case 'loopStart': return `loop_start #${instruction.loop}`;
        case 'loopTick': return `loop_tick #${instruction.loop}`;
        case 'param': return `param ${formatOperand(instruction.arg)}`;
        case 'call': return `${instruction.dst ? `${formatOperand(instruction.dst)} = ` : ''}call ${instruction.fn}, ${instruction.argc}`;
        case 'return': return instruction.arg ? `return ${formatOperand(instruction.arg)}` : 'return';
        case 'fail': return `fail ${JSON.stringify(instruction.message)}`;
        default: return instruction.op;
    }
}

// Display rows: { text, line, kind }, one per instruction
export function tacRows(tac, title = 'Three-Address Code') {
    const lines = [{ text: `--- ${title} ---`, line: null, kind: 'header' }];
    const unit = (instructions, lastLineStart = null) => {
        let lastLine = lastLineStart;
        for (const instruction of instructions) {
            const text = formatTACInstruction(instruction);
            if (instruction.op === 'label') {
                lines.push({ text, line: instruction.line, kind: 'label' });
                continue;
            }
            // Show the source line once, where its instructions start
            const source = instruction.line !== lastLine ? `; line ${instruction.line}` : '';
            lastLine = instruction.line;
            const gap = ' '.repeat(Math.max(2, 28 - text.length));
            lines.push({ text: `    ${text}${source ? gap + source : ''}`, line: instruction.line });
        }
    };
    unit(tac.instructions);
    lines.push({ text: '    halt', line: null });
    for (const fn of tac.functions ?? []) {
        lines.push({ text: '', line: null }, { text: `function ${fn.name}(${fn.params.join(', ')}):`, line: fn.line, kind: 'label' });
        unit(fn.instructions, fn.line);
    }
    return lines;
}
