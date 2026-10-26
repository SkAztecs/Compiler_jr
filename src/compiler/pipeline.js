import { Lexer } from '../interpreter/lexer.js';
import { Parser } from '../interpreter/parser.js';
import { Evaluator, Environment } from '../interpreter/evaluator.js';
import { analyze } from './semantic.js';
import { generateTAC } from './tac.js';
import { optimizeTAC } from './optimizer.js';
import { generateBytecode } from './codegen.js';
import { VM } from './vm.js';
import { formatValue } from './runtime.js';

// The whole compiler, phase by phase:
//   source -> tokens -> AST -> checked AST + symbol table -> TAC -> optimized TAC -> bytecode -> VM
// Lexer and parser errors are thrown; semantic errors are returned so they can all be shown.

export function compile(source, settings = {}) {
    const tokens = new Lexer(source, settings).getAllTokens();
    let ast;
    try {
        ast = new Parser([...tokens]).parseProgram(); // the parser dequeues, so give it a copy
    } catch (error) {
        error.tokens = tokens; // the lexer worked, so its tokens can still be shown
        throw error;
    }
    const analysis = analyze(ast, settings);
    if (analysis.errors.length > 0) {
        return { ok: false, tokens, ast, analysis };
    }
    const tac = generateTAC(ast, analysis);
    const optimized = optimizeTAC(tac);
    const bytecode = generateBytecode(optimized.tac, analysis);
    // Also kept so students can compare how much work the optimizer saved
    const unoptimizedBytecode = generateBytecode(tac, analysis);
    return { ok: true, tokens, ast, analysis, tac, optimized, bytecode, unoptimizedBytecode };
}

// Runs compiled bytecode on the VM
export function runBytecode(bytecode) {
    const output = [];
    const vm = new VM(bytecode, value => output.push(formatValue(value)));
    try {
        vm.run();
        return { output, globals: vm.globals(), error: null, steps: vm.steps };
    } catch (error) {
        return { output, globals: null, error: { message: error.message, line: error.line ?? null }, steps: vm.steps };
    }
}

// Runs the same AST on the original tree-walking interpreter, as a reference
export function runReference(ast) {
    const output = [];
    const globalEnv = new Environment();
    try {
        new Evaluator(value => output.push(formatValue(value))).evaluate(ast, globalEnv);
        return { output, globals: Object.fromEntries(globalEnv.store), error: null };
    } catch (error) {
        return { output, globals: null, error: { message: error.message } };
    }
}

// Compares the VM against the reference interpreter: same printed output,
// same error (if any) and same final global variables
export function crossCheck(vmResult, referenceResult) {
    const differences = [];
    const vmError = vmResult.error?.message ?? null;
    const referenceError = referenceResult.error?.message ?? null;

    if (vmError !== referenceError) {
        differences.push(`Error: VM gave ${JSON.stringify(vmError)}, interpreter gave ${JSON.stringify(referenceError)}`);
    }
    const length = Math.max(vmResult.output.length, referenceResult.output.length);
    for (let i = 0; i < length; i++) {
        if (vmResult.output[i] !== referenceResult.output[i]) {
            differences.push(`Output line ${i + 1}: VM printed ${JSON.stringify(vmResult.output[i] ?? '(nothing)')}, interpreter printed ${JSON.stringify(referenceResult.output[i] ?? '(nothing)')}`);
            break;
        }
    }
    if (!vmError && !referenceError && !sameGlobals(vmResult.globals, referenceResult.globals)) {
        differences.push(`Final variables: VM has ${JSON.stringify(vmResult.globals)}, interpreter has ${JSON.stringify(referenceResult.globals)}`);
    }
    return { match: differences.length === 0, differences };
}

function sameGlobals(a, b) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.is(a[key], b[key]));
}
