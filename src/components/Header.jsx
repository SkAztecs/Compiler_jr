import React from 'react';
import { FaPlay, FaCog, FaQuestionCircle, FaSpinner } from 'react-icons/fa';

/**
 * The header component with buttons.
 */
const Header = ({ onHelpClick, onSettingsClick, onRunClick, isRunning }) => (
    <nav className="header">
        <div className="header-content">
            <div>
                <h1 className="header-title">Code Compiler</h1>
            </div>
            <div className="header-buttons">
                <button 
                    onClick={onHelpClick}
                    className="btn btn-secondary"
                >
                    <FaQuestionCircle />
                    Syntax & Help
                </button>
                <button 
                    onClick={onSettingsClick}
                    className="btn btn-secondary"
                >
                    <FaCog />
                    Settings
                </button>
                <button
                    onClick={onRunClick}
                    className="btn btn-primary"
                    disabled={isRunning}
                    aria-label={isRunning ? 'Compiling...' : 'Compile & Run'}
                >
                    {/* Phones show the short label, so the button fits beside the title */}
                    {isRunning ? (
                        <>
                            <FaSpinner className="btn-spinner" />
                            <span className="btn-label-long">Compiling...</span>
                            <span className="btn-label-short" aria-hidden="true">...</span>
                        </>
                    ) : (
                        <>
                            <FaPlay />
                            <span className="btn-label-long">Compile & Run</span>
                            <span className="btn-label-short" aria-hidden="true">Run</span>
                        </>
                    )}
                </button>
            </div>
        </div>
    </nav>
);

export default Header;
