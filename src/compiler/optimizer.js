import { TokenType } from '../../token.js';
import { applyBinary, applyUnary, isTruthy } from './runtime.js';
import { formatTACInstruction, tacRows } from './tac.js';

// Phase 4b: Optimization.
// Rewrites the Three-Address Code so the VM has less work to do, without changing
// what the program prints, which error it stops with, or its final variables.
// Each pass records what it changed and why, so students can follow along.
//
// The passes repeat until none of them finds anything left to improve,
// because one improvement often makes another possible.

export const PASSES = {
    propagation: {
        title: 'Constant & copy propagation',
        why: 'A variable or temp whose value is already known here is replaced by that value.',
    },
    folding: {
        title: 'Constant folding',
        why: 'An operation on values known at compile time is worked out now, so the VM never has to.',
    },
    uselessCopy: {
        title: 'Useless copy removal',
        why: 'Copying a variable into itself does nothing.',
    },
    branchFolding: {
        title: 'Branch folding',
        why: 'The condition is always the same, so the jump either always happens or never does.',
    },
    unreachable: {
        title: 'Unreachable code removal',
        why: 'Nothing can ever jump here or fall through to here, so this code can never run.',
    },
    jumpToNext: {
        title: 'Jump-to-next removal',
        why: 'The jump goes to the instruction right after it, which runs next anyway.',
    },
    unusedLabel: {
        title: 'Unused label removal',
        why: 'No jump goes to this label any more. Removing it joins two basic blocks, which lets propagation see further.',
    },
    deadTemp: {
        title: 'Dead code removal',
        why: 'This temp is computed but its value is never used.',
    },
    unusedLoopGuard: {
        title: 'Unused loop guard removal',
        why: "The loop's body was removed, so its runaway-loop counter is no longer needed.",
    },
};

const MAX_ROUNDS = 10;

const isJump = (instruction) => instruction.op === 'goto' || instruction.op === 'ifFalse' || instruction.op === 'ifTrue';
const constant = (value) => ({ kind: 'const', value });

// Operations that can never throw, so they are safe to delete when unused.
// Anything else (like a / b) might stop the program with an error, which must still happen.
function cannotFail(instruction) {
    if (instruction.op === 'copy') return true;
    if (instruction.op === 'unary') return instruction.operator === TokenType.BANG;
    if (instruction.op === 'binary') return instruction.operator === TokenType.EQ || instruction.operator === TokenType.NOT_EQ;
    return false;
}

// The main program and every function are optimized separately: a function can't see
// the caller's variables, so nothing known in one list is ever used in another
export function optimizeTAC(tac) {
    const optimizer = new Optimizer();
    let rounds = 0;

    const optimizeList = (instructions, temps) => {
        let code = instructions.map(instruction => ({ ...instruction }));
        let listRounds = 0;
        while (listRounds < MAX_ROUNDS) {
            listRounds++;
            const changesBefore = optimizer.log.length;
            code = optimizer.propagateAndFold(code);
            code = optimizer.foldBranches(code);
            code = optimizer.removeUnreachable(code);
            code = optimizer.removeJumpsToNext(code);
            code = optimizer.removeUnusedLabels(code);
            code = optimizer.removeDeadTemps(code);
            code = optimizer.removeUnusedLoopGuards(code);
            if (optimizer.log.length === changesBefore) break;
        }
        rounds = Math.max(rounds, listRounds);

        const usedTemps = new Set();
        for (const instruction of code) {
            for (const operand of [instruction.dst, instruction.src, instruction.left, instruction.right, instruction.arg, instruction.cond]) {
                if (operand?.kind === 'temp') usedTemps.add(operand.name);
            }
        }
        return { instructions: code, temps: temps.filter(temp => usedTemps.has(temp)) };
    };

    const main = optimizeList(tac.instructions, tac.temps);
    const functions = (tac.functions ?? []).map(fn => ({ ...fn, ...optimizeList(fn.instructions, fn.temps) }));
    return {
        tac: { ...main, functions, loops: tac.loops },
        log: optimizer.log,
        rounds,
    };
}

// Instructions in the main program and all functions together
export function countTAC(tac) {
    return tac.instructions.length + (tac.functions ?? []).reduce((sum, fn) => sum + fn.instructions.length, 0);
}

// Instructions after which the next one can only be reached by a jump
const endsFlow = (instruction) => instruction.op === 'goto' || instruction.op === 'return' || instruction.op === 'fail';

class Optimizer {
    constructor() {
        this.log = []; // { pass, line, before, after }  (after is null when removed)
    }

    record(pass, instruction, after) {
        this.log.push({
            pass,
            line: instruction.line,
            before: formatTACInstruction(instruction),
            after: after ? formatTACInstruction(after) : null,
        });
    }

    // Within each basic block (straight-line code with no labels in between), remember
    // which names currently hold a known value, and use that value directly.
    propagateAndFold(code) {
        const result = [];
        let known = new Map(); // name -> operand it is known to equal

        const substitute = (operand) => (operand.kind !== 'const' && known.has(operand.name)) ? known.get(operand.name) : operand;

        for (const original of code) {
            // A label can be reached by a jump from elsewhere, so nothing is known any more
            if (original.op === 'label') known = new Map();

            // 1. Propagation: replace operands whose value is known
            let instruction = { ...original };
            for (const field of ['src', 'left', 'right', 'arg', 'cond']) {
                if (instruction[field]) instruction[field] = substitute(instruction[field]);
            }
            if (formatTACInstruction(instruction) !== formatTACInstruction(original)) {
                this.record('propagation', original, instruction);
            }

            // 2. Folding: compute operations whose inputs are all constants
            const folded = this.fold(instruction);
            if (folded) {
                this.record('folding', instruction, folded);
                instruction = folded;
            }

            // 3. A copy of something into itself does nothing
            if (instruction.op === 'copy' && instruction.src.kind !== 'const' && instruction.src.name === instruction.dst.name) {
                this.record('uselessCopy', instruction, null);
                continue;
            }

            // 4. Update what is known: the destination just changed, so forget anything
            //    that relied on its old value
            if (instruction.dst) {
                const name = instruction.dst.name;
                known.delete(name);
                for (const [key, value] of known) {
                    if (value.kind !== 'const' && value.name === name) known.delete(key);
                }
                if (instruction.op === 'copy') known.set(name, instruction.src);
            }
            if (instruction.op === 'goto') known = new Map();

            result.push(instruction);
        }
        return result;
    }

