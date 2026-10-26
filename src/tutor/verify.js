import { compile, runBytecode } from '../compiler/pipeline.js';
import { analyzeStaticComplexity, formatCost } from '../compiler/complexity.js';

// Checks code the AI tutor suggests, before anyone trusts it: the compiler compiles it,
// runs it on the VM next to the original, and compares the output, the number of VM
// instructions and the Big-O estimate. An AI can be wrong; the VM can't be argued with.

// The last ``` fenced code block in an answer, or null
export function extractCode(answer) {
    const blocks = [...answer.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
    if (blocks.length === 0) return null;
    const code = blocks[blocks.length - 1][1].trim();
    return code === '' ? null : code;
}

function measure(compiled) {
    const run = runBytecode(compiled.bytecode);
    const bigO = formatCost(analyzeStaticComplexity(compiled.ast, compiled.analysis).total);
    return { run, bigO };
}

// { status: 'checked' | 'different' | 'broken', ... } comparing the suggestion with build
export function verifySuggestion(build, code) {
    let suggested;
    try {
        suggested = compile(code, build.settings);
    } catch (error) {
        return { status: 'broken', reason: `the suggested code does not compile: ${error.message}` };
    }
    if (!suggested.ok) {
        const first = suggested.analysis.errors[0];
        return { status: 'broken', reason: `the suggested code does not compile: line ${first.line}: ${first.message}` };
    }
    const original = measure(build);
    const after = measure(suggested);
    const sameOutput = after.run.output.join('\n') === original.run.output.join('\n')
        && (after.run.error?.message ?? null) === (original.run.error?.message ?? null);
    const result = {
        code,
        before: { steps: original.run.steps, bigO: original.bigO },
        after: { steps: after.run.steps, bigO: after.bigO },
    };
    if (!sameOutput) {
        return { ...result, status: 'different', reason: 'the suggested code prints something different from your program' };
    }
    return { ...result, status: 'checked' };
}
