import React, { useState, useCallback, useEffect } from 'react';
import './index.css';

// Compiler
import { compile, runBytecode, runReference, crossCheck } from './compiler/pipeline.js';
import { describeProblem } from './compiler/diagnostics.js';
import { countTAC } from './compiler/optimizer.js';
import { translateKeywords } from './compiler/translate.js';
import { getTutorStatus } from './tutor/client.js';

// UI Components
import LandingPage from './components/LandingPage';
import Header from './components/Header';
import MainContent from './components/MainContent';
import HelpModal from './components/HelpModal';
import SettingsModal from './components/SettingsModal';

// Constants
import { DEFAULT_CODE_EXAMPLE } from './constants.js';

/**
 * The main App component that holds all state.
 */
function App() {
    const [showLandingPage, setShowLandingPage] = useState(true);
    // --- React State ---
    const [code, setCode] = useState(DEFAULT_CODE_EXAMPLE);
    const [output, setOutput] = useState("Click 'Compile & Run' to see the output...");
    // What each compiler phase produced for the last compile, for the explorer tabs
    const [build, setBuild] = useState(null);
    // The source line being traced through the phases (null = none)
    const [selectedLine, setSelectedLine] = useState(null);
    const [settings, setSettings] = useState({
        letKeyword: "let",
        printKeyword: "print",
        ifKeyword: "if",
        elseKeyword: "else",
        trueKeyword: "true",
        falseKeyword: "false",
        whileKeyword: "while",
        forKeyword: "for",
        funcKeyword: "func",
        returnKeyword: "return",
    });
    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    // Whether the AI tutor is available on the dev server, and set up with a key
    const [tutorStatus, setTutorStatus] = useState(null);

    useEffect(() => {
        getTutorStatus().then(setTutorStatus);
    }, []);

    // Add a class to the body when a modal is open for animations
    useEffect(() => {
        if (isHelpModalOpen || isSettingsModalOpen) {
            document.body.classList.add('modal-open');
        } else {
            document.body.classList.remove('modal-open');
        }
    }, [isHelpModalOpen, isSettingsModalOpen]);
    
    /**
     * Compiles the code, runs the bytecode on the VM, and cross-checks the
     * result against the original tree-walking interpreter.
     */
    const runCode = useCallback(() => {
        setIsRunning(true);
        try {
            const compiled = compile(code, settings);
            const { analysis } = compiled;
            const warnings = analysis.warnings.map(w => `Line ${w.line}: ${w.message}`);

            // The console text is a list of sections separated by blank lines
            const sections = [];
            const warningSection = warnings.length > 0 ? ["--- Warnings ---", ...warnings].join('\n') : null;

            if (!compiled.ok) {
                const count = analysis.errors.length;
                sections.push([
                    "--- ERROR: found by semantic analysis ---",
                    `${count} ${count === 1 ? 'problem' : 'problems'} to fix before the program can run:`,
                    ...analysis.errors.flatMap(e => ['', describeProblem(code, { ...e, message: `Line ${e.line}: ${e.message}` })]),
                ].join('\n'));
                if (warningSection) sections.push(warningSection);
                setOutput(sections.join('\n\n'));
                setBuild({
                    source: code, settings, tokens: compiled.tokens, ast: compiled.ast, analysis,
                    problems: { phase: 'semantic analysis', errors: analysis.errors.map(({ line, message }) => ({ line, message })) },
                });
                setSelectedLine(analysis.errors[0].line);
                return;
            }

            const vmResult = runBytecode(compiled.bytecode);
            const unoptimizedResult = runBytecode(compiled.unoptimizedBytecode);
            const reference = runReference(compiled.ast);
            const check = crossCheck(vmResult, reference);
            const unoptimizedCheck = crossCheck(unoptimizedResult, reference);

            if (vmResult.error) {
                const { line, message } = vmResult.error;
                const problem = { line, message: line ? `Line ${line}: ${message}` : message };
                sections.push(`--- ERROR: found while running (runtime error) ---\n${describeProblem(code, problem)}`);
            }
            if (vmResult.output.length > 0) {
                sections.push(["--- Printed Output ---", ...vmResult.output].join('\n'));
            } else if (!vmResult.error) {
                sections.push("--- No Printed Output ---");
            }
            if (vmResult.globals) {
                sections.push(`--- Final Environment (Global) ---\n${JSON.stringify(vmResult.globals, null, 2)}`);
            }
            if (warningSection) sections.push(warningSection);
            const saved = unoptimizedResult.steps - vmResult.steps;
            const savedPercent = unoptimizedResult.steps > 0 ? Math.round((saved / unoptimizedResult.steps) * 100) : 0;
            const compilerLines = [
                "--- Compiler ---",
                `${compiled.tokens.length} tokens -> ${countTAC(compiled.tac)} TAC instructions -> ${countTAC(compiled.optimized.tac)} after optimization -> ${compiled.bytecode.code.length} bytecode instructions`,
                `VM executed ${vmResult.steps} instructions (${unoptimizedResult.steps} without optimization, ${savedPercent}% fewer)`,
            ];
            if (check.match && unoptimizedCheck.match) {
                compilerLines.push("Cross-check: optimized and unoptimized code both match the reference interpreter");
            } else {
                if (!check.match) compilerLines.push("Cross-check FAILED: optimized code disagrees with the interpreter", ...check.differences);
                if (!unoptimizedCheck.match) compilerLines.push("Cross-check FAILED: unoptimized code disagrees with the interpreter", ...unoptimizedCheck.differences);
            }
            sections.push(compilerLines.join('\n'));

            setOutput(sections.join('\n\n'));
            const problems = vmResult.error
                ? { phase: 'the running program (runtime error)', errors: [{ line: vmResult.error.line, message: vmResult.error.message }] }
                : null;
            setBuild({ source: code, settings, ...compiled, problems });
            if (vmResult.error?.line) setSelectedLine(vmResult.error.line);
        } catch (e) {
            // Lexer and parser errors stop compilation straight away. Say which phase found it:
            // the parser leaves the tokens it had, the lexer has none, and bad settings have no line.
            const phase = e.tokens ? 'by the parser (syntax error)'
                : e.line ? 'by the lexer' : 'in the keyword settings';
            setOutput(`--- ERROR: found ${phase} ---\n${describeProblem(code, e)}`);
            setBuild({
                source: code, settings, tokens: e.tokens ?? null,
                problems: { phase: e.tokens ? 'the parser' : e.line ? 'the lexer' : 'the keyword settings', errors: [{ line: e.line ?? null, message: e.message }] },
            });
            if (e.line) setSelectedLine(e.line);
            console.error(e); // Log the full error for debugging
        } finally {
            setIsRunning(false);
        }
    }, [code, settings]); // Dependencies: re-run if code or settings change

    const handleSettingsChange = (settingKey, value) => {
        setSettings(prev => ({ ...prev, [settingKey]: value }));
    };

    // Switches every keyword to a language pack, and optionally rewrites the
    // keywords in the editor to match. Returns a message for the Settings panel.
    const handleApplyPack = (pack, convertCode) => {
        const next = { ...pack.keywords };
        let message = `Keywords switched to ${pack.englishName}.`;
        if (convertCode) {
            try {
                const result = translateKeywords(code, settings, next);
                setCode(result.code);
                message = `Keywords switched to ${pack.englishName}, and your code was converted.`;
                if (result.conflicts.length > 0) {
                    const names = result.conflicts.map(name => `'${name}'`).join(', ');
                    message += ` Rename ${names}: ${result.conflicts.length === 1 ? 'it is' : 'they are'} now a keyword, so the program will not compile until you do.`;
                }
            } catch (e) {
                message = `Keywords switched to ${pack.englishName}, but your code could not be converted because it has an error: ${e.message}`;
            }
        }
        setSettings(next);
        setBuild(null); // the old phase views no longer match the code
        setSelectedLine(null);
        return message;
    };

    // Loads an example from the syntax guide into the editor
    const handleTryExample = (example) => {
        if (code.trim() !== '' && code !== example && !window.confirm('Replace the code in the editor with this example?')) return;
        setCode(example);
        setBuild(null);
        setSelectedLine(null);
        setIsHelpModalOpen(false);
    };

    const clearOutput = () => {
        setOutput("Console cleared. Click 'Compile & Run' to see new output...");
    };

    const handleEnterInterpreter = () => {
        setShowLandingPage(false);
    };

    if (showLandingPage) {
        return <LandingPage onEnter={handleEnterInterpreter} />;
    }

    return (
        <div className="app-container">
            <Header 
                onHelpClick={() => setIsHelpModalOpen(true)} 
                onSettingsClick={() => setIsSettingsModalOpen(true)} 
                onRunClick={runCode}
                isRunning={isRunning}
            />
            <MainContent 
                code={code} 
                setCode={setCode}
                settings={settings}
                output={output}
                build={build}
                selectedLine={selectedLine}
                onSelectLine={setSelectedLine}
                onClearOutput={clearOutput}
                tutorStatus={tutorStatus}
                onLoadCode={handleTryExample}
            />
            <HelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} settings={settings} onTryExample={handleTryExample} />
            <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} settings={settings} onSettingsChange={handleSettingsChange} onApplyPack={handleApplyPack} />
        </div>
    );
}

export default App;