import React, { useState } from 'react';
import { LANGUAGE_PACKS, findPack } from '../languagePacks.js';

// Helper to create input fields (moved outside component to prevent recreation)
const SettingInput = ({ id, label, value, onChange }) => (
    <div className="setting-input-container">
        <label htmlFor={id} className="setting-input-label">{label}</label>
        <input
            type="text"
            id={id}
            value={value}
            onChange={onChange}
            className="setting-input"
        />
    </div>
);

/**
 * The Settings Modal
 */
const SettingsModal = ({ isOpen, onClose, settings, onSettingsChange, onApplyPack }) => {
    const [convertCode, setConvertCode] = useState(true);
    const [packMessage, setPackMessage] = useState(null);

    if (!isOpen) return null;

    const currentPack = findPack(settings);

    const applyPack = (pack) => {
        setPackMessage(onApplyPack(pack, convertCode));
    };

    return (
        <div
            className="modal-backdrop"
            onClick={onClose} // Close on backdrop click
        >
            <div
                className="modal-content settings-modal"
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                {/* Modal Header */}
                <div className="modal-header">
                    <h2 className="modal-title">Language Settings</h2>
                    <button
                        onClick={onClose}
                        className="btn-close"
                    >
                        &times;
                    </button>
                </div>

                {/* Modal Content */}
                <div className="modal-body">
                    <h3>Language packs</h3>
                    <p>Pick a language to switch all ten keywords at once.</p>
                    <div className="pack-grid">
                        {LANGUAGE_PACKS.map(pack => (
                            <button
                                key={pack.id}
                                className={`pack-button${currentPack?.id === pack.id ? ' is-active' : ''}`}
                                onClick={() => applyPack(pack)}
                                aria-pressed={currentPack?.id === pack.id}
                            >
                                <span className="pack-name">{pack.name}</span>
                                <span className="pack-english">{pack.englishName}</span>
                            </button>
                        ))}
                    </div>
                    <label className="pack-convert">
                        <input
                            type="checkbox"
                            checked={convertCode}
                            onChange={(e) => setConvertCode(e.target.checked)}
                        />
                        Also convert the keywords in my code
                    </label>
                    {packMessage && <p className="help-note">{packMessage}</p>}

                    <h3>Customize keywords</h3>
                    <p>Configure the keywords for your language. This will change how the Lexer tokenizes your code.</p>

                    <div className="settings-grid">
                        <SettingInput id="setting-let-keyword" label="Variable Keyword" value={settings.letKeyword} onChange={(e) => onSettingsChange('letKeyword', e.target.value)} />
                        <SettingInput id="setting-print-keyword" label="Print Keyword" value={settings.printKeyword} onChange={(e) => onSettingsChange('printKeyword', e.target.value)} />
                        <SettingInput id="setting-if-keyword" label="If Keyword" value={settings.ifKeyword} onChange={(e) => onSettingsChange('ifKeyword', e.target.value)} />
                        <SettingInput id="setting-else-keyword" label="Else Keyword" value={settings.elseKeyword} onChange={(e) => onSettingsChange('elseKeyword', e.target.value)} />
                        <SettingInput id="setting-true-keyword" label="True Keyword" value={settings.trueKeyword} onChange={(e) => onSettingsChange('trueKeyword', e.target.value)} />
                        <SettingInput id="setting-false-keyword" label="False Keyword" value={settings.falseKeyword} onChange={(e) => onSettingsChange('falseKeyword', e.target.value)} />
                        <SettingInput id="setting-while-keyword" label="While Keyword" value={settings.whileKeyword} onChange={(e) => onSettingsChange('whileKeyword', e.target.value)} />
                        <SettingInput id="setting-for-keyword" label="For Keyword" value={settings.forKeyword} onChange={(e) => onSettingsChange('forKeyword', e.target.value)} />
                        <SettingInput id="setting-func-keyword" label="Function Keyword" value={settings.funcKeyword} onChange={(e) => onSettingsChange('funcKeyword', e.target.value)} />
                        <SettingInput id="setting-return-keyword" label="Return Keyword" value={settings.returnKeyword} onChange={(e) => onSettingsChange('returnKeyword', e.target.value)} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
