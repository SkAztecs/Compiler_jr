import React, { useMemo, useState } from 'react';
import PhaseView from './PhaseView';
import { TARGETS, generateTarget, runJavaScript } from '../compiler/targets.js';
import { runBytecode } from '../compiler/pipeline.js';

const HOW_TO_RUN = {
    c: 'To run it yourself: save it as program.c, then  gcc program.c -o program  and run  ./program',
    python: 'To run it yourself: save it as program.py, then run  python program.py',
};

/**
 * The program written out by the extra back ends: C, Python or JavaScript.
 * The JavaScript version is run right here and checked against the VM.
 */
const TargetsView = ({ build, selectedLine, onSelectLine }) => {
    const [language, setLanguage] = useState('c');
    const [copied, setCopied] = useState(false);
    const label = TARGETS.find(target => target.id === language).label;

    const result = useMemo(() => generateTarget(language, build.ast, build.analysis), [language, build]);

    // Run the JavaScript version and compare what it prints with the VM
    const check = useMemo(() => {
        if (language !== 'javascript' || !result.ok) return null;
        const js = runJavaScript(build.ast, build.analysis);
        const vm = runBytecode(build.bytecode);
        const sameOutput = js.output.join('\n') === vm.output.join('\n');
        const sameError = (js.error?.message ?? null) === (vm.error?.message ?? null);
        return sameOutput && sameError;
    }, [language, result, build]);

    const rows = useMemo(() => {
        const note = (text) => ({ text, line: null, kind: 'note' });
        const header = [
            { text: `--- Your program in ${label} ---`, line: null, kind: 'header' },
            note('Same front end (lexer, parser, semantic analysis), different back end. Click a line to trace it.'),
        ];
        if (!result.ok) return [...header, note(''), note(result.reason)];
        if (check !== null) {
            header.push(note(check
                ? 'Checked: running this JavaScript prints exactly what the VM printed.'
                : 'Check FAILED: this JavaScript printed something different from the VM.'));
        } else {
            header.push(note(HOW_TO_RUN[language]));
        }
        return [...header, note(''), ...result.rows];
    }, [result, check, label, language]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(result.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false); // clipboard blocked: nothing to do
        }
    };

    return (
        <div>
            <div className="target-bar">
                <div className="target-switch" role="group" aria-label="Target language">
                    {TARGETS.map(target => (
                        <button
                            key={target.id}
                            className={`target-button${language === target.id ? ' is-active' : ''}`}
                            aria-pressed={language === target.id}
                            onClick={() => setLanguage(target.id)}
                        >
                            {target.label}
                        </button>
                    ))}
                </div>
                {result.ok && (
                    <button className="target-button" onClick={copy}>
                        {copied ? 'Copied' : 'Copy code'}
                    </button>
                )}
            </div>
            <PhaseView rows={rows} selectedLine={selectedLine} onSelectLine={onSelectLine} />
        </div>
    );
};

export default TargetsView;
