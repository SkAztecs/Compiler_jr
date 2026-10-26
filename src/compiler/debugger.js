import { VM } from './vm.js';
import { Opcode } from './codegen.js';
import { formatValue } from './runtime.js';

// The step-through debugger.
// The program is run once on the VM while every instruction is recorded: which
// instruction ran, the stack afterwards, and any variable it changed. Moving
// backwards and forwards ("time travel") then just means looking at a different
// point in that recording, so the program never has to run again.

// Long-running programs are recorded only this far, to keep the page fast
export const MAX_RECORDED_STEPS = 20000;

// Returns { steps, output, error, finished, truncated }.
// steps[i] describes the i-th instruction run: { pc, stack, store, outputLength, error }.
export function recordExecution(program, limit = MAX_RECORDED_STEPS) {
    const output = [];
    const vm = new VM(program, value => output.push(formatValue(value)));
    const steps = [];
    let error = null;
    let finished = false;

    while (steps.length < limit) {
        const pc = vm.pc;
        const instruction = program.code[pc];
        try {
            finished = vm.step();
        } catch (failure) {
            error = { message: failure.message, line: failure.line };
        }
        steps.push({
            pc,
            stack: [...vm.stack],
            store: instruction.op === Opcode.STORE && !error ? { slot: instruction.arg, value: vm.slots[instruction.arg] } : null,
            outputLength: output.length,
            error: error?.message ?? null,
        });
        if (finished || error) break;
    }
    return { steps, output, error, finished, truncated: !finished && !error };
}

// The function whose code contains an address (null for the main program)
export function functionAt(program, pc) {
    let found = null;
    for (const fn of program.functions ?? []) {
        if (fn.entry <= pc && (!found || fn.entry > found.entry)) found = fn;
    }
    return found;
}

// The machine as it is after 'count' instructions have run (0 = before the first).
// The call stack is rebuilt by replaying the calls and returns in order.
export function stateAt(program, recording, count) {
    const frames = [{
        name: null,
        slotNames: program.slotNames,
        variableCount: program.variableCount,
        slots: new Array(program.slotNames.length).fill(undefined),
        calledFrom: null,
    }];
    let changed = null;
    for (let i = 0; i < count; i++) {
        const step = recording.steps[i];
        const { op, arg, line } = program.code[step.pc];
        if (step.error) break;
        if (op === Opcode.CALL) {
            const fn = program.functions[arg];
            const before = i > 0 ? recording.steps[i - 1].stack : [];
            const slots = new Array(fn.slotNames.length).fill(undefined);
            before.slice(before.length - fn.paramCount).forEach((value, index) => { slots[index] = value; });
            frames.push({ name: fn.name, slotNames: fn.slotNames, variableCount: fn.variableCount, slots, calledFrom: line });
        } else if (op === Opcode.RETURN || op === Opcode.RETURN_VALUE) {
            frames.pop();
        } else if (step.store) {
            frames[frames.length - 1].slots[step.store.slot] = step.store.value;
            if (i === count - 1) changed = step.store.slot;
        }
    }
    const last = count > 0 ? recording.steps[count - 1] : null;
    const done = last !== null && (last.error !== null || program.code[last.pc].op === Opcode.HALT);
    const frame = frames[frames.length - 1];
    return {
        frames,                                                         // the call stack, main program first
        slots: frame.slots,                                             // the running function's memory
        changed,                                                        // slot written by the last instruction
        stack: last ? last.stack : [],
        output: recording.output.slice(0, last ? last.outputLength : 0),
        nextPc: count < recording.steps.length ? recording.steps[count].pc : null, // null when there is nothing left
        lastPc: last ? last.pc : null,
        error: last?.error ?? null,
        done,
    };
}

