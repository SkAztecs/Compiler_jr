import { TokenType } from '../../token.js';
import { formatOperand } from './tac.js';

// Phase 5: Code generation.
// Translates Three-Address Code into bytecode for a stack machine (see vm.js).
// Every variable and temp gets a numbered memory slot; operators take their
// inputs from the stack and push their result back.
//
//   t1 = a * b        LOAD a      push a's slot onto the stack
//                     LOAD b
//                     MUL         pop two values, push their product
//                     STORE t1    pop into t1's slot
//
// The main program comes first and ends with HALT; each function's code follows.
// A function has its own slots (parameters first), which live in a new "frame"
// on the VM's call stack each time it is called.

export const Opcode = {
    PUSH: 'PUSH',                   // push a constant
    LOAD: 'LOAD',                   // push the value in a slot
    STORE: 'STORE',                 // pop a value into a slot
    ADD: 'ADD', SUB: 'SUB', MUL: 'MUL', DIV: 'DIV',
    EQ: 'EQ', NEQ: 'NEQ', LT: 'LT', GT: 'GT',
    NEG: 'NEG', POS: 'POS', NOT: 'NOT',
    PRINT: 'PRINT',                 // pop a value and print it
    JUMP: 'JUMP',                   // go to an address
    JUMP_IF_FALSE: 'JUMP_IF_FALSE', // pop; jump if it is false
    JUMP_IF_TRUE: 'JUMP_IF_TRUE',   // pop; jump if it is true
    LOOP_START: 'LOOP_START',       // reset a loop's iteration counter
    LOOP_TICK: 'LOOP_TICK',         // count one iteration; stop runaway loops
    CALL: 'CALL',                   // pop the arguments, make a new frame, jump to the function
    RETURN_VALUE: 'RETURN_VALUE',   // pop the result, remove the frame, go back, push the result
    RETURN: 'RETURN',               // remove the frame and go back (the function gives nothing back)
    POP: 'POP',                     // throw away the top of the stack (an unused call result)
    FAIL: 'FAIL',                   // stop with an error message
    HALT: 'HALT',
};

const BINARY_OPCODES = {
    [TokenType.PLUS]: Opcode.ADD,
    [TokenType.MINUS]: Opcode.SUB,
    [TokenType.MULTIPLY]: Opcode.MUL,
    [TokenType.DIVIDE]: Opcode.DIV,
    [TokenType.EQ]: Opcode.EQ,
    [TokenType.NOT_EQ]: Opcode.NEQ,
    [TokenType.LT]: Opcode.LT,
    [TokenType.GT]: Opcode.GT,
};

const UNARY_OPCODES = {
    [TokenType.MINUS]: Opcode.NEG,
    [TokenType.PLUS]: Opcode.POS,
    [TokenType.BANG]: Opcode.NOT,
};

const isJump = (op) => op === Opcode.JUMP || op === Opcode.JUMP_IF_FALSE || op === Opcode.JUMP_IF_TRUE;

