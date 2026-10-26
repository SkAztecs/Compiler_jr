import React, { useMemo, useState } from 'react';
import { FaTrash } from 'react-icons/fa';
import FormattedOutput from './FormattedOutput';
import PhaseView from './PhaseView';
import ASTView from './ASTView';
import CodeEditor from './CodeEditor';
import TargetsView from './TargetsView';
import DebuggerView from './DebuggerView';
import ComplexityView from './ComplexityView';
import TutorPanel from './TutorPanel';
import { keywordSpellings } from '../interpreter/lexer.js';
import { findPack } from '../languagePacks.js';
import { tokenRows, astTree, traceRows } from '../compiler/explorer.js';
import { symbolTableRows } from '../compiler/semantic.js';
import { tacRows } from '../compiler/tac.js';
import { optimizationRows } from '../compiler/optimizer.js';
import { bytecodeRows } from '../compiler/codegen.js';

// Console tabs: the program's output, a trace of one line, then each compiler phase in order
const TABS = [
    { id: 'output', label: 'Output' },
    { id: 'debugger', label: 'Debugger' },
    { id: 'complexity', label: 'Complexity' },
    { id: 'trace', label: 'Trace' },
    { id: 'tokens', label: 'Tokens' },
    { id: 'ast', label: 'AST' },
    { id: 'symbols', label: 'Symbols' },
    { id: 'tac', label: 'TAC' },
    { id: 'optimizer', label: 'Optimizer' },
    { id: 'bytecode', label: 'Bytecode' },
    { id: 'targets', label: 'C · Python · JS' },
];

const EMPTY_PHASE = {
    trace: "Compile the code, then click a line in the editor (or its line number) to follow it through every phase.",
    tokens: "Compile the code to see its tokens. (Not available when the lexer finds an error.)",
    ast: "Compile the code to see its syntax tree. (Not available when the parser finds an error.)",
    symbols: "Compile the code to see the symbol table. (Not available when the parser finds an error.)",
    tac: "Compile the code to see its three-address code. (Not generated while there are errors.)",
    optimizer: "Compile the code to see what the optimizer improved. (Not run while there are errors.)",
    bytecode: "Compile the code to see its bytecode. (Not generated while there are errors.)",
    targets: "Compile the code to see it written in C, Python and JavaScript. (Not generated while there are errors.)",
    debugger: "Compile the code, then step through it one instruction at a time. (Not available while there are errors.)",
    complexity: "Compile the code to see how its work grows, and how to make it faster. (Not available while there are errors.)",
};

/**
 * The main content area with editor and console.
 */
const MainContent = ({ code, setCode, settings, output, build, selectedLine, onSelectLine, onClearOutput, tutorStatus, onLoadCode }) => {
    const [activeTab, setActiveTab] = useState('output');
    const stale = build !== null && build.source !== code;

    // Rows for the active phase tab (null when that phase has nothing to show)
    const rows = useMemo(() => {
        if (!build) return null;
        switch (activeTab) {
            case 'trace': return selectedLine !== null ? traceRows(build, selectedLine) : null;
            case 'tokens': return build.tokens ? tokenRows(build.tokens) : null;
            case 'symbols': return build.analysis ? symbolTableRows(build.analysis) : null;
            case 'tac': return build.tac ? tacRows(build.tac, 'Three-Address Code (before optimization)') : null;
            case 'optimizer': return build.optimized ? optimizationRows(build.tac, build.optimized) : null;
            case 'bytecode': return build.bytecode ? bytecodeRows(build.bytecode) : null;
            default: return null;
        }
    }, [build, activeTab, selectedLine]);
    const tree = useMemo(() => (build?.ast ? astTree(build.ast) : null), [build]);

    // What the AI tutor needs to know about the program: its code and its keywords
    const tutorBase = useMemo(() => {
        if (!build) return null;
        const keywords = Object.fromEntries(keywordSpellings(build.settings ?? settings).map(k => [k.defaultWord, k.word]));
        return { code: build.source, keywords };
    }, [build, settings]);
    const tutorLanguage = findPack(build?.settings ?? settings)?.englishName ?? 'English';

    const renderConsole = () => {
        if (activeTab === 'output') {
            const problems = !stale ? build?.problems : null;
            return (
                <>
                    {problems && (
                        <TutorPanel
                            label="Explain this error"
                            status={tutorStatus}
                            defaultLanguage={tutorLanguage}
                            questionKey={`${build.source}\n${JSON.stringify(problems)}`}
                            makeRequest={() => ({ kind: 'error', ...tutorBase, phase: problems.phase, errors: problems.errors })}
                        />
                    )}
                    <FormattedOutput output={output} />
                </>
            );
        }
        if (activeTab === 'trace' && rows && !stale) {
            return (
                <>
                    <TutorPanel
                        label={`Explain line ${selectedLine}`}
                        status={tutorStatus}
                        defaultLanguage={tutorLanguage}
                        questionKey={`${build.source}\n${selectedLine}`}
                        makeRequest={() => ({ kind: 'line', ...tutorBase, line: selectedLine, facts: rows.map(row => row.text).join('\n') })}
                    />
                    <PhaseView rows={rows} selectedLine={selectedLine} onSelectLine={onSelectLine} highlight={false} />
                </>
            );
        }
        if (activeTab === 'complexity' && build?.bytecode) {
            return (
                <ComplexityView
                    build={build}
                    selectedLine={selectedLine}
                    onSelectLine={onSelectLine}
                    tutorStatus={tutorStatus}
                    tutorLanguage={tutorLanguage}
                    tutorBase={tutorBase}
                    onUseCode={onLoadCode}
                />
            );
        }
        if (activeTab === 'debugger' && build?.bytecode) {
            return <DebuggerView build={build} onSelectLine={onSelectLine} />;
        }
        if (activeTab === 'targets' && build?.bytecode) {
            return <TargetsView build={build} selectedLine={selectedLine} onSelectLine={onSelectLine} />;
        }
        if (activeTab === 'ast' && tree) {
            return <ASTView tree={tree} selectedLine={selectedLine} onSelectLine={onSelectLine} />;
        }
        if (!rows) return <span className="output-empty">{EMPTY_PHASE[activeTab]}</span>;
        return (
            <PhaseView
                rows={rows}
                selectedLine={selectedLine}
                onSelectLine={onSelectLine}
                highlight={activeTab !== 'trace'}
            />
        );
    };

    return (
        <main className="main-content">
            <div className="content-grid">

                {/* Code Editor Column */}
                <CodeEditor
                    code={code}
                    setCode={setCode}
                    settings={settings}
                    selectedLine={selectedLine}
                    onSelectLine={onSelectLine}
                />

                {/* Output Console Column */}
                <div className="console-section">
                    <div className="panel-head console-header">
                        <div className="console-tabs" role="tablist" aria-label="Console views">
                            {TABS.map(tab => (
                                <button
                                    key={tab.id}
                                    role="tab"
                                    aria-selected={activeTab === tab.id}
                                    className={`console-tab${activeTab === tab.id ? ' is-active' : ''}`}
                                    onClick={() => setActiveTab(tab.id)}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={onClearOutput}
                            className="btn-clear"
                        >
                            <FaTrash /> Clear
                        </button>
                    </div>
                    <pre
                        id="output-console"
                        className="console-output"
                    >
                        {stale && activeTab !== 'output' && (
                            <span className="phase-stale">The code has changed since the last compile. Press Compile &amp; Run to update this view.</span>
                        )}
                        {renderConsole()}
                    </pre>
                </div>
            </div>
        </main>
    );
};

export default MainContent;
