import React, { useEffect, useMemo, useRef, useState } from 'react';
import { bytecodeRows } from '../compiler/codegen.js';
import {
    MAX_RECORDED_STEPS,
    explainStep,
    nextLineStep,
    previousLineStep,
    recordExecution,
    showValue,
    stateAt,
} from '../compiler/debugger.js';

const PLAY_INTERVAL_MS = 350;

// The name as the student wrote it: IR names add @2, @3... to keep same-named
// variables apart, which is only shown when two of them share this frame
function displayName(name, frameNames) {
    const plain = name.replace(/@\d+$/, '');
    const clash = frameNames.filter(other => other.replace(/@\d+$/, '') === plain).length > 1;
    return clash ? name : plain;
}

/**
 * Step through the bytecode one instruction at a time, forwards or backwards,
 * watching the stack, the variables and the output change.
 * The editor highlights the source line of the instruction about to run.
 */
const DebuggerView = ({ build, onSelectLine }) => {
    const program = build.bytecode;
    const recording = useMemo(() => recordExecution(program), [program]);
    const total = recording.steps.length;
    const [count, setCount] = useState(0); // instructions run so far
    const [playing, setPlaying] = useState(false);
    const listingRef = useRef(null);

    const state = useMemo(() => stateAt(program, recording, count), [program, recording, count]);
    const listing = useMemo(() => bytecodeRows(program).filter(row => row.address !== undefined), [program]);
    const frame = state.frames[state.frames.length - 1]; // the function running now
    const currentPc = state.nextPc ?? state.lastPc;
    const currentLine = currentPc !== null ? program.code[currentPc].line : null;

    // A new compile starts again from the beginning
    useEffect(() => {
        setCount(0);
        setPlaying(false);
    }, [recording]);

    // The editor follows the debugger
    useEffect(() => {
        if (currentLine !== null) onSelectLine(currentLine);
    }, [currentLine, onSelectLine]);

    // Keep the current instruction in view
    useEffect(() => {
        listingRef.current?.querySelector('.debug-instruction.is-current')?.scrollIntoView({ block: 'nearest' });
    }, [currentPc]);

    // Play: one step at a time on a timer, stopping at the end
    useEffect(() => {
        if (!playing) return undefined;
        if (count >= total) {
            setPlaying(false);
            return undefined;
        }
        const timer = setTimeout(() => setCount(count + 1), PLAY_INTERVAL_MS);
        return () => clearTimeout(timer);
    }, [playing, count, total]);

    const go = (next) => {
        setPlaying(false);
        setCount(Math.max(0, Math.min(total, next)));
    };

    // Clicking an instruction runs forward to the next time it is about to run
    const runTo = (address) => {
        for (let next = count + 1; next < total; next++) {
            if (recording.steps[next].pc === address) return go(next);
        }
        for (let next = 0; next <= count; next++) {
            if (recording.steps[next].pc === address) return go(next);
        }
        return undefined;
    };

    const status = state.error ? `Stopped with an error: ${state.error}`
        : state.done ? 'Finished.'
            : count === 0 ? 'Ready. Press Step to run the first instruction.'
                : explainStep(program, recording, count - 1);

    return (
        <div className="debugger">
            <div className="debug-controls">
                <button className="target-button" onClick={() => go(0)} disabled={count === 0}>Start</button>
                <button className="target-button" onClick={() => go(previousLineStep(program, recording, count))} disabled={count === 0}>Prev line</button>
                <button className="target-button" onClick={() => go(count - 1)} disabled={count === 0}>Back</button>
                <button className="target-button is-active" onClick={() => go(count + 1)} disabled={count >= total}>Step</button>
                <button className="target-button" onClick={() => go(nextLineStep(program, recording, count))} disabled={count >= total}>Next line</button>
                <button className="target-button" onClick={() => go(total)} disabled={count >= total}>End</button>
                <button className="target-button" onClick={() => setPlaying(!playing)} disabled={count >= total && !playing}>
                    {playing ? 'Pause' : 'Play'}
                </button>
            </div>
            <div className="debug-timeline">
                <input
                    type="range"
                    min="0"
                    max={total}
                    value={count}
                    onChange={(e) => go(Number(e.target.value))}
                    aria-label="Step through the run"
                />
                <span>Step {count} of {total}</span>
            </div>
            {recording.truncated && (
                <p className="debug-note">This run is long, so only its first {MAX_RECORDED_STEPS.toLocaleString()} instructions were recorded.</p>
            )}
            <p className={`debug-status${state.error ? ' is-error' : ''}`}>{status}</p>

            <div className="debug-grid">
                <section className="debug-panel">
                    <h4 className="debug-heading">Bytecode <span>(click to run to it)</span></h4>
                    <div className="debug-listing" ref={listingRef}>
                        {listing.map(row => (
                            <div
                                key={row.address}
                                className={`debug-instruction${row.address === currentPc ? ' is-current' : ''}`}
                                onClick={() => runTo(row.address)}
                            >
                                {row.text}
                            </div>
                        ))}
                    </div>
                </section>

                <div className="debug-side">
                    <section className="debug-panel">
                        <h4 className="debug-heading">Stack <span>(top first)</span></h4>
                        {state.stack.length === 0
                            ? <div className="debug-empty">empty</div>
                            : [...state.stack].reverse().map((value, index) => (
                                <div key={index} className={`debug-stack-item${index === 0 ? ' is-top' : ''}`}>{showValue(value)}</div>
                            ))}
                    </section>

                    {state.frames.length > 1 && (
                        <section className="debug-panel">
                            <h4 className="debug-heading">Call stack <span>(newest first)</span></h4>
                            {[...state.frames].reverse().map((frame, index) => (
                                <div key={index} className={`debug-stack-item${index === 0 ? ' is-top' : ''}`}>
                                    {frame.name ? `${frame.name}  (called on line ${frame.calledFrom})` : 'main program'}
                                </div>
                            ))}
                        </section>
                    )}

                    <section className="debug-panel">
                        <h4 className="debug-heading">
                            Memory <span>({frame.name ? `the frame of ${frame.name}` : 'one slot per name'})</span>
                        </h4>
                        {frame.slotNames.length === 0 && <div className="debug-empty">no variables</div>}
                        {frame.slotNames.map((name, slot) => (
                            <div
                                key={name}
                                className={`debug-slot${slot === state.changed ? ' is-changed' : ''}${slot >= frame.variableCount ? ' is-temp' : ''}`}
                                title={name}
                            >
                                <span>{slot}  {displayName(name, frame.slotNames)}</span>
                                <span>{showValue(frame.slots[slot])}</span>
                            </div>
                        ))}
                    </section>

                    <section className="debug-panel">
                        <h4 className="debug-heading">Output</h4>
                        {state.output.length === 0
                            ? <div className="debug-empty">nothing printed yet</div>
                            : state.output.map((line, index) => <div key={index}>{line}</div>)}
                    </section>
                </div>
            </div>
        </div>
    );
};

export default DebuggerView;