export function generateBytecode(tac, analysis) {
    const code = [];
    const labels = new Map(); // label name -> bytecode address

    // Slot layout of the main program: its variables (in declaration order), then temps
    const mainSlots = [
        ...analysis.symbols.filter(symbol => symbol.owner === null).map(symbol => symbol.irName),
        ...tac.temps,
    ];
    // Each function: parameters first (the caller's arguments go there), then its variables, then temps
    const functions = (tac.functions ?? []).map(fn => {
        const others = analysis.symbols
            .filter(symbol => symbol.owner === fn.name && !fn.params.includes(symbol.irName))
            .map(symbol => symbol.irName);
        return {
            name: fn.name,
            paramCount: fn.params.length,
            slotNames: [...fn.params, ...others, ...fn.temps],
            variableCount: fn.params.length + others.length, // the rest are temps
            entry: null,
        };
    });
    const functionIndex = new Map(functions.map((fn, index) => [fn.name, index]));

    const translate = (instructions, slotNames) => {
        const slotOf = new Map(slotNames.map((name, index) => [name, index]));
        instructions.forEach((instruction, tacIndex) => {
            const emit = (op, arg, extra = {}) => code.push({ op, arg, line: instruction.line, tacIndex, ...extra });
            const load = (operand) => operand.kind === 'const'
                ? emit(Opcode.PUSH, operand.value)
                : emit(Opcode.LOAD, slotOf.get(operand.name), { name: operand.name });
            const store = (operand) => emit(Opcode.STORE, slotOf.get(operand.name), { name: operand.name });

            switch (instruction.op) {
                case 'copy':
                    load(instruction.src);
                    store(instruction.dst);
                    break;
                case 'binary':
                    load(instruction.left);
                    load(instruction.right);
                    emit(BINARY_OPCODES[instruction.operator]);
                    store(instruction.dst);
                    break;
                case 'unary':
                    load(instruction.arg);
                    emit(UNARY_OPCODES[instruction.operator]);
                    store(instruction.dst);
                    break;
                case 'print':
                    load(instruction.arg);
                    emit(Opcode.PRINT);
                    break;
                case 'label':
                    labels.set(instruction.name, code.length); // a label is an address, not an instruction
                    break;
                case 'goto':
                    emit(Opcode.JUMP, instruction.target);
                    break;
                case 'ifFalse':
                    load(instruction.cond);
                    emit(Opcode.JUMP_IF_FALSE, instruction.target);
                    break;
                case 'ifTrue':
                    load(instruction.cond);
                    emit(Opcode.JUMP_IF_TRUE, instruction.target);
                    break;
                case 'loopStart':
                    emit(Opcode.LOOP_START, instruction.loop);
                    break;
                case 'loopTick':
                    emit(Opcode.LOOP_TICK, instruction.loop);
                    break;
                case 'param':
                    load(instruction.arg); // arguments wait on the stack until the call
                    break;
                case 'call':
                    emit(Opcode.CALL, functionIndex.get(instruction.fn), { name: instruction.fn, argc: instruction.argc });
                    if (instruction.dst) store(instruction.dst);
                    else emit(Opcode.POP); // every call leaves a result; this one isn't needed
                    break;
                case 'return':
                    if (instruction.arg) {
                        load(instruction.arg);
                        emit(Opcode.RETURN_VALUE);
                    } else {
                        emit(Opcode.RETURN);
                    }
                    break;
                case 'fail':
                    emit(Opcode.FAIL, instruction.message);
                    break;
                default:
                    throw new Error(`No bytecode for TAC instruction: ${instruction.op}`);
            }
        });
    };

    translate(tac.instructions, mainSlots);
    code.push({ op: Opcode.HALT, arg: undefined, line: null, tacIndex: tac.instructions.length });
    (tac.functions ?? []).forEach((fn, index) => {
        functions[index].entry = code.length;
        translate(fn.instructions, functions[index].slotNames);
    });

    // Second pass ("backpatching"): replace label names with real addresses
    for (const instruction of code) {
        if (isJump(instruction.op)) {
            instruction.label = instruction.arg;
            instruction.arg = labels.get(instruction.arg);
        }
    }

    const globals = analysis.symbols
        .filter(symbol => symbol.isGlobal)
        .map(symbol => ({ name: symbol.name, slot: mainSlots.indexOf(symbol.irName) }));

    const variableCount = mainSlots.length - tac.temps.length;
    return { code, slotNames: mainSlots, variableCount, globals, functions, loops: tac.loops };
}

// Display rows: { text, line, kind }, one per instruction
export function bytecodeRows(program) {
    const lines = [{ text: '--- Bytecode (stack machine, from the optimized TAC) ---', line: null, kind: 'header' }];
    const width = String(program.code.length - 1).length;
    const entries = new Map((program.functions ?? []).map(fn => [fn.entry, fn]));
    let lastLine = null;
    program.code.forEach((instruction, address) => {
        const fn = entries.get(address);
        if (fn) {
            lines.push({ text: '', line: null }, { text: `function ${fn.name}:  (its slots: ${fn.slotNames.join(', ') || 'none'})`, line: null, kind: 'label' });
            lastLine = null;
        }
        let arg = '';
        let comment = '';
        if (instruction.op === Opcode.PUSH) {
            arg = formatOperand({ kind: 'const', value: instruction.arg });
        } else if (instruction.op === Opcode.LOAD || instruction.op === Opcode.STORE) {
            arg = String(instruction.arg);
            comment = instruction.name;
        } else if (instruction.op === Opcode.CALL) {
            arg = `#${instruction.arg}`;
            comment = `${instruction.name}, ${instruction.argc} ${instruction.argc === 1 ? 'argument' : 'arguments'}`;
        } else if (instruction.op === Opcode.FAIL) {
            comment = instruction.arg;
        } else if (instruction.label !== undefined) {
            arg = String(instruction.arg).padStart(width, '0');
            comment = instruction.label;
        } else if (instruction.arg !== undefined) {
            arg = `#${instruction.arg}`;
        }
        if (instruction.line !== null && instruction.line !== lastLine) {
            comment = comment ? `${comment}, line ${instruction.line}` : `line ${instruction.line}`;
            lastLine = instruction.line;
        }
        const text = `${String(address).padStart(width, '0')}  ${instruction.op.padEnd(14)}${arg.padEnd(10)}`;
        lines.push({ text: (comment ? `${text}; ${comment}` : text).trimEnd(), line: instruction.line, address });
    });
    return lines;
}
