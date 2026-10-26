import React, { useState, useCallback } from 'react';

// Interpreter
import { Lexer } from './interpreter/lexer.js';
import { Parser } from './interpreter/parser.js';
import { Evaluator, Environment } from './interpreter/evaluator.js';

// UI Components
import GlobalStyles from './components/GlobalStyles';
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
    // --- React State ---
    const [code, setCode] = useState(DEFAULT_CODE_EXAMPLE);
    const [output, setOutput] = useState("Click 'Run Code' to see the output...");
    const [settings, setSettings] = useState({
        letKeyword: "let",
        printKeyword: "print",
        ifKeyword: "if",
        elseKeyword: "else",
        trueKeyword: "true",
        falseKeyword: "false",
        whileKeyword: "while",
        forKeyword: "for",
    });
    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [isRunning, setIsRunning] = useState(false);

    /**
     * The main function to run the interpreter.
     * Wrapped in useCallback to optimize performance.
     */
    const runCode = useCallback(() => {
        let printedOutput = [];
        setIsRunning(true);
        
        // This logger function will be passed to the Evaluator
        const outputLogger = (value) => {
            if (value === null) {
                printedOutput.push('null');
            } else if (value === true) {
                printedOutput.push('true');
            } else if (value === false) {
                printedOutput.push('false');
            } else {
                printedOutput.push(value.toString());
            }
        };
        
        try {
            // 1. Lexer
            const lexer = new Lexer(code, settings);
            const tokens = lexer.getAllTokens();
            
            // 2. Parser
            const parser = new Parser(tokens);
            const ast = parser.parseProgram();
            
            // 3. Evaluator
            const globalEnv = new Environment();
            const evaluator = new Evaluator(outputLogger); // Pass the logger
            
            // 4. Run!
            evaluator.evaluate(ast, globalEnv);
            
            // 5. Display Output
            let newOutput = "";
            if (printedOutput.length > 0) {
                newOutput += "--- Printed Output ---\n";
                newOutput += printedOutput.join('\n');
                newOutput += "\n\n";
            } else {
                newOutput += "--- No Printed Output ---\n\n";
            }

            newOutput += "--- Final Environment (Global) ---\n";
            const envObject = Object.fromEntries(globalEnv.store);
            newOutput += JSON.stringify(envObject, null, 2);
            
            setOutput(newOutput); // Set the final string
            
        } catch (e) {
            // Handle errors gracefully
            setOutput(`--- ERROR ---\n${e.message}\n(Check console for stack trace)`);
            console.error(e); // Log the full error for debugging
        } finally {
            // Ensure the loading state is turned off even if an error occurs
            setIsRunning(false);
        }
    }, [code, settings]); // Dependencies: re-run if code or settings change

    const handleSettingsChange = (settingKey, value) => {
        setSettings(prev => ({ ...prev, [settingKey]: value }));
    };

    const clearOutput = () => {
        setOutput("Console cleared. Click 'Run Code' to see new output...");
    };

    return (
        <div className="bg-gray-900 text-gray-200 min-h-screen">
            <GlobalStyles /> 
            <Header 
                onHelpClick={() => setIsHelpModalOpen(true)} 
                onSettingsClick={() => setIsSettingsModalOpen(true)} 
                onRunClick={runCode}
                isRunning={isRunning}
            />
            <MainContent 
                code={code} 
                setCode={setCode} 
                output={output}
                onClearOutput={clearOutput}
            />
            <HelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />
            <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} settings={settings} onSettingsChange={handleSettingsChange} />
        </div>
    );
}

export default App;