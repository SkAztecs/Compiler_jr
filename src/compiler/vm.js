import { TokenType } from '../../token.js';
import { MAX_CALL_DEPTH, MAX_LOOP_ITERATIONS, callDepthError } from '../interpreter/evaluator.js';
import { Opcode } from './codegen.js';
import { applyBinary, applyUnary, isTruthy } from './runtime.js';

// Phase 6: Execution.
// A stack-based virtual machine: it reads one bytecode instruction at a time,
// using an operand stack for intermediate values and numbered slots for variables.
// Function calls use a call stack of frames: each call gets its own slots, its own
// loop counters and the address to go back to when it returns.

const BINARY_OPERATORS = {
    [Opcode.ADD]: TokenType.PLUS,
    [Opcode.SUB]: TokenType.MINUS,
    [Opcode.MUL]: TokenType.MULTIPLY,
    [Opcode.DIV]: TokenType.DIVIDE,
    [Opcode.EQ]: TokenType.EQ,
    [Opcode.NEQ]: TokenType.NOT_EQ,
    [Opcode.LT]: TokenType.LT,
    [Opcode.GT]: TokenType.GT,
};

const UNARY_OPERATORS = {
    [Opcode.NEG]: TokenType.MINUS,
    [Opcode.POS]: TokenType.PLUS,
    [Opcode.NOT]: TokenType.BANG,
};

// A runtime error that remembers which source line was running
export class VMError extends Error {
    constructor(message, line) {
        super(message);
        this.line = line;
    }
}

export class VM {
    constructor(program, outputLogger) {
        this.program = program;
        this.outputLogger = outputLogger;
        this.frame = this.newFrame(program.slotNames.length, null, null);
        this.frames = [this.frame];                               // (Module 1) call stack
        this.slots = this.frame.slots;                            // the main program's variables
        this.stack = [];                                          // (Module 1) operand stack
        this.pc = 0;                                              // program counter
        this.steps = 0;                                           // instructions executed
    }

    // An activation record: one call's variables and where to go back to afterwards
    newFrame(slotCount, returnPc, fn) {
        return {
            slots: new Array(slotCount),
            loopCounters: new Array(this.program.loops).fill(0),
            returnPc,
            fn, // null for the main program
        };
    }

    run() {
        while (!this.step()) {
            // keep going until HALT
        }
        return this;
    }

    // Runs one instruction; returns true when the program has finished.
    // The debugger calls this directly to record the run one step at a time.
    step() {
        const instruction = this.program.code[this.pc];
        this.pc++;
        this.steps++;
        try {
            return this.execute(instruction);
        } catch (error) {
            throw new VMError(error.message, instruction.line);
        }
    }

    // Runs one instruction; returns true on HALT
    execute({ op, arg }) {
        const stack = this.stack;
        switch (op) {
            case Opcode.PUSH: stack.push(arg); break;
            case Opcode.LOAD: stack.push(this.frame.slots[arg]); break;
            case Opcode.STORE: this.frame.slots[arg] = stack.pop(); break;
            case Opcode.PRINT: this.outputLogger(stack.pop()); break;
            case Opcode.JUMP: this.pc = arg; break;
            case Opcode.JUMP_IF_FALSE: if (!isTruthy(stack.pop())) this.pc = arg; break;
            case Opcode.JUMP_IF_TRUE: if (isTruthy(stack.pop())) this.pc = arg; break;
            case Opcode.LOOP_START: this.frame.loopCounters[arg] = 0; break;
            case Opcode.LOOP_TICK:
                if (++this.frame.loopCounters[arg] > MAX_LOOP_ITERATIONS) {
                    throw new Error(`Loop stopped after ${MAX_LOOP_ITERATIONS} iterations. Check that its condition eventually becomes false.`);
                }
                break;
            case Opcode.CALL: {
                const fn = this.program.functions[arg];
                if (this.frames.length > MAX_CALL_DEPTH) throw new Error(callDepthError(fn.name));
                const args = stack.splice(stack.length - fn.paramCount, fn.paramCount);
                const frame = this.newFrame(fn.slotNames.length, this.pc, fn);
                args.forEach((value, index) => { frame.slots[index] = value; }); // parameters come first
                this.frames.push(frame);
                this.frame = frame;
                this.pc = fn.entry;
                break;
            }
            case Opcode.RETURN_VALUE:
            case Opcode.RETURN: {
                const result = op === Opcode.RETURN_VALUE ? stack.pop() : null;
                const finished = this.frames.pop();
                this.frame = this.frames[this.frames.length - 1];
                this.pc = finished.returnPc;
                stack.push(result);
                break;
            }
            case Opcode.POP: stack.pop(); break;
            case Opcode.FAIL: throw new Error(arg);
            case Opcode.HALT: return true;
            default:
                if (op in BINARY_OPERATORS) {
                    const right = stack.pop();
                    const left = stack.pop();
                    stack.push(applyBinary(BINARY_OPERATORS[op], left, right));
                } else if (op in UNARY_OPERATORS) {
                    stack.push(applyUnary(UNARY_OPERATORS[op], stack.pop()));
                } else {
                    throw new Error(`Unknown opcode: ${op}`);
                }
        }
        return false;
    }

    // Global variables and their final values, like the Evaluator's global environment
    globals() {
        return Object.fromEntries(this.program.globals.map(({ name, slot }) => [name, this.slots[slot]]));
    }
}