export function showValue(value) {
    if (value === undefined) return '(not set yet)';
    if (value === null) return 'nothing';
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

const OPERATION_WORDS = {
    [Opcode.ADD]: ['+', 'added'], [Opcode.SUB]: ['-', 'subtracted'], [Opcode.MUL]: ['*', 'multiplied'],
    [Opcode.DIV]: ['/', 'divided'], [Opcode.EQ]: ['==', 'compared'], [Opcode.NEQ]: ['!=', 'compared'],
    [Opcode.LT]: ['<', 'compared'], [Opcode.GT]: ['>', 'compared'],
};

// A plain-language description of what the instruction at step 'index' did
export function explainStep(program, recording, index) {
    const step = recording.steps[index];
    const { op, arg, label } = program.code[step.pc];
    const before = index > 0 ? recording.steps[index - 1].stack : [];
    const top = before[before.length - 1];
    const name = (slot) => program.code[step.pc].name ?? program.slotNames[slot];
    const running = functionAt(program, step.pc)?.name;
    if (step.error) return `This instruction stopped the program: ${step.error}`;

    switch (op) {
        case Opcode.PUSH: return `Pushed the value ${showValue(arg)} onto the stack.`;
        case Opcode.LOAD: return `Read ${name(arg)} (${showValue(step.stack[step.stack.length - 1])}) and pushed it onto the stack.`;
        case Opcode.STORE: return `Took ${showValue(top)} off the stack and stored it in ${name(arg)}.`;
        case Opcode.PRINT: return `Took ${showValue(top)} off the stack and printed it.`;
        case Opcode.NEG: return `Took ${showValue(top)} off the stack and pushed its negative.`;
        case Opcode.POS: return `Took ${showValue(top)} off the stack and pushed it back as a number.`;
        case Opcode.NOT: return `Took ${showValue(top)} off the stack and pushed the opposite: ${showValue(step.stack[step.stack.length - 1])}.`;
        case Opcode.JUMP: return `Jumped to instruction ${arg} (${label}).`;
        case Opcode.JUMP_IF_FALSE:
            return top === false
                ? `Took false off the stack, so jumped to instruction ${arg} (${label}).`
                : `Took ${showValue(top)} off the stack. It is not false, so carried on to the next instruction.`;
        case Opcode.JUMP_IF_TRUE:
            return top !== false
                ? `Took ${showValue(top)} off the stack. It counts as true, so jumped to instruction ${arg} (${label}).`
                : 'Took false off the stack, so carried on to the next instruction.';
        case Opcode.LOOP_START: return `Started loop #${arg}: its pass counter is set to 0 (it stops loops that never end).`;
        case Opcode.LOOP_TICK: return `Counted one more pass through loop #${arg}.`;
        case Opcode.CALL: {
            const fn = program.functions[arg];
            const args = before.slice(before.length - fn.paramCount).map(showValue);
            const given = args.length > 0 ? ` with ${args.join(', ')}` : '';
            return `Called ${fn.name}${given}. A new frame on the call stack holds its variables, and the program jumped to instruction ${fn.entry}.`;
        }
        case Opcode.RETURN_VALUE:
            return `${running} gave back ${showValue(top)}: its frame was removed, and the program went back to where it was called.`;
        case Opcode.RETURN:
            return `${running} finished (it gives nothing back): its frame was removed, and the program went back to where it was called.`;
        case Opcode.POP: return 'Threw away the result of a call that is not used.';
        case Opcode.HALT: return 'The program has finished.';
        default: {
            const [symbol, verb] = OPERATION_WORDS[op];
            const [left, right] = before.slice(-2);
            const result = step.stack[step.stack.length - 1];
            return `Took ${showValue(left)} and ${showValue(right)} off the stack, ${verb} them (${showValue(left)} ${symbol} ${showValue(right)}), and pushed ${showValue(result)}.`;
        }
    }
}

// The first step at or after 'from' that runs on a different source line, for "next line"
export function nextLineStep(program, recording, from) {
    const lineOf = (count) => (count < recording.steps.length ? program.code[recording.steps[count].pc].line : null);
    const start = lineOf(from);
    let count = from + 1;
    while (count < recording.steps.length && (lineOf(count) === start || lineOf(count) === null)) count++;
    return Math.min(count, recording.steps.length);
}

// The start of the previous source line's instructions, for "previous line"
export function previousLineStep(program, recording, from) {
    const lineOf = (count) => (count < recording.steps.length ? program.code[recording.steps[count].pc].line : null);
    let count = Math.max(0, from - 1);
    const target = lineOf(count);
    while (count > 0 && lineOf(count - 1) === target) count--;
    return count;
}