    // Returns the folded instruction, or null if it cannot be folded.
    // An operation that would fail (like 1 / 0) is left alone so the error still happens at runtime.
    fold(instruction) {
        try {
            if (instruction.op === 'binary' && instruction.left.kind === 'const' && instruction.right.kind === 'const') {
                const value = applyBinary(instruction.operator, instruction.left.value, instruction.right.value);
                return { op: 'copy', dst: instruction.dst, src: constant(value), line: instruction.line };
            }
            if (instruction.op === 'unary' && instruction.arg.kind === 'const') {
                const value = applyUnary(instruction.operator, instruction.arg.value);
                return { op: 'copy', dst: instruction.dst, src: constant(value), line: instruction.line };
            }
        } catch {
            // Would fail at runtime: keep it
        }
        return null;
    }

    foldBranches(code) {
        const result = [];
        for (const instruction of code) {
            if ((instruction.op === 'ifFalse' || instruction.op === 'ifTrue') && instruction.cond.kind === 'const') {
                const jumps = instruction.op === 'ifFalse' ? !isTruthy(instruction.cond.value) : isTruthy(instruction.cond.value);
                if (jumps) {
                    const replacement = { op: 'goto', target: instruction.target, line: instruction.line };
                    this.record('branchFolding', instruction, replacement);
                    result.push(replacement);
                } else {
                    this.record('branchFolding', instruction, null);
                }
                continue;
            }
            result.push(instruction);
        }
        return result;
    }

    removeUnreachable(code) {
        const targets = new Set(code.filter(isJump).map(instruction => instruction.target));
        const result = [];
        let reachable = true;
        for (const instruction of code) {
            if (instruction.op === 'label' && targets.has(instruction.name)) reachable = true;
            if (!reachable) {
                if (instruction.op !== 'label') this.record('unreachable', instruction, null);
                continue;
            }
            result.push(instruction);
            if (endsFlow(instruction)) reachable = false;
        }
        return result;
    }

    removeJumpsToNext(code) {
        return code.filter((instruction, index) => {
            if (instruction.op !== 'goto') return true;
            // Look past any labels that directly follow the jump
            for (let next = index + 1; next < code.length && code[next].op === 'label'; next++) {
                if (code[next].name === instruction.target) {
                    this.record('jumpToNext', instruction, null);
                    return false;
                }
            }
            return true;
        });
    }

    removeUnusedLabels(code) {
        const targets = new Set(code.filter(isJump).map(instruction => instruction.target));
        return code.filter(instruction => {
            if (instruction.op !== 'label' || targets.has(instruction.name)) return true;
            this.record('unusedLabel', instruction, null);
            return false;
        });
    }

    removeDeadTemps(code) {
        const reads = new Map();
        for (const instruction of code) {
            for (const operand of [instruction.src, instruction.left, instruction.right, instruction.arg, instruction.cond]) {
                if (operand?.kind === 'temp') reads.set(operand.name, (reads.get(operand.name) || 0) + 1);
            }
        }
        return code.filter(instruction => {
            const unused = instruction.dst?.kind === 'temp' && !reads.has(instruction.dst.name);
            if (!unused || !cannotFail(instruction)) return true;
            this.record('deadTemp', instruction, null);
            return false;
        });
    }

    removeUnusedLoopGuards(code) {
        const ticking = new Set(code.filter(instruction => instruction.op === 'loopTick').map(instruction => instruction.loop));
        return code.filter(instruction => {
            if (instruction.op !== 'loopStart' || ticking.has(instruction.loop)) return true;
            this.record('unusedLoopGuard', instruction, null);
            return false;
        });
    }
}

// Display rows: { text, line, kind }. The report of every change, then the optimized code.
export function optimizationRows(original, optimized) {
    const before = countTAC(original);
    const after = countTAC(optimized.tac);
    const note = (text) => ({ text, line: null, kind: 'note' });
    const lines = [
        { text: '--- Optimizer ---', line: null, kind: 'header' },
        note(`TAC instructions: ${before} before, ${after} after (${before - after} removed)`),
        note(`Ran ${optimized.rounds} ${optimized.rounds === 1 ? 'round' : 'rounds'} of passes until nothing more could improve.`),
    ];

    if (optimized.log.length === 0) {
        lines.push(note(''), note('Nothing to optimize: this code is already as simple as these passes can make it.'));
    }

    // Group the changes by pass, in the order the passes are listed
    for (const [pass, { title, why }] of Object.entries(PASSES)) {
        const changes = optimized.log.filter(change => change.pass === pass);
        if (changes.length === 0) continue;
        lines.push(note(''), { text: `--- ${title} (${changes.length}) ---`, line: null, kind: 'header' }, note(why));
        for (const change of changes) {
            const result = change.after ?? '(removed)';
            lines.push({ text: `  line ${String(change.line).padEnd(4)} ${change.before}   =>   ${result}`, line: change.line });
        }
    }

    lines.push(note(''), ...tacRows(optimized.tac, 'Optimized Three-Address Code'));
    return lines;
}
